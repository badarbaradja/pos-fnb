import { z } from "zod";
import { and, eq, or } from "drizzle-orm";
import type { UserDbHandle } from "@/lib/db/client";
import { ingredients, units } from "@/lib/db/schema";
import { DeleteBlockedError, isUniqueViolation } from "@/lib/db/errors";
import { generateId } from "@/lib/utils/id";
import { id as strings } from "@/lib/i18n/id";

/**
 * lib/units/manage.ts — T21. createUnitWithDb/updateUnitWithDb TERPISAH
 * (bukan satu saveUnitWithDb), pola sama lib/devices/manage.ts, supaya
 * `code` tidak bisa ditulis ulang lewat update sama sekali -- lihat
 * docs/04-CATATAN-TEKNIS.md #15: ingredients.base_unit/purchase_unit
 * menyimpan code ini sebagai TEKS (bukan FK, sesuai BLUEPRINT §3.3),
 * jadi mengubah code memutus referensi tanpa error apa pun.
 *
 * Tabel `units` (migration 0017) TIDAK punya kolom is_active, beda dari
 * price_tiers/categories/dst. Keputusan: units cuma dapat create/edit
 * (nama, satuan dasar, faktor) + hapus permanen KALAU belum dipakai
 * ingredient manapun -- tanpa jalur nonaktifkan. Unit adalah tabel
 * referensi/kosakata, bukan entitas dengan riwayat transaksi sendiri
 * seperti karyawan/produk, jadi "belum pernah dipakai -> boleh hilang
 * sepenuhnya, sudah dipakai -> tidak bisa hilang sama sekali" cukup tanpa
 * status aktif/nonaktif. Kalau nanti ternyata perlu (mis. owner ingin
 * berhenti menawarkan satuan tertentu untuk bahan BARU tapi bahan lama
 * tetap boleh memakainya), menambah is_active adalah migration kecil yang
 * bisa menyusul -- bukan diputuskan diam-diam sekarang karena menyentuh
 * skema yang baru saja live di produksi.
 */

type Db = UserDbHandle["db"];

const createUnitSchema = z.object({
  code: z.string().trim().min(1, strings.common.requiredField),
  name: z.string().trim().min(1, strings.common.requiredField),
  baseUnit: z.string().trim().min(1, strings.common.requiredField),
  factor: z.coerce.number().positive(strings.units.factorMustBePositive),
});

const updateUnitSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, strings.common.requiredField),
  baseUnit: z.string().trim().min(1, strings.common.requiredField),
  factor: z.coerce.number().positive(strings.units.factorMustBePositive),
});

export type UnitActionResult = {
  error?: string;
  success?: { unitId: string };
};

export async function createUnitWithDb(
  db: Db,
  businessId: string,
  rawInput: unknown
): Promise<UnitActionResult> {
  const parsed = createUnitSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const data = parsed.data;

  const unitId = generateId();
  try {
    await db.insert(units).values({
      id: unitId,
      businessId,
      code: data.code,
      name: data.name,
      baseUnit: data.baseUnit,
      factor: String(data.factor),
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { error: strings.units.duplicateCode };
    }
    throw err;
  }

  return { success: { unitId } };
}

export async function updateUnitWithDb(
  db: Db,
  businessId: string,
  rawInput: unknown
): Promise<UnitActionResult> {
  const parsed = updateUnitSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const data = parsed.data;

  await db
    .update(units)
    .set({ name: data.name, baseUnit: data.baseUnit, factor: String(data.factor) })
    .where(and(eq(units.id, data.id), eq(units.businessId, businessId)));

  return { success: { unitId: data.id } };
}

const deleteSchema = z.object({ id: z.string().uuid() });

/**
 * Hapus permanen -- HANYA kalau belum dipakai sebagai base_unit ATAU
 * purchase_unit ingredient manapun. Dicocokkan lewat code (teks), bukan
 * FK. Cek + delete dalam SATU transaksi supaya tidak ada celah TOCTOU
 * antara pengecekan dan penghapusan.
 */
export async function deleteUnitWithDb(
  db: Db,
  businessId: string,
  rawInput: unknown
): Promise<UnitActionResult> {
  const parsed = deleteSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const { id } = parsed.data;

  try {
    await db.transaction(async (tx) => {
      const [unitRow] = await tx
        .select({ code: units.code })
        .from(units)
        .where(and(eq(units.id, id), eq(units.businessId, businessId)));
      if (!unitRow) {
        // Sudah terhapus/tidak ada -- perlakukan sebagai berhasil (idempoten),
        // sama seperti pola delete di entitas lain yang tidak membedakan
        // "0 baris terhapus" dari "berhasil".
        return;
      }

      const referencing = await tx
        .select({ id: ingredients.id })
        .from(ingredients)
        .where(
          and(
            eq(ingredients.businessId, businessId),
            or(
              eq(ingredients.baseUnit, unitRow.code),
              eq(ingredients.purchaseUnit, unitRow.code)
            )
          )
        );
      if (referencing.length > 0) {
        throw new DeleteBlockedError(
          strings.units.deleteBlockedIngredients.replace(
            "{count}",
            String(referencing.length)
          )
        );
      }

      await tx.delete(units).where(and(eq(units.id, id), eq(units.businessId, businessId)));
    });
  } catch (err) {
    if (err instanceof DeleteBlockedError) {
      return { error: err.message };
    }
    throw err;
  }

  return { success: { unitId: id } };
}
