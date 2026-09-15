import { z } from "zod";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { UserDbHandle } from "@/lib/db/client";
import { categories, ingredients, products, recipeItems, recipes } from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";
import { id as strings } from "@/lib/i18n/id";

/**
 * lib/recipes/manage.ts — Langkah B2 (15 September 2026).
 *
 * Resep di sini HANYA untuk product_id (+ variant_id opsional) -- jalur
 * output_ingredient_id (sub-resep semi-finished gudang, T22c di
 * docs/05-RENCANA-FASE-2.md) sengaja BELUM dilayani modul ini, itu
 * pekerjaan terpisah yang belum diminta.
 *
 * Saving dengan items KOSONG = hapus resep sepenuhnya (kembali ke keadaan
 * "produk ini belum punya resep"), BUKAN menyimpan baris recipes kosong --
 * "tidak ada resep" dan "resep dengan nol bahan" adalah keadaan yang sama
 * secara fungsional (poin 3, Langkah B), jadi tidak perlu direpresentasikan
 * sebagai dua baris berbeda.
 *
 * Potong stok saat bayar (B3) SENGAJA belum disambungkan di sini --
 * menunggu Langkah C (stock opname) selesai lebih dulu, per keputusan CEO.
 * Modul ini murni CRUD definisi resep.
 */

type Db = UserDbHandle["db"];

export type RecipeOverviewRow = {
  productId: string;
  name: string;
  categoryName: string | null;
  hasRecipe: boolean;
  itemCount: number;
};

/** Daftar semua produk aktif + status resepnya, untuk panel daftar di /recipes. */
export async function getRecipesOverview(db: Db, businessId: string): Promise<RecipeOverviewRow[]> {
  const productRows = await db
    .select({
      id: products.id,
      name: products.name,
      categoryName: categories.name,
    })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(and(eq(products.businessId, businessId), eq(products.isActive, true)))
    .orderBy(asc(products.name));

  const recipeRows = await db
    .select({ id: recipes.id, productId: recipes.productId })
    .from(recipes)
    .where(and(eq(recipes.businessId, businessId), eq(recipes.isActive, true)));
  const recipeIdByProduct = new Map(
    recipeRows.filter((r) => r.productId !== null).map((r) => [r.productId as string, r.id])
  );

  const recipeIds = [...recipeIdByProduct.values()];
  const itemCountRows = recipeIds.length
    ? await db
        .select({ recipeId: recipeItems.recipeId, ingredientId: recipeItems.ingredientId })
        .from(recipeItems)
        .where(inArray(recipeItems.recipeId, recipeIds))
    : [];
  const itemCountByRecipe = new Map<string, number>();
  for (const row of itemCountRows) {
    itemCountByRecipe.set(row.recipeId, (itemCountByRecipe.get(row.recipeId) ?? 0) + 1);
  }

  return productRows.map((p) => {
    const recipeId = recipeIdByProduct.get(p.id);
    return {
      productId: p.id,
      name: p.name,
      categoryName: p.categoryName,
      hasRecipe: recipeId !== undefined,
      itemCount: recipeId !== undefined ? (itemCountByRecipe.get(recipeId) ?? 0) : 0,
    };
  });
}

export type IngredientOption = { id: string; name: string; baseUnit: string };

/** Daftar bahan aktif untuk pencarian di pemilih bahan pada panel resep. */
export async function getIngredientOptions(db: Db, businessId: string): Promise<IngredientOption[]> {
  const rows = await db
    .select({ id: ingredients.id, name: ingredients.name, baseUnit: ingredients.baseUnit })
    .from(ingredients)
    .where(and(eq(ingredients.businessId, businessId), eq(ingredients.isActive, true)))
    .orderBy(asc(ingredients.name));
  return rows;
}

export type RecipeItemDetail = {
  id: string;
  ingredientId: string;
  ingredientName: string;
  baseUnit: string;
  qty: string;
  isOptional: boolean;
  wastePercent: string;
};

export type RecipeDetail = { recipeId: string | null; items: RecipeItemDetail[] };

