import { and, eq, gte, lte, sql } from "drizzle-orm";
import { Decimal } from "decimal.js";
import { format, parseISO, subDays } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { getAdminDb } from "@/lib/db/client";
import { businesses, orders, outlets, payments, refunds } from "@/lib/db/schema";
import { businessDate } from "@/lib/utils/business-date";

type Db = ReturnType<typeof getAdminDb>;

/**
 * lib/integrasi/omzet-harian.ts -- ringkasan omzet per outlet per hari
 * bisnis untuk SISTEM LAPORAN Koperumnas (19 September 2026).
 *
 * KONTRAK TARIKAN (laporan yang menarik, POS tidak pernah mengirim):
 * satu endpoint baca-saja, hanya agregat -- tidak ada nama karyawan,
 * pelanggan, produk, atau transaksi individual. Route:
 * src/app/api/integrasi/omzet-harian/route.ts.
 *
 * DEFINISI ANGKA (sengaja DUA angka dengan label jelas, keputusan pemilik):
 *  - penjualan_bersih = SUM(orders.net_sales) - SUM(refunds.amount).
 *    Sebelum pajak & service charge, SUDAH dikurangi refund. Sama dengan
 *    `netSales` di getSalesSummary (sales-report.ts) -- diuji sama persis.
 *  - uang_diterima = SUM(payments.amount - payments.change_amount) untuk
 *    order paid. Uang penjualan yang benar-benar masuk (termasuk pajak &
 *    service), TIDAK dikurangi refund. Sama dengan getSalesByPaymentMethod
 *    (pola "amount - change_amount", pelajaran bug T15). Ini yang setara
 *    dengan "cash + QRIS + bank" pada laporan Kontrol F&B.
 *  - refund = SUM(refunds.amount), dikirim terpisah supaya sisi laporan bisa
 *    menurunkan definisi lain tanpa menarik ulang.
 * Refund dihitung pada HARI ORDER ASALNYA (bukan hari refund dibuat) --
 * sama dengan getSalesSummary. Akibatnya hari yang sudah tutup BISA berubah
 * belakangan; sisi laporan wajib menarik ulang beberapa hari terakhir.
 *
 * Semua rupiah dibulatkan SEKALI di akhir (half-up) ke bilangan bulat --
 * laporan menyimpan uang sebagai bigint rupiah penuh.
 *
 * HARI BISNIS: pakai orders.business_date (BUKAN created_at/paid_at) dan
 * `hari_bisnis_berjalan` dihitung DI SINI dari zona waktu bisnis + batas hari
 * (outlets.day_cutoff_time), supaya sisi laporan tidak menebak. Hari tersebut
 * belum final -- angkanya sementara.
 */

/** Parameter tanggal buruk -- route menerjemahkannya jadi 400 (bukan 500). */
export class RentangTidakValid extends Error {}

export const RENTANG_MAKS_HARI = 14;
export const RENTANG_BAWAAN_HARI = 7;

export type OmzetHariRow = {
  tanggal: string; // yyyy-MM-dd, hari bisnis
  jumlah_order: number;
  uang_diterima: number;
  penjualan_bersih: number;
  refund: number;
};

export type OmzetOutlet = {
  outlet_id: string;
  nama: string;
  aktif: boolean;
  batas_hari: string; // "HH:mm"
  batas_hari_terkonfirmasi: boolean;
  hari_bisnis_berjalan: string; // yyyy-MM-dd -- angkanya sementara, belum final
  hari: OmzetHariRow[]; // hanya tanggal yang punya order; tanggal tanpa order TIDAK ada di sini
};

export type OmzetHarian = {
  versi: 1;
  dihitung_pada: string; // ISO UTC
  zona_waktu: string;
  dari: string;
  sampai: string;
  outlet: OmzetOutlet[];
};

export type ParamsOmzetHarian = {
  businessId: string;
  dari?: string | null;
  sampai?: string | null;
  /** Hanya untuk uji -- bawaan: sekarang. */
  sekarang?: Date;
};

