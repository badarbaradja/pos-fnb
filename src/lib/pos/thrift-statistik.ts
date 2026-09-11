import { and, asc, desc, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import type { UserDbHandle } from "@/lib/db/client";
import { barang, employees, orderItems, orders, outlets, pemilik, shifts } from "@/lib/db/schema";
import { assertRowsAffected } from "@/lib/db/errors";
import { id as strings } from "@/lib/i18n/id";

type Db = UserDbHandle["db"];

/**
 * lib/pos/thrift-statistik.ts — "Halaman Statistik Ita" (11 September
 * 2026, disetujui CEO). Ita tidak punya login dashboard pribadi (device
 * kasir login sekali sebagai akun bersama), jadi dia tidak akan pernah
 * melihat /reports/sales atau dashboard owner walau difilter -- halaman
 * ini diakses LANGSUNG dari /pos/thrift, gerbang izin SAMA dengan
 * "Tambah Barang" (role EMPLOYEE pemilik shift, bukan sesi dashboard
 * device, lihat lib/pos/pos-add-barang.ts untuk alasan lengkap).
 */

// ─── Status stok ───────────────────────────────────────────────────────

export type StokStatusSummary = {
  baruMasuk: number;
  siapJual: number;
  terjual: number;
  rusak: number;
};

export async function getStokStatusSummary(
  db: Db,
  businessId: string,
  outletId: string
): Promise<StokStatusSummary> {
  const rows = await db
    .select({ status: barang.status, count: sql<string>`count(*)` })
    .from(barang)
    .where(and(eq(barang.businessId, businessId), eq(barang.outletId, outletId)))
    .groupBy(barang.status);

  const byStatus = Object.fromEntries(rows.map((r) => [r.status, Number(r.count)]));
  return {
    baruMasuk: byStatus["baru_masuk"] ?? 0,
    siapJual: byStatus["siap_jual"] ?? 0,
    terjual: byStatus["terjual"] ?? 0,
    rusak: byStatus["rusak"] ?? 0,
  };
}

// ─── Barang menumpuk ────────────────────────────────────────────────────

export type BarangMenumpukRow = {
  id: string;
  kode: string;
  nama: string;
  ukuran: string | null;
  warna: string | null;
  hargaJual: string;
  umurHari: number;
  pemilikNama: string | null;
};

/**
 * Barang siap_jual yang umurnya >= ambang "menumpuk" outlet ini, PALING
 * LAMA dulu -- §7 SPESIFIKASI-THRIFTING.md: barang titipan yang tidak
 * laku berbulan-bulan perlu dibicarakan dengan pemiliknya.
 *
 * Ambangnya (thresholdDays) TIDAK dihardcode di sini -- diambil dari
 * outlets.barang_menumpuk_days (default 60, lihat komentar schema.ts),
 * diubah lewat setBarangMenumpukDaysWithDb di bawah. Keputusan CEO 11
 * September 2026 menutup pertanyaan terbuka SPESIFIKASI-THRIFTING.md §6
 * poin 3 -- sebelumnya SENGAJA tidak ada ambang sama sekali (lihat riwayat
 * git), sekarang ambangnya ADA tapi bisa diubah Ita/CEO, bukan angka mati.
 */
export async function getBarangMenumpuk(
  db: Db,
  businessId: string,
  outletId: string,
  thresholdDays: number
): Promise<BarangMenumpukRow[]> {
  const rows = await db
    .select({
      id: barang.id,
      kode: barang.kode,
      nama: barang.nama,
      ukuran: barang.ukuran,
      warna: barang.warna,
      hargaJual: barang.hargaJual,
      masukPada: barang.masukPada,
      pemilikNama: pemilik.nama,
    })
    .from(barang)
    .leftJoin(pemilik, eq(barang.pemilikId, pemilik.id))
    .where(
      and(
        eq(barang.businessId, businessId),
        eq(barang.outletId, outletId),
        eq(barang.status, "siap_jual")
      )
    )
    .orderBy(asc(barang.masukPada));

  const now = Date.now();
  return rows
    .map((r) => ({
      id: r.id,
      kode: r.kode,
      nama: r.nama,
      ukuran: r.ukuran,
      warna: r.warna,
      hargaJual: r.hargaJual,
      umurHari: Math.floor((now - r.masukPada.getTime()) / 86_400_000),
      pemilikNama: r.pemilikNama,
    }))
    .filter((r) => r.umurHari >= thresholdDays);
}

/**
 * Ambang "barang menumpuk" outlet ini, dari outlets.barang_menumpuk_days
 * (default 60 lewat kolom itu sendiri, bukan diketik ulang di sini).
 */
export async function getBarangMenumpukDays(
  db: Db,
  businessId: string,
  outletId: string
): Promise<number> {
  const [row] = await db
    .select({ days: outlets.barangMenumpukDays })
    .from(outlets)
    .where(and(eq(outlets.id, outletId), eq(outlets.businessId, businessId)));
  return row?.days ?? 60;
}

export type SetBarangMenumpukDaysResult = { error?: string; success?: { days: number } };

/**
 * Ubah ambang "menumpuk" langsung dari Statistik Ita -- gerbang SAMA
 * persis dengan addBarangFromShiftWithDb (lib/pos/pos-add-barang.ts):
 * role EMPLOYEE pemilik shift (manager/owner via PIN), BUKAN role
 * membership sesi device, karena Ita tidak pernah login dashboard untuk
 * sampai ke outlet-form-dialog.tsx (jawaban CEO 11 September 2026, "Ita
 * atau CEO bisa mengubahnya").
 */
export async function setBarangMenumpukDaysWithDb(
  db: Db,
  businessId: string,
  shiftId: string,
  rawDays: unknown
): Promise<SetBarangMenumpukDaysResult> {
  const days = Number(rawDays);
  if (!Number.isInteger(days) || days < 1) {
    return { error: strings.statistikIta.menumpukThresholdInvalidError };
  }

  const [shift] = await db
    .select({ status: shifts.status, outletId: shifts.outletId, employeeRole: employees.role })
    .from(shifts)
    .innerJoin(employees, eq(shifts.employeeId, employees.id))
    .where(and(eq(shifts.id, shiftId), eq(shifts.businessId, businessId)));

  if (!shift || shift.status !== "open") {
    return { error: strings.common.unexpectedError };
  }
  if (shift.employeeRole !== "manager" && shift.employeeRole !== "owner") {
    return { error: strings.pos.tambahBarangAksesDitolakError };
  }

  const updated = await db
    .update(outlets)
    .set({ barangMenumpukDays: days })
    .where(and(eq(outlets.id, shift.outletId), eq(outlets.businessId, businessId)))
    .returning({ id: outlets.id });
  assertRowsAffected(updated, "outlet");

  return { success: { days } };
}

// ─── Rekap bagi hasil per pemilik, bulan berjalan ──────────────────────

export type BagiHasilPemilikRow = {
  pemilikId: string | null;
  pemilikNama: string;
  jumlahTerjual: number;
  totalPenjualan: string;
  pemilikShareAmount: string;
  tokoShareAmount: string;
};

/**
 * Rekap bagi hasil bulan berjalan -- pekerjaan Ita, dibayarkan bulanan
 * saat tutup buku (jawaban CEO, lihat SPESIFIKASI-THRIFTING.md §7).
 * Versi RINGKAS TT11 (laporan bulanan penuh masih di daftar tunggu) --
 * cukup untuk Ita melihat siapa dapat berapa BULAN INI, belum termasuk
 * status "sudah dibayar" (itu bagian TT11 penuh, per-rekap bulanan,
 * bukan per-transaksi).
 */
export async function getBagiHasilBulanIni(
  db: Db,
  businessId: string,
  outletId: string,
  startDate: string,
  endDate: string
): Promise<BagiHasilPemilikRow[]> {
  const rows = await db
    .select({
      pemilikId: orderItems.pemilikId,
      pemilikNama: pemilik.nama,
      jumlahTerjual: sql<string>`count(*)`,
      totalPenjualan: sql<string>`coalesce(sum(${orderItems.netAmount}), '0')`,
      pemilikShareAmount: sql<string>`coalesce(sum(${orderItems.pemilikShareAmount}), '0')`,
      tokoShareAmount: sql<string>`coalesce(sum(${orderItems.tokoShareAmount}), '0')`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .leftJoin(pemilik, eq(orderItems.pemilikId, pemilik.id))
    .where(
      and(
        eq(orders.businessId, businessId),
        eq(orders.outletId, outletId),
        eq(orders.status, "paid"),
        isNotNull(orderItems.barangId), // cuma baris thrifting, bukan F&B
        gte(orders.businessDate, startDate),
        lte(orders.businessDate, endDate)
      )
    )
    .groupBy(orderItems.pemilikId, pemilik.nama)
    .orderBy(desc(sql`sum(${orderItems.pemilikShareAmount})`));

  return rows.map((r) => ({
    pemilikId: r.pemilikId,
    pemilikNama: r.pemilikNama ?? "Milik toko sendiri",
    jumlahTerjual: Number(r.jumlahTerjual),
    totalPenjualan: r.totalPenjualan,
    pemilikShareAmount: r.pemilikShareAmount,
    tokoShareAmount: r.tokoShareAmount,
  }));
}
