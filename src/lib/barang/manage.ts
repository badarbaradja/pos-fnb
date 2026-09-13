import { z } from "zod";
import { and, eq, ne } from "drizzle-orm";
import type { UserDbHandle } from "@/lib/db/client";
import { barang, outlets } from "@/lib/db/schema";
import { assertRowsAffected, isUniqueViolation } from "@/lib/db/errors";
import { generateId } from "@/lib/utils/id";
import { generateBarangKode } from "./kode";
import { isOutletAllowed, type OutletScope } from "@/lib/auth/outlet-scope";
import { id as strings } from "@/lib/i18n/id";

/**
 * lib/barang/manage.ts — TT04. Pola thin-wrapper sama lib/pemilik/manage.ts.
 * TIDAK ADA hapus permanen (migration 0025 sengaja tidak membuat policy
 * DELETE untuk `barang`, sama alasan `products`: barang yang salah input
 * ditandai 'rusak', bukan dihapus -- riwayat harus tetap bisa ditelusuri,
 * lihat RENCANA-PEMBANGUNAN-KASIR-THRIFTING.md §6.2).
 *
 * kode SELALU digenerate server (generateBarangKode()), TIDAK PERNAH
 * diterima dari input klien -- baik saat dibuat maupun diedit (kode yang
 * sudah tercetak di label fisik tidak boleh berubah diam-diam lewat form
 * edit). Retry sampai 5x kalau tabrakan (unique constraint
 * businessId+kode) -- ruang kode (29^5 ~ 20 juta kombinasi per outlet)
 * membuat tabrakan sangat jarang, retry cuma jaring pengaman.
 */

type Db = UserDbHandle["db"];

const MAX_KODE_RETRY = 5;

const saveBarangSchema = z.object({
  id: z.string().uuid().optional(),
  outletId: z.string().uuid(),
  categoryId: z.string().uuid().optional(),
  nama: z.string().trim().min(1, strings.common.requiredField),
  merek: z.string().trim().optional(),
  ukuran: z.string().trim().optional(),
  warna: z.string().trim().optional(),
  kondisi: z.string().trim().optional(),
  hargaModal: z.coerce.number().min(0).default(0),
  hargaJual: z.coerce.number().min(0, strings.barang.hargaJualRequiredError),
  pemilikId: z.string().uuid().optional(), // kosong = milik toko sendiri
});

export type BarangActionResult = {
  error?: string;
  success?: { barangId: string; kode: string };
};

export async function saveBarangWithDb(
  db: Db,
  businessId: string,
  allowedOutletIds: OutletScope,
  rawInput: unknown
): Promise<BarangActionResult> {
  const parsed = saveBarangSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const data = parsed.data;

  if (data.id) {
    // Pembatasan akses per outlet, Tahap 4 (13 September 2026, §27) --
    // outletId BARIS YANG SEDANG DIUBAH dicek di sini (BUKAN data.outletId
    // dari input -- edit TIDAK PERNAH memindahkan outlet, lihat komentar
    // di atas file, jadi input outletId tidak relevan untuk cabang ini
    // sama sekali). Manajer dibatasi ke Outlet A tidak boleh mengedit
    // barang Outlet B walau cuma ganti harga/nama, walau outletnya sendiri
    // tidak pernah berubah lewat form ini.
    const [current] = await db
      .select({ outletId: barang.outletId })
      .from(barang)
      .where(and(eq(barang.id, data.id), eq(barang.businessId, businessId)));
    if (!current) {
      return { error: strings.common.unexpectedError };
    }
    if (!isOutletAllowed(allowedOutletIds, current.outletId)) {
      return { error: strings.common.outletAccessDenied };
    }

    // Edit TIDAK menyentuh kode sama sekali -- lihat komentar di atas file.
    const updated = await db
      .update(barang)
      .set({
        categoryId: data.categoryId ?? null,
        nama: data.nama,
        merek: data.merek || null,
        ukuran: data.ukuran || null,
        warna: data.warna || null,
        kondisi: data.kondisi || null,
        hargaModal: String(data.hargaModal),
        hargaJual: String(data.hargaJual),
        pemilikId: data.pemilikId || null,
      })
      .where(and(eq(barang.id, data.id), eq(barang.businessId, businessId)))
      .returning({ id: barang.id, kode: barang.kode });
    assertRowsAffected(updated, "barang");
    return { success: { barangId: data.id, kode: updated[0]!.kode } };
  }

  // Pembatasan akses per outlet, Tahap 4 -- CREATE, dicek dari
  // data.outletId (input pengguna, satu-satunya sumber outlet untuk
  // barang BARU). Dicek SEBELUM query outlet.code di bawah -- jangan
  // sampai lookup apa pun jalan dulu baru ditolak.
  if (!isOutletAllowed(allowedOutletIds, data.outletId)) {
    return { error: strings.common.outletAccessDenied };
  }

  // Kode barang berprefiks kode outlet fisiknya -- diambil ULANG dari DB di
  // sini (bukan dipercaya dari input klien) supaya prefiksnya selalu benar
  // walau outletId di form berubah (CLAUDE.md §3.4).
  const [outlet] = await db
    .select({ code: outlets.code })
    .from(outlets)
    .where(and(eq(outlets.id, data.outletId), eq(outlets.businessId, businessId)));
  if (!outlet) {
    return { error: strings.common.unexpectedError };
  }

  const barangId = generateId();
  for (let attempt = 0; attempt < MAX_KODE_RETRY; attempt++) {
    const kode = generateBarangKode(outlet.code);
    try {
      await db.insert(barang).values({
        id: barangId,
        businessId,
        outletId: data.outletId,
        kode,
        categoryId: data.categoryId ?? null,
        nama: data.nama,
        merek: data.merek || null,
        ukuran: data.ukuran || null,
        warna: data.warna || null,
        kondisi: data.kondisi || null,
        hargaModal: String(data.hargaModal),
        hargaJual: String(data.hargaJual),
        status: "baru_masuk",
        pemilikId: data.pemilikId || null,
      });
      return { success: { barangId, kode } };
    } catch (err) {
      if (isUniqueViolation(err) && attempt < MAX_KODE_RETRY - 1) {
        continue; // kode tabrakan, coba lagi dengan kode acak baru
      }
      // Utang dicatat §31, dikerjakan sekalian setelah Tahap 5 tutup --
      // sebelumnya `throw err` di sini meneruskan error MENTAH (termasuk
      // pelanggaran RLS) ke pemanggil, beda dari pola shift.ts (pesan
      // generik). addBarangFromShiftWithDb TIDAK ADA try/catch-nya
      // sendiri, jadi error mentah akan sampai ke boundary Server Action
      // tanpa pesan manusiawi. Dibungkus di sini, BUKAN di
      // addBarangFromShiftWithDb -- ini titik satu-satunya di
      // saveBarangWithDb yang benar-benar bisa gagal karena sebab di
      // luar validasi (RLS/koneksi), beda dari assertRowsAffected di
      // jalur UPDATE di atas yang SENGAJA tetap melempar mentah (bug
      // struktural, bukan penolakan akses yang sah -- lihat komentar
      // assertRowsAffected di lib/db/errors.ts).
      console.error("saveBarangWithDb (create) gagal:", err);
      return { error: strings.common.unexpectedError };
    }
  }
  return { error: strings.common.unexpectedError };
}

const setStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["baru_masuk", "siap_jual", "rusak"]),
});

/**
 * Transisi status manual (Admin) -- SENGAJA TIDAK menerima 'terjual' di
 * sini sama sekali. Satu-satunya jalan status jadi 'terjual' adalah
 * trigger claim_barang_for_sale() (TT02) saat order_items sungguhan
 * ter-insert, bukan lewat form manapun -- supaya "barang terjual" selalu
 * berarti benar-benar ada transaksi di baliknya, bukan bisa dipalsukan
 * lewat halaman kelola barang.
 */
export async function setBarangStatusWithDb(
  db: Db,
  businessId: string,
  allowedOutletIds: OutletScope,
  rawInput: unknown
): Promise<BarangActionResult> {
  const parsed = setStatusSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const { id, status } = parsed.data;

  // Pembatasan akses per outlet, Tahap 4 -- DITAMBAHKAN PROAKTIF (di luar
  // saveBarangWithDb yang eksplisit diminta CEO): fungsi ini SAMA-SAMA
  // menerima id barang langsung tanpa outletId, digerbang izin sama
  // (barang.manage), risikonya identik. Dicek TERPISAH dari WHERE
  // ne(status,'terjual') di bawah (bukan dilipat jadi satu kondisi) --
  // supaya pesan errornya benar sesuai alasan sesungguhnya ("di luar
  // akses Anda" vs "sudah terjual"), bukan salah satu pesan generik yang
  // membingungkan untuk kasus yang satunya.
  const [current] = await db
    .select({ outletId: barang.outletId })
    .from(barang)
    .where(and(eq(barang.id, id), eq(barang.businessId, businessId)));
  if (!current) {
    return { error: strings.common.unexpectedError };
  }
  if (!isOutletAllowed(allowedOutletIds, current.outletId)) {
    return { error: strings.common.outletAccessDenied };
  }

  const updated = await db
    .update(barang)
    .set({ status })
    .where(
      and(
        eq(barang.id, id),
        eq(barang.businessId, businessId),
        // Barang yang sudah 'terjual' TIDAK BISA ditarik balik lewat sini --
        // WHERE ini menolak baris yang statusnya sudah 'terjual', bukan cuma
        // disembunyikan di UI (pertahanan berlapis, CLAUDE.md §3.4).
        ne(barang.status, "terjual")
      )
    )
    .returning({ id: barang.id, kode: barang.kode });

  if (updated.length === 0) {
    return { error: strings.barang.alreadySoldError };
  }

  return { success: { barangId: id, kode: updated[0]!.kode } };
}