export type HasilRentang =
  | { ok: true; dari: string; sampai: string }
  | { ok: false; pesan: string };

function tanggalValid(nilai: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nilai)) return false;
  const d = parseISO(nilai);
  return !Number.isNaN(d.getTime()) && format(d, "yyyy-MM-dd") === nilai;
}

/**
 * Validasi + isi bawaan rentang tanggal. `hariIniKalender` = tanggal
 * KALENDER di zona bisnis (hari bisnis tidak pernah lebih maju dari ini).
 */
export function tentukanRentang(
  dari: string | null | undefined,
  sampai: string | null | undefined,
  hariIniKalender: string
): HasilRentang {
  const akhir = sampai ?? hariIniKalender;
  if (!tanggalValid(akhir)) return { ok: false, pesan: "Parameter 'sampai' harus tanggal yyyy-MM-dd yang valid." };
  const awal = dari ?? format(subDays(parseISO(akhir), RENTANG_BAWAAN_HARI), "yyyy-MM-dd");
  if (!tanggalValid(awal)) return { ok: false, pesan: "Parameter 'dari' harus tanggal yyyy-MM-dd yang valid." };
  if (awal > akhir) return { ok: false, pesan: "'dari' tidak boleh setelah 'sampai'." };
  const selisihHari = Math.round((parseISO(akhir).getTime() - parseISO(awal).getTime()) / 86_400_000);
  if (selisihHari > RENTANG_MAKS_HARI) {
    return { ok: false, pesan: `Rentang maksimal ${RENTANG_MAKS_HARI} hari.` };
  }
  return { ok: true, dari: awal, sampai: akhir };
}