/** Isi resep satu produk (kosong kalau belum pernah diisi). */
export async function getRecipeDetail(
  db: Db,
  businessId: string,
  productId: string
): Promise<RecipeDetail> {
  const [recipe] = await db
    .select({ id: recipes.id })
    .from(recipes)
    .where(
      and(
        eq(recipes.businessId, businessId),
        eq(recipes.productId, productId),
        eq(recipes.isActive, true)
      )
    );
  if (!recipe) {
    return { recipeId: null, items: [] };
  }

  const items = await db
    .select({
      id: recipeItems.id,
      ingredientId: recipeItems.ingredientId,
      ingredientName: ingredients.name,
      baseUnit: ingredients.baseUnit,
      qty: recipeItems.qty,
      isOptional: recipeItems.isOptional,
      wastePercent: recipeItems.wastePercent,
    })
    .from(recipeItems)
    .innerJoin(ingredients, eq(recipeItems.ingredientId, ingredients.id))
    .where(eq(recipeItems.recipeId, recipe.id))
    .orderBy(asc(ingredients.name));

  return { recipeId: recipe.id, items };
}

const recipeItemInputSchema = z.object({
  ingredientId: z.string().uuid(),
  qty: z.coerce.number().positive(strings.recipes.qtyMustBePositive),
  isOptional: z.boolean().default(false),
  wastePercent: z.coerce.number().min(0, strings.recipes.wastePercentMustBeNonNegative).default(0),
});

const saveRecipeSchema = z.object({
  productId: z.string().uuid(),
  items: z.array(recipeItemInputSchema),
});

export type SaveRecipeResult = {
  error?: string;
  success?: { recipeId: string | null; itemCount: number };
};

/**
 * Simpan resep satu produk -- ganti SELURUH baris recipe_items (bukan
 * diff/patch): panel resep selalu mengirim daftar lengkap bahan resep saat
 * ini, jadi hapus-semua-lalu-tulis-ulang di satu transaksi lebih sederhana
 * dan sama benarnya dengan diff, karena recipe_items tidak pernah
 * direferensikan tabel lain (beda dari order_items yang harus dipertahankan
 * ID-nya untuk refund).
 */
export async function saveRecipeWithDb(
  db: Db,
  businessId: string,
  rawInput: unknown
): Promise<SaveRecipeResult> {
  const parsed = saveRecipeSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const data = parsed.data;

  const seenIngredientIds = new Set<string>();
  for (const item of data.items) {
    if (seenIngredientIds.has(item.ingredientId)) {
      return { error: strings.recipes.duplicateIngredient };
    }
    seenIngredientIds.add(item.ingredientId);
  }

  const [product] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.id, data.productId), eq(products.businessId, businessId)));
  if (!product) {
    return { error: strings.common.unexpectedError };
  }

  if (data.items.length > 0) {
    const ingredientIds = [...seenIngredientIds];
    const ownIngredients = await db
      .select({ id: ingredients.id })
      .from(ingredients)
      .where(and(eq(ingredients.businessId, businessId), inArray(ingredients.id, ingredientIds)));
    if (ownIngredients.length !== ingredientIds.length) {
      return { error: strings.common.unexpectedError };
    }
  }

  let recipeId: string | null = null;

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: recipes.id })
      .from(recipes)
      .where(and(eq(recipes.businessId, businessId), eq(recipes.productId, data.productId)));

    if (data.items.length === 0) {
      if (existing) {
        await tx.delete(recipes).where(eq(recipes.id, existing.id));
      }
      return;
    }

    if (existing) {
      recipeId = existing.id;
      await tx.update(recipes).set({ isActive: true }).where(eq(recipes.id, recipeId));
      await tx.delete(recipeItems).where(eq(recipeItems.recipeId, recipeId));
    } else {
      recipeId = generateId();
      await tx.insert(recipes).values({ id: recipeId, businessId, productId: data.productId });
    }

    await tx.insert(recipeItems).values(
      data.items.map((item) => ({
        id: generateId(),
        recipeId: recipeId!,
        businessId,
        ingredientId: item.ingredientId,
        qty: String(item.qty),
        isOptional: item.isOptional,
        wastePercent: String(item.wastePercent),
      }))
    );
  });

  return { success: { recipeId, itemCount: data.items.length } };
}
