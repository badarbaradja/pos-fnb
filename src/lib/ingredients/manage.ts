import { z } from "zod";
import { and, count, eq, inArray } from "drizzle-orm";
import type { UserDbHandle } from "@/lib/db/client";
import { ingredients, stockLevels, stockMovements, units } from "@/lib/db/schema";
import { assertRowsAffected, DeleteBlockedError, isUniqueViolation } from "@/lib/db/errors";
import { generateId } from "@/lib/utils/id";
import { id as strings } from "@/lib/i18n/id";

/**
 * lib/ingredients/manage.ts — T21 commit 2/2. base_unit, purchase_unit,
 * purchase_factor WAJIB diisi bersamaan (satu grup di schema Zod, tidak ada
 * yang opsional) -- salah satuan/faktor adalah tersangka utama desync 90%
 * Indokopi (docs/05-RENCANA-FASE-2.md §1). base_unit/purchase_unit divalidasi
 * di SERVER terhadap tabel `units` bisnis ini (bukan cuma dropdown di UI --
 * client bisa dilewati), supaya nilainya tidak pernah jadi teks bebas yang
 * tidak cocok kode satuan mana pun.
 *
 * `code` (beda dari units.code) BOLEH diubah kapan saja -- tidak ada tabel
 * lain yang mencocokkan teksnya untuk identitas (stock_movements/
 * stock_levels merujuk lewat ingredients.id/UUID, bukan code).
 *
 * `base_unit` HANYA boleh diubah kalau ingredient ini belum punya
 * stock_movement apa pun. Alasannya beda dari code: stock_movements TIDAK
 * menyimpan label satuan per baris (cuma angka qty polos, snapshot
 * BLUEPRINT §3.3) -- ia bergantung sepenuhnya pada ingredients.base_unit
 * tetap stabil untuk bisa dibaca ulang. Ganti base_unit setelah ada
 * pergerakan stok akan membuat SELURUH riwayat qty di kartu stok jadi
 * ambigu (tercatat sebagai angka di satuan lama, terbaca seolah di satuan
 * baru) -- tidak ada cara memperbaikinya tanpa migrasi data manual.
 * purchase_unit/purchase_factor TIDAK kena batasan ini -- keduanya cuma
 * dipakai saat ENTRI data baru (dikonversi ke base_unit sebelum ditulis ke
 * ledger), jadi mengubahnya cuma memengaruhi entri berikutnya, bukan
 * membaca ulang yang sudah tercatat.
 */

type Db = UserDbHandle["db"];

const ingredientFieldsSchema = {
  code: z.string().trim().optional(),
  name: z.string().trim().min(1, strings.common.requiredField),
  category: z.string().trim().optional(),
  baseUnit: z.string().trim().min(1, strings.common.requiredField),
  purchaseUnit: z.string().trim().min(1, strings.common.requiredField),
  purchaseFactor: z.coerce.number().positive(strings.ingredients.factorMustBePositive),
  yieldPercent: z.coerce.number().positive(strings.ingredients.yieldMustBePositive).default(100),
  isSemiFinished: z.coerce.boolean().default(false),
  shelfLifeDays: z.coerce.number().int().positive().optional(),
};

const createIngredientSchema = z.object(ingredientFieldsSchema);
const updateIngredientSchema = z.object({ id: z.string().uuid(), ...ingredientFieldsSchema });

export type IngredientActionResult = {
  error?: string;
  success?: { ingredientId: string };
};

/**
 * Cek base_unit dan purchase_unit benar-benar terdaftar sebagai units.code
 * milik bisnis ini. Dipanggil di dalam create/update -- pertahanan server,
 * bukan cuma mengandalkan dropdown di form (CLAUDE.md §3.4).
 */
async function validateUnitCodes(
  db: Db,
  businessId: string,
  baseUnit: string,
  purchaseUnit: string
): Promise<string | undefined> {
  const rows = await db
    .select({ code: units.code })
    .from(units)
    .where(and(eq(units.businessId, businessId), inArray(units.code, [baseUnit, purchaseUnit])));
  const found = new Set(rows.map((r) => r.code));

  if (!found.has(baseUnit)) {
    return strings.ingredients.baseUnitNotFound.replace("{code}", baseUnit);
  }
  if (!found.has(purchaseUnit)) {
    return strings.ingredients.purchaseUnitNotFound.replace("{code}", purchaseUnit);
  }
  return undefined;
}

