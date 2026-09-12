import { and, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { fromZonedTime } from "date-fns-tz";
import type { UserDbHandle } from "@/lib/db/client";
import { barang, orderItems, orders, pemilik, pemilikPayouts } from "@/lib/db/schema";

type Db = UserDbHandle["db"];

/**
 * lib/db/queries/bagi-hasil-report.ts — TT11, laporan bagi hasil bulanan
 * PENUH (bukan versi ringkas getBagiHasilBulanIni di
 * lib/pos/thrift-statistik.ts, yang TETAP DIPAKAI apa adanya untuk
 * Statistik Ita -- laporan ini untuk dashboard /reports/bagi-hasil,
 * ditambah pelacakan pembayaran yang tidak dibutuhkan Statistik Ita).
 *
 * TIGA agregasi terpisah (stok, uang periode, pembayaran periode),
 * masing-masing SATU CTE pra-agregasi per pemilikId, BUKAN satu query
 * dengan tiga LEFT JOIN langsung ke `pemilik` -- kalau digabung langsung,
 * `pemilik` × `barang` × `pemilik_payouts` jadi cross product (fan-out)
 * yang mengalikan SUM/COUNT dengan jumlah baris tabel lain, bukan
 * menjumlahkannya. Pola CTE-lalu-LEFT-JOIN ini yang aman.
 *
 * Sengaja HANYA pemilik titipan sungguhan (bukan "milik toko sendiri",
 * beda dari getBagiHasilBulanIni yang menyertakan baris toko) -- laporan
 * ini soal "berapa utang toko ke siapa", barang toko sendiri tidak
 * pernah berutang ke siapa pun.
 *
 * ASUMSI PENAFSIRAN (SPESIFIKASI-THRIFTING.md §7 tidak eksplisit,
 * ditulis di sini supaya CEO bisa mengoreksi kalau salah baca) --
 * `dititipkan`/`terjual`/`belumTerjual`/`rusak` semuanya KUMULATIF
 * (sepanjang waktu sampai akhir periode), BUKAN dibatasi rentang
 * tanggal laporan -- ini yang membuat identitas tertutup selalu
 * berlaku: dititipkan = terjual + belumTerjual + rusak (diuji di
 * __tests__). "Belum terjual" secara alami tidak mungkin dibatasi
 * periode (barang lama yang belum laku ikut terbawa dari bulan-bulan
 * sebelumnya), jadi `terjual`/`dititipkan` disamakan skalanya (kumulatif
 * juga) supaya ketiganya konsisten satu sama lain.
 *
 * `totalPenjualan`/`bagianPemilik`/`bagianToko`/`terjualPeriode`
 * SEBALIKNYA dibatasi ketat ke rentang tanggal laporan (startDate..
 * endDate) -- ini yang jadi dasar kewajiban bayar periode itu, HARUS
 * cuma penjualan periode ini, bukan sepanjang waktu.
 */

export type BagiHasilLaporanRow = {
  pemilikId: string;
  pemilikNama: string;
  persenBagi: string;
  dititipkan: number;
  terjualKumulatif: number;
  belumTerjual: number;
  rusak: number;
  terjualPeriode: number;
  totalPenjualan: string;
  bagianPemilik: string;
  bagianToko: string;
  sudahDibayar: string;
};

export async function getBagiHasilLaporan(
  db: Db,
  params: {
    businessId: string;
    outletId: string;
    // businessTimezone, BUKAN "outletTimezone" -- outlet TIDAK PUNYA kolom
    // zona waktu sendiri di skema ini, timezone SELALU dari businesses.timezone
    // (nama parameter lama berbohong soal sumbernya, koreksi CEO 12 September
    // 2026: batas periode ditentukan DUA nilai, dayCutoffTime DAN zona waktu
    // -- gerbang yang cuma memagari satu nilai memberi rasa aman palsu).
    businessTimezone: string;
    startDate: string; // 'yyyy-MM-dd', business_date
    endDate: string; // 'yyyy-MM-dd', business_date
  }
): Promise<BagiHasilLaporanRow[]> {
  const { businessId, outletId, businessTimezone, startDate, endDate } = params;

  // Batas "akhir periode" sebagai instant UTC sungguhan (bukan tengah
  // malam UTC) -- barang.masukPada/terjualPada timestamptz dibandingkan
  // terhadap instant ini, dikonversi dari kalender lokal BISNIS (bukan
  // outlet -- outlet tidak punya zona waktu sendiri) supaya konsisten
  // dengan zona waktu yang sama dipakai businessDate() untuk penjualan
  // (CLAUDE.md §3.3: tidak pernah pakai zona waktu server).
  // .toISOString() -- driver postgres tidak menerima objek Date mentah
  // sebagai parameter terikat (bind param), harus string.
  const endOfPeriodInstant = fromZonedTime(`${endDate}T23:59:59.999`, businessTimezone).toISOString();

  const stockCte = db.$with("bagi_hasil_stock").as(
    db
      .select({
        pemilikId: barang.pemilikId,
        dititipkan: sql<string>`count(*) filter (where ${barang.masukPada} <= ${endOfPeriodInstant})`.as(
          "dititipkan"
        ),
        // terjualPada, BUKAN status='terjual' saat ini -- terjualPada
        // adalah fakta permanen (sekali terisi, tidak pernah berubah),
        // sementara `status` cuma mencerminkan keadaan SEKARANG. Laporan
        // untuk periode BULAN LALU harus tetap benar walau item itu baru
        // laku BULAN INI (sesudah endDate periode lama) -- kalau dites
        // pakai status sekarang, item begitu akan salah terhitung
        // "sudah terjual" di laporan bulan lalu juga.
        terjualKumulatif: sql<string>`count(*) filter (where ${barang.terjualPada} <= ${endOfPeriodInstant})`.as(
          "terjual_kumulatif"
        ),
        // "Belum terjual per endDate" = masuk sebelum endDate, DAN belum
        // laku per endDate (null atau laku SESUDAH endDate), DAN bukan
        // rusak. TIDAK dicek dari status baru_masuk/siap_jual sekarang --
        // status bisa saja SUDAH 'terjual' hari ini padahal saat endDate
        // periode ini belum (lihat catatan terjualKumulatif di atas).
        // Catatan jujur: `rusak` TIDAK punya kolom timestamp historis
        // (tidak ada rusakPada) -- baris yang SEKARANG berstatus rusak
        // dianggap rusak SEJAK masuk untuk keperluan laporan periode lama,
        // sedikit tidak presisi untuk periode yang sudah lewat, tidak ada
        // cara memperbaikinya tanpa menambah kolom baru.
        belumTerjual: sql<string>`count(*) filter (where ${barang.masukPada} <= ${endOfPeriodInstant} and (${barang.terjualPada} is null or ${barang.terjualPada} > ${endOfPeriodInstant}) and ${barang.status} <> 'rusak')`.as(
          "belum_terjual"
        ),
        rusak: sql<string>`count(*) filter (where ${barang.status} = 'rusak' and ${barang.masukPada} <= ${endOfPeriodInstant})`.as(
          "rusak"
        ),
      })
      .from(barang)
      .where(
        and(
          eq(barang.businessId, businessId),
          eq(barang.outletId, outletId),
          isNotNull(barang.pemilikId)
        )
      )
      .groupBy(barang.pemilikId)
  );

  const moneyCte = db.$with("bagi_hasil_money").as(
    db
      .select({
        pemilikId: orderItems.pemilikId,
        terjualPeriode: sql<string>`count(*)`.as("terjual_periode"),
        totalPenjualan: sql<string>`coalesce(sum(${orderItems.netAmount}), '0')`.as(
          "total_penjualan"
        ),
        bagianPemilik: sql<string>`coalesce(sum(${orderItems.pemilikShareAmount}), '0')`.as(
          "bagian_pemilik"
        ),
        bagianToko: sql<string>`coalesce(sum(${orderItems.tokoShareAmount}), '0')`.as(
          "bagian_toko"
        ),
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(
        and(
          eq(orders.businessId, businessId),
          eq(orders.outletId, outletId),
          eq(orders.status, "paid"),
          isNotNull(orderItems.pemilikId),
          gte(orders.businessDate, startDate),
          lte(orders.businessDate, endDate)
        )
      )
      .groupBy(orderItems.pemilikId)
  );

  const payoutCte = db.$with("bagi_hasil_payout").as(
    db
      .select({
        pemilikId: pemilikPayouts.pemilikId,
        sudahDibayar: sql<string>`coalesce(sum(${pemilikPayouts.jumlah}), '0')`.as(
          "sudah_dibayar"
        ),
      })
      .from(pemilikPayouts)
      .where(
        and(
          eq(pemilikPayouts.businessId, businessId),
          eq(pemilikPayouts.outletId, outletId),
          eq(pemilikPayouts.startDate, startDate),
          eq(pemilikPayouts.endDate, endDate)
        )
      )
      .groupBy(pemilikPayouts.pemilikId)
  );

  const rows = await db
    .with(stockCte, moneyCte, payoutCte)
    .select({
      pemilikId: pemilik.id,
      pemilikNama: pemilik.nama,
      persenBagi: pemilik.persenBagi,
      dititipkan: sql<string>`coalesce(${stockCte.dititipkan}, 0)`,
      terjualKumulatif: sql<string>`coalesce(${stockCte.terjualKumulatif}, 0)`,
      belumTerjual: sql<string>`coalesce(${stockCte.belumTerjual}, 0)`,
      rusak: sql<string>`coalesce(${stockCte.rusak}, 0)`,
      terjualPeriode: sql<string>`coalesce(${moneyCte.terjualPeriode}, 0)`,
      // '0.00' (bukan '0') -- kolom uang numeric(16,2), literal fallback
      // harus berskala sama supaya string yang dikembalikan konsisten
      // baik ada transaksi maupun tidak (Decimal/formatIDR tidak peduli,
      // tapi test dan tampilan sebaiknya tidak perlu menduga dua bentuk).
      totalPenjualan: sql<string>`coalesce(${moneyCte.totalPenjualan}, '0.00')`,
      bagianPemilik: sql<string>`coalesce(${moneyCte.bagianPemilik}, '0.00')`,
      bagianToko: sql<string>`coalesce(${moneyCte.bagianToko}, '0.00')`,
      sudahDibayar: sql<string>`coalesce(${payoutCte.sudahDibayar}, '0.00')`,
    })
    .from(pemilik)
    .leftJoin(stockCte, eq(stockCte.pemilikId, pemilik.id))
    .leftJoin(moneyCte, eq(moneyCte.pemilikId, pemilik.id))
    .leftJoin(payoutCte, eq(payoutCte.pemilikId, pemilik.id))
    .where(and(eq(pemilik.businessId, businessId), eq(pemilik.isActive, true)))
    .orderBy(pemilik.nama);

  return rows.map((r) => ({
    pemilikId: r.pemilikId,
    pemilikNama: r.pemilikNama,
    persenBagi: r.persenBagi,
    dititipkan: Number(r.dititipkan),
    terjualKumulatif: Number(r.terjualKumulatif),
    terjualPeriode: Number(r.terjualPeriode),
    belumTerjual: Number(r.belumTerjual),
    rusak: Number(r.rusak),
    totalPenjualan: r.totalPenjualan,
    bagianPemilik: r.bagianPemilik,
    bagianToko: r.bagianToko,
    sudahDibayar: r.sudahDibayar,
  }));
}

export type PemilikPayoutHistoryRow = {
  id: string;
  jumlah: string;
  tanggalBayar: string;
  catatan: string | null;
};

/**
 * Riwayat pembayaran satu pemilik untuk SATU periode laporan yang persis
 * sama -- ditampilkan di dialog "Tandai sudah dibayar" supaya siapa pun
 * yang mau mencatat cicilan baru bisa lihat dulu apa yang sudah tercatat
 * (SPESIFIKASI-THRIFTING.md §7: bisa beberapa kali cicilan).
 */
export async function getPemilikPayoutHistory(
  db: Db,
  params: { businessId: string; outletId: string; pemilikId: string; startDate: string; endDate: string }
): Promise<PemilikPayoutHistoryRow[]> {
  const rows = await db
    .select({
      id: pemilikPayouts.id,
      jumlah: pemilikPayouts.jumlah,
      tanggalBayar: pemilikPayouts.tanggalBayar,
      catatan: pemilikPayouts.catatan,
    })
    .from(pemilikPayouts)
    .where(
      and(
        eq(pemilikPayouts.businessId, params.businessId),
        eq(pemilikPayouts.outletId, params.outletId),
        eq(pemilikPayouts.pemilikId, params.pemilikId),
        eq(pemilikPayouts.startDate, params.startDate),
        eq(pemilikPayouts.endDate, params.endDate)
      )
    )
    .orderBy(pemilikPayouts.tanggalBayar);

  return rows;
}