/** Pembulatan half-up ke rupiah penuh, sekali di akhir (CLAUDE.md §3.1). */
export function keRupiahBulat(nilai: string | Decimal): number {
  const bulat = new Decimal(nilai).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  if (bulat.abs().greaterThan(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Nilai rupiah melebihi batas bilangan bulat aman.");
  }
  // -0 tidak boleh bocor ke JSON ("0" vs "-0" berbeda saat dibandingkan sebagai teks).
  return bulat.isZero() ? 0 : bulat.toNumber();
}

function batasHariTeks(waktu: string): string {
  return waktu.slice(0, 5);
}

/**
 * Inti agregasi -- menerima `db` (sama pola fungsi di sales-report.ts) supaya
 * bisa diuji langsung. JANGAN dipanggil dari lapisan UI dengan koneksi user:
 * ini agregat lintas outlet satu bisnis, untuk pekerjaan sistem.
 */
export async function getOmzetHarian(db: Db, params: ParamsOmzetHarian): Promise<OmzetHarian> {
  const { businessId } = params;
  const sekarang = params.sekarang ?? new Date();

  const [bisnis] = await db
    .select({ timezone: businesses.timezone })
    .from(businesses)
    .where(eq(businesses.id, businessId));
  if (!bisnis) throw new Error("Bisnis tidak ditemukan.");
  const zona = bisnis.timezone;

  const hariIniKalender = format(toZonedTime(sekarang, zona), "yyyy-MM-dd");
  const rentang = tentukanRentang(params.dari, params.sampai, hariIniKalender);
  if (!rentang.ok) throw new RentangTidakValid(rentang.pesan);

  const kondisiOrder = and(
    eq(orders.businessId, businessId),
    eq(orders.status, "paid"),
    gte(orders.businessDate, rentang.dari),
    lte(orders.businessDate, rentang.sampai)
  );
  const tanggalTeks = sql<string>`to_char(${orders.businessDate}, 'YYYY-MM-DD')`;

  const [semuaOutlet, aggOrder, aggUang, aggRefund] = await Promise.all([
    db
      .select({
        id: outlets.id,
        name: outlets.name,
        isActive: outlets.isActive,
        dayCutoffTime: outlets.dayCutoffTime,
        dayCutoffConfirmed: outlets.dayCutoffConfirmed,
      })
      .from(outlets)
      .where(eq(outlets.businessId, businessId)),
    db
      .select({
        outletId: orders.outletId,
        tanggal: tanggalTeks,
        jumlah: sql<string>`count(*)`,
        netSales: sql<string>`coalesce(sum(${orders.netSales}), '0')`,
      })
      .from(orders)
      .where(kondisiOrder)
      .groupBy(orders.outletId, orders.businessDate),
    db
      .select({
        outletId: orders.outletId,
        tanggal: tanggalTeks,
        uang: sql<string>`coalesce(sum(${payments.amount} - coalesce(${payments.changeAmount}, 0)), '0')`,
      })
      .from(payments)
      .innerJoin(orders, eq(payments.orderId, orders.id))
      .where(kondisiOrder)
      .groupBy(orders.outletId, orders.businessDate),
    db
      .select({
        outletId: orders.outletId,
        tanggal: tanggalTeks,
        refund: sql<string>`coalesce(sum(${refunds.amount}), '0')`,
      })
      .from(refunds)
      .innerJoin(orders, eq(refunds.orderId, orders.id))
      .where(kondisiOrder)
      .groupBy(orders.outletId, orders.businessDate),
  ]);

  const kunci = (outletId: string, tanggal: string) => `${outletId}|${tanggal}`;
  const uangPerHari = new Map(aggUang.map((r) => [kunci(r.outletId, r.tanggal), r.uang]));
  const refundPerHari = new Map(aggRefund.map((r) => [kunci(r.outletId, r.tanggal), r.refund]));

  const hariPerOutlet = new Map<string, OmzetHariRow[]>();
  for (const r of aggOrder) {
    const refund = new Decimal(refundPerHari.get(kunci(r.outletId, r.tanggal)) ?? "0");
    const bersih = new Decimal(r.netSales).minus(refund);
    const baris: OmzetHariRow = {
      tanggal: r.tanggal,
      jumlah_order: Number(r.jumlah),
      uang_diterima: keRupiahBulat(uangPerHari.get(kunci(r.outletId, r.tanggal)) ?? "0"),
      penjualan_bersih: keRupiahBulat(bersih),
      refund: keRupiahBulat(refund),
    };
    const daftar = hariPerOutlet.get(r.outletId) ?? [];
    daftar.push(baris);
    hariPerOutlet.set(r.outletId, daftar);
  }

  const hasilOutlet: OmzetOutlet[] = semuaOutlet
    // Outlet nonaktif hanya ikut kalau MASIH punya data pada rentang ini --
    // outlet yang dimatikan tidak boleh diam-diam menghilangkan penjualannya.
    .filter((o) => o.isActive || (hariPerOutlet.get(o.id)?.length ?? 0) > 0)
    .map((o) => ({
      outlet_id: o.id,
      nama: o.name,
      aktif: o.isActive,
      batas_hari: batasHariTeks(o.dayCutoffTime),
      batas_hari_terkonfirmasi: o.dayCutoffConfirmed,
      hari_bisnis_berjalan: businessDate(sekarang, zona, o.dayCutoffTime),
      hari: (hariPerOutlet.get(o.id) ?? []).sort((a, b) => a.tanggal.localeCompare(b.tanggal)),
    }))
    .sort((a, b) => a.nama.localeCompare(b.nama));

  return {
    versi: 1,
    dihitung_pada: sekarang.toISOString(),
    zona_waktu: zona,
    dari: rentang.dari,
    sampai: rentang.sampai,
    outlet: hasilOutlet,
  };
}

/**
 * Pintu masuk untuk Route Handler. Lapisan src/app TIDAK BOLEH menyebut
 * koneksi admin (tes no-admin-db-in-app) -- pemanggilannya ada di sini.
 */
export async function ambilOmzetHarianIntegrasi(params: ParamsOmzetHarian): Promise<OmzetHarian> {
  // PENGECUALIAN TERTULIS CLAUDE.md §3.4 (19 Sep 2026): tarikan sistem-ke-sistem, tidak ada sesi user, agregat satu bisnis saja.
  const db = getAdminDb();
  return getOmzetHarian(db, params);
}