export async function createIngredientWithDb(
  db: Db,
  businessId: string,
  rawInput: unknown
): Promise<IngredientActionResult> {
  const parsed = createIngredientSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const data = parsed.data;

  const unitError = await validateUnitCodes(db, businessId, data.baseUnit, data.purchaseUnit);
  if (unitError) {
    return { error: unitError };
  }

  const ingredientId = generateId();
  try {
    await db.insert(ingredients).values({
      id: ingredientId,
      businessId,
      code: data.code || null,
      name: data.name,
      category: data.category || null,
      baseUnit: data.baseUnit,
      purchaseUnit: data.purchaseUnit,
      purchaseFactor: String(data.purchaseFactor),
      yieldPercent: String(data.yieldPercent),
      isSemiFinished: data.isSemiFinished,
      shelfLifeDays: data.shelfLifeDays ?? null,
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { error: strings.ingredients.duplicateCode };
    }
    throw err;
  }

  return { success: { ingredientId } };
}

export async function updateIngredientWithDb(
  db: Db,
  businessId: string,
  rawInput: unknown
): Promise<IngredientActionResult> {
  const parsed = updateIngredientSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const data = parsed.data;

  const unitError = await validateUnitCodes(db, businessId, data.baseUnit, data.purchaseUnit);
  if (unitError) {
    return { error: unitError };
  }

  try {
    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ baseUnit: ingredients.baseUnit })
        .from(ingredients)
        .where(and(eq(ingredients.id, data.id), eq(ingredients.businessId, businessId)));
      if (!existing) {
        return;
      }

      if (existing.baseUnit !== data.baseUnit) {
        const [movementCount] = await tx
          .select({ n: count() })
          .from(stockMovements)
          .where(eq(stockMovements.ingredientId, data.id));
        if (movementCount && movementCount.n > 0) {
          throw new DeleteBlockedError(
            strings.ingredients.baseUnitLockedAfterMovement.replace(
              "{count}",
              String(movementCount.n)
            )
          );
        }
      }

      const updated = await tx
        .update(ingredients)
        .set({
          code: data.code || null,
          name: data.name,
          category: data.category || null,
          baseUnit: data.baseUnit,
          purchaseUnit: data.purchaseUnit,
          purchaseFactor: String(data.purchaseFactor),
          yieldPercent: String(data.yieldPercent),
          isSemiFinished: data.isSemiFinished,
          shelfLifeDays: data.shelfLifeDays ?? null,
        })
        .where(and(eq(ingredients.id, data.id), eq(ingredients.businessId, businessId)))
        .returning({ id: ingredients.id });
      assertRowsAffected(updated, "bahan");
    });

    return { success: { ingredientId: data.id } };
  } catch (err) {
    if (err instanceof DeleteBlockedError) {
      return { error: err.message };
    }
    if (isUniqueViolation(err)) {
      return { error: strings.ingredients.duplicateCode };
    }
    throw err;
  }
}

const setActiveSchema = z.object({ id: z.string().uuid(), isActive: z.boolean() });

const setHitungTiapShiftSchema = z.object({
  id: z.string().uuid(),
  hitungTiapShift: z.boolean(),
});

/**
 * Rencana Revisi 24 September 2026 §7 poin 4 -- centang "hitung tiap shift"
 * di halaman Bahan yang sudah ada (BUKAN halaman baru). Daftar pendek ini
 * (bukan 225 bahan) yang menentukan bahan mana masuk opname 'buka'/'tutup'
 * per shift -- lihat lib/stock-opnames/shift-opname.ts
 * getFlaggedIngredientIds().
 */
export async function setIngredientHitungTiapShiftWithDb(
  db: Db,
  businessId: string,
  rawInput: unknown
): Promise<IngredientActionResult> {
  const parsed = setHitungTiapShiftSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const { id, hitungTiapShift } = parsed.data;

  const updated = await db
    .update(ingredients)
    .set({ hitungTiapShift })
    .where(and(eq(ingredients.id, id), eq(ingredients.businessId, businessId)))
    .returning({ id: ingredients.id });
  assertRowsAffected(updated, "bahan");

  return { success: { ingredientId: id } };
}

/**
 * Bahan TIDAK PERNAH dihapus lewat jalur ini (master data, CLAUDE.md §3.2),
 * cuma disembunyikan dari pemilihan resep/entri stok baru -- tetap bisa
 * ditelusuri di kartu stok/riwayat lama.
 */
export async function setIngredientActiveWithDb(
  db: Db,
  businessId: string,
  rawInput: unknown
): Promise<IngredientActionResult> {
  const parsed = setActiveSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const { id, isActive } = parsed.data;

  const updated = await db
    .update(ingredients)
    .set({ isActive })
    .where(and(eq(ingredients.id, id), eq(ingredients.businessId, businessId)))
    .returning({ id: ingredients.id });
  assertRowsAffected(updated, "bahan");

  return { success: { ingredientId: id } };
}

const deleteSchema = z.object({ id: z.string().uuid() });

/**
 * Hapus permanen -- HANYA kalau belum pernah dipakai di stock_movements
 * ATAU stock_levels manapun. Cek + delete dalam SATU transaksi.
 */
export async function deleteIngredientWithDb(
  db: Db,
  businessId: string,
  rawInput: unknown
): Promise<IngredientActionResult> {
  const parsed = deleteSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const { id } = parsed.data;

  try {
    await db.transaction(async (tx) => {
      const [movementCount] = await tx
        .select({ n: count() })
        .from(stockMovements)
        .where(eq(stockMovements.ingredientId, id));
      if (movementCount && movementCount.n > 0) {
        throw new DeleteBlockedError(
          strings.ingredients.deleteBlockedMovements.replace(
            "{count}",
            String(movementCount.n)
          )
        );
      }

      const [levelRow] = await tx
        .select({ ingredientId: stockLevels.ingredientId })
        .from(stockLevels)
        .where(eq(stockLevels.ingredientId, id));
      if (levelRow) {
        throw new DeleteBlockedError(strings.ingredients.deleteBlockedStockLevels);
      }

      const deleted = await tx
        .delete(ingredients)
        .where(and(eq(ingredients.id, id), eq(ingredients.businessId, businessId)))
        .returning({ id: ingredients.id });
      assertRowsAffected(deleted, "bahan");
    });
  } catch (err) {
    if (err instanceof DeleteBlockedError) {
      return { error: err.message };
    }
    throw err;
  }

  return { success: { ingredientId: id } };
}
