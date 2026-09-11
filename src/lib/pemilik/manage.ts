import { z } from "zod";
import { and, eq } from "drizzle-orm";
import type { UserDbHandle } from "@/lib/db/client";
import { pemilik } from "@/lib/db/schema";
import { assertRowsAffected } from "@/lib/db/errors";
import { generateId } from "@/lib/utils/id";
import { id as strings } from "@/lib/i18n/id";

/**
 * lib/pemilik/manage.ts — TT03. Pola thin-wrapper sama
 * lib/payment-methods/manage.ts/lib/categories/manage.ts: fungsi murni
 * (db, businessId, input) => result, testable tanpa request Next.js
 * sungguhan, dipisah dari Server Action pembungkus di
 * app/(dashboard)/pemilik/actions.ts.
 *
 * TIDAK ADA hapus permanen sama sekali (beda dari payment-methods/
 * categories yang punya delete-kalau-belum-dipakai) -- migration 0025
 * sengaja tidak membuat policy DELETE untuk tabel `pemilik` (lihat
 * RENCANA-PEMBANGUNAN-KASIR-THRIFTING.md §6.1): mitra titipan yang sudah
 * pernah dicatat harus tetap bisa ditelusuri riwayatnya (barang.pemilikId,
 * order_items.pemilikId) walau hubungan kerja sama sudah selesai --
 * cukup nonaktifkan (isActive=false), sama prinsip master data lain
 * (CLAUDE.md §3.2).
 */

type Db = UserDbHandle["db"];

const savePemilikSchema = z.object({
  id: z.string().uuid().optional(),
  kode: z.string().trim().optional(),
  nama: z.string().trim().min(1, strings.common.requiredField),
  kontak: z.string().trim().optional(),
  // Disimpan sebagai ANGKA PERSEN (60), bukan pecahan -- sama konvensi
  // outlets.taxPercent. Konversi ke pecahan (0.60) terjadi di
  // lib/pos/sell-barang.ts saat memanggil consignmentSplit(), bukan di sini.
  persenBagi: z.coerce.number().min(0, strings.pemilik.persenBagiRangeError).max(100, strings.pemilik.persenBagiRangeError),
  catatan: z.string().trim().optional(),
});

export type PemilikActionResult = {
  error?: string;
  success?: { pemilikId: string };
};

export async function savePemilikWithDb(
  db: Db,
  businessId: string,
  rawInput: unknown
): Promise<PemilikActionResult> {
  const parsed = savePemilikSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const data = parsed.data;

  if (data.id) {
    // business_id difilter eksplisit juga -- RLS lapisan terakhir, bukan
    // satu-satunya (CLAUDE.md §3.4).
    const updated = await db
      .update(pemilik)
      .set({
        kode: data.kode || null,
        nama: data.nama,
        kontak: data.kontak || null,
        persenBagi: String(data.persenBagi),
        catatan: data.catatan || null,
      })
      .where(and(eq(pemilik.id, data.id), eq(pemilik.businessId, businessId)))
      .returning({ id: pemilik.id });
    assertRowsAffected(updated, "pemilik titipan");
    return { success: { pemilikId: data.id } };
  }

  const pemilikId = generateId();
  await db.insert(pemilik).values({
    id: pemilikId,
    businessId,
    kode: data.kode || null,
    nama: data.nama,
    kontak: data.kontak || null,
    persenBagi: String(data.persenBagi),
    catatan: data.catatan || null,
  });
  return { success: { pemilikId } };
}

const setActiveSchema = z.object({ id: z.string().uuid(), isActive: z.boolean() });

/**
 * Pemilik yang sudah berhenti titip TIDAK PERNAH dihapus (lihat komentar
 * besar di atas file) -- cuma disembunyikan dari selector pemilik di TT04
 * (layar tambah barang). Barang lama yang masih merujuk ke pemilik ini
 * tetap utuh.
 */
export async function setPemilikActiveWithDb(
  db: Db,
  businessId: string,
  rawInput: unknown
): Promise<PemilikActionResult> {
  const parsed = setActiveSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const { id, isActive } = parsed.data;

  const updated = await db
    .update(pemilik)
    .set({ isActive })
    .where(and(eq(pemilik.id, id), eq(pemilik.businessId, businessId)))
    .returning({ id: pemilik.id });
  assertRowsAffected(updated, "pemilik titipan");

  return { success: { pemilikId: id } };
}
