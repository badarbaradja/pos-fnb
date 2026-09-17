import { and, eq, inArray } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import { Decimal } from "decimal.js";
import type { UserDbHandle } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { ingredients, modifiers, recipeItems, recipes, stockLevels, stockMovements } from "@/lib/db/schema";
import { calculateRecipeCost, type IngredientCatalog, type RecipeLine } from "@/lib/calc/cogs";
import { generateId } from "@/lib/utils/id";

/**
 * lib/pos/stock-deduction.ts — Langkah B3-B5 (17 September 2026).
 *
 * SATU mekanisme untuk semua jenis produk (simple/recipe/service) --
 * keberadaan baris `recipes` aktif untuk (productId, variantId) adalah
 * SATU-SATUNYA sumber kebenaran "potong stok atau tidak". productType
 * TIDAK PERNAH dibaca di sini (docs/RENCANA-PEMBANGUNAN-KASIR-THRIFTING.md
 * §38 -- productType murni tampilan/filter di /recipes).
 *
 * Precedence resep per baris: recipe dengan variant_id yang cocok PERSIS
 * (kalau baris punya variantId) lebih diutamakan daripada recipe umum
 * (variant_id null) untuk product_id yang sama. Tidak ada recipe aktif
 * sama sekali untuk kombinasi itu -> baris dilewati sepenuhnya (produk
 * tanpa resep tetap bisa dijual, HPP tetap "0", poin 3 Langkah B).
 *
 * Ingredient semi-finished (recipe.output_ingredient_id, T22c) SENGAJA
 * belum ditangani rekursif di sini -- tidak ada satu pun dari 225 bahan
 * hasil Langkah A yang ditandai is_semi_finished, jadi resolusi
 * sub-resep rekursif belum punya data nyata untuk diuji. Kalau
 * ingredient semi-finished ditemukan di sebuah recipe_item, cost-nya
 * jatuh ke avg_cost apa adanya (tidak dihitung ulang dari sub-resep) --
 * ini keterbatasan yang diketahui, bukan bug tersembunyi.
 */

type Db = UserDbHandle["db"];
// Tipe callback db.transaction() -- BEDA dari Db (PostgresJsDatabase punya
// $client, transaksi tidak). Fungsi yang menulis movement (dipanggil DI
// DALAM transaksi order/void/refund) butuh tipe ini, bukan Db.
type Tx = PgTransaction<
  PostgresJsQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;
// Query baca-saja (load*) dipanggil SEBELUM transaksi dimulai, jadi
// menerima keduanya -- union, bukan salah satu.
type ReadableDb = Db | Tx;

// ---------------------------------------------------------------------
// Pemuatan resep aktif (batch, dipanggil sekali per order)
// ---------------------------------------------------------------------

export type ActiveRecipeItem = {
  ingredientId: string;
  ingredientName: string;
  baseUnit: string;
  qty: string; // per satu unit produk (recipes.output_qty diasumsikan 1 untuk resep produk biasa)
  wastePercent: string;
  yieldPercent: string;
  isSemiFinished: boolean;
};

export type ActiveRecipe = {
  recipeId: string;
  overheadCost: string;
  outputQty: string;
  items: ActiveRecipeItem[];
};

/**
 * Muat resep aktif untuk sekumpulan (productId, variantId) SEKALIGUS
 * (satu query, bukan N+1) -- dipanggil sekali di awal payOrderWithDb
 * sebelum masuk transaksi menulis.
 */
export async function loadActiveRecipes(
  db: ReadableDb,
  businessId: string,
  pairs: { productId: string; variantId: string | null }[]
): Promise<Map<string, ActiveRecipe | null>> {
  const productIds = [...new Set(pairs.map((p) => p.productId))];
  if (productIds.length === 0) return new Map();

  const recipeRows = await db
    .select({
      id: recipes.id,
      productId: recipes.productId,
      variantId: recipes.variantId,
      overheadCost: recipes.overheadCost,
      outputQty: recipes.outputQty,
    })
    .from(recipes)
    .where(
      and(
        eq(recipes.businessId, businessId),
        eq(recipes.isActive, true),
        inArray(recipes.productId, productIds)
      )
    );

  const recipeIds = recipeRows.map((r) => r.id);
  const itemRows = recipeIds.length
    ? await db
        .select({
          recipeId: recipeItems.recipeId,
          ingredientId: recipeItems.ingredientId,
          qty: recipeItems.qty,
          wastePercent: recipeItems.wastePercent,
          ingredientName: ingredients.name,
          baseUnit: ingredients.baseUnit,
          yieldPercent: ingredients.yieldPercent,
          isSemiFinished: ingredients.isSemiFinished,
        })
        .from(recipeItems)
        .innerJoin(ingredients, eq(recipeItems.ingredientId, ingredients.id))
        .where(inArray(recipeItems.recipeId, recipeIds))
    : [];

  const itemsByRecipe = new Map<string, ActiveRecipeItem[]>();
  for (const row of itemRows) {
    const list = itemsByRecipe.get(row.recipeId) ?? [];
    list.push({
      ingredientId: row.ingredientId,
      ingredientName: row.ingredientName,
      baseUnit: row.baseUnit,
      qty: row.qty,
      wastePercent: row.wastePercent,
      yieldPercent: row.yieldPercent,
      isSemiFinished: row.isSemiFinished,
    });
    itemsByRecipe.set(row.recipeId, list);
  }

  // Dua peta: recipe khusus per varian, dan recipe umum (variant_id null)
  // per produk -- precedence diselesaikan per pair di bawah.
  const specificByKey = new Map<string, (typeof recipeRows)[number]>();
  const generalByProduct = new Map<string, (typeof recipeRows)[number]>();
  for (const r of recipeRows) {
    // r.productId tidak pernah null di sini -- query di atas memfilter
    // inArray(recipes.productId, productIds), jadi baris yang lolos SUDAH
    // pasti punya productId non-null. TypeScript tidak bisa menyimpulkan
    // itu dari bentuk query, jadi diverifikasi eksplisit (bukan `!`).
    if (!r.productId) continue;
    if (r.variantId) {
      specificByKey.set(`${r.productId}::${r.variantId}`, r);
    } else {
      generalByProduct.set(r.productId, r);
    }
  }

  const result = new Map<string, ActiveRecipe | null>();
  for (const pair of pairs) {
    const key = `${pair.productId}::${pair.variantId ?? ""}`;
    if (result.has(key)) continue;
    const matched =
      (pair.variantId ? specificByKey.get(`${pair.productId}::${pair.variantId}`) : undefined) ??
      generalByProduct.get(pair.productId);
    if (!matched) {
      result.set(key, null);
      continue;
    }
    result.set(key, {
      recipeId: matched.id,
      overheadCost: matched.overheadCost,
      outputQty: matched.outputQty,
      items: itemsByRecipe.get(matched.id) ?? [],
    });
  }
  return result;
}

export function recipeLineKey(productId: string, variantId: string | null): string {
  return `${productId}::${variantId ?? ""}`;
}

// ---------------------------------------------------------------------
// Penerapan satu movement stok (dipakai untuk sale, refund_in, void restock)
// ---------------------------------------------------------------------

export type StockWarning = { ingredientId: string; ingredientName: string; resultingQty: string };

/**
 * Tulis SATU stock_movement + update/insert stock_levels, dengan
 * SELECT ... FOR UPDATE lebih dulu -- pola PERSIS stock-transfers/manage.ts
 * dan stock-opnames/manage.ts. `qtySigned` POSITIF untuk masuk (refund_in),
 * NEGATIF untuk keluar (sale). Untuk keluar, unit_cost SELALU avg_cost
 * saat ini (bukan nilai baru) -- menjual/mengurangi stok tidak pernah
 * mengubah avg_cost sendiri, cuma qty-nya (WAC standar). Untuk masuk
 * (refund_in), pola sama transfer_in: costMasuk = avg_cost saat ini juga
 * (restock mengembalikan bahan pada nilai yang sama saat dijual, bukan
 * harga baru) -- TIDAK memakai calculateNewAvgCost dengan cost baru,
 * karena refund bukan pembelian baru.
 *
 * Balik avg_cost SEBELUM movement ini (untuk dipakai kalkulasi HPP di
 * pemanggil) sekaligus balance sesudahnya (untuk peringatan stok minus).
 */
async function applyStockMovement(
  tx: Tx,
  params: {
    businessId: string;
    outletId: string;
    ingredientId: string;
    qtySigned: Decimal;
    movementType: "sale" | "refund_in";
    refId: string;
    businessDate: string;
    createdBy: string | null;
    note?: string | null;
  }
): Promise<{ avgCostBefore: Decimal; balanceAfter: Decimal }> {
  const [level] = await tx
    .select({ qtyOnHand: stockLevels.qtyOnHand, avgCost: stockLevels.avgCost })
    .from(stockLevels)
    .where(and(eq(stockLevels.ingredientId, params.ingredientId), eq(stockLevels.outletId, params.outletId)))
    .for("update");

  const qtyLama = level ? new Decimal(level.qtyOnHand) : new Decimal(0);
  const avgCostBefore = level ? new Decimal(level.avgCost) : new Decimal(0);
  const balanceAfter = qtyLama.plus(params.qtySigned);
  // avg_cost TIDAK PERNAH berubah akibat sale/refund_in -- keduanya
  // memindahkan qty pada cost yang SUDAH ada, bukan memasukkan cost baru.
  // (Kalau balance jadi <=0, tetap avgCostBefore -- konsisten dengan
  // calculateNewAvgCost yang reset ke costMasuk, dan di sini costMasuk =
  // avgCostBefore juga.)
  const avgCostAfter = avgCostBefore;
  const totalCost = params.qtySigned.times(avgCostBefore);

  await tx.insert(stockMovements).values({
    id: generateId(),
    businessId: params.businessId,
    outletId: params.outletId,
    ingredientId: params.ingredientId,
    movementType: params.movementType,
    qty: params.qtySigned.toFixed(4),
    unitCost: avgCostBefore.toFixed(8),
    totalCost: totalCost.toFixed(2),
    balanceAfter: balanceAfter.toFixed(4),
    avgCostAfter: avgCostAfter.toFixed(8),
    refType: "order",
    refId: params.refId,
    businessDate: params.businessDate,
    note: params.note ?? null,
    createdBy: params.createdBy,
  });

  if (level) {
    await tx
      .update(stockLevels)
      .set({ qtyOnHand: balanceAfter.toFixed(4), avgCost: avgCostAfter.toFixed(8) })
      .where(and(eq(stockLevels.ingredientId, params.ingredientId), eq(stockLevels.outletId, params.outletId)));
  } else {
    await tx.insert(stockLevels).values({
      businessId: params.businessId,
      ingredientId: params.ingredientId,
      outletId: params.outletId,
      qtyOnHand: balanceAfter.toFixed(4),
      avgCost: avgCostAfter.toFixed(8),
    });
  }

  return { avgCostBefore, balanceAfter };
}

// ---------------------------------------------------------------------
// B3: potong stok saat bayar + hitung unitCogs
// ---------------------------------------------------------------------

export type DeductResult = { unitCogs: Decimal; warnings: StockWarning[] };

/**
 * Potong stok untuk SATU baris order sesuai resepnya (kalau ada), lalu
 * hitung unitCogs (HPP per satu unit produk) dari avg_cost SAAT INI
 * (sebelum movement ini -- tidak berubah oleh movement `sale`, jadi
 * sama saja dipakai sebelum atau sesudah). Dipanggil di dalam transaksi
 * order yang sama, SEKUENSIAL per baris (bukan Promise.all) -- kalau dua
 * baris memakai bahan yang sama, baris kedua HARUS melihat saldo hasil
 * baris pertama, bukan snapshot sebelum transaksi.
 *
 * Stok tidak cukup TIDAK PERNAH melempar/menolak -- movement tetap
 * ditulis walau balance_after negatif, dikumpulkan ke `warnings` untuk
 * ditampilkan SETELAH struk (§4 alasan sama "stok minus tidak memblokir
 * penjualan").
 */
export async function deductStockForOrderLine(
  tx: Tx,
  params: {
    businessId: string;
    outletId: string;
    orderId: string;
    businessDate: string;
    createdBy: string | null;
    recipe: ActiveRecipe | null;
    lineQty: Decimal;
  }
): Promise<DeductResult> {
  if (!params.recipe || params.recipe.items.length === 0) {
    return { unitCogs: new Decimal(0), warnings: [] };
  }

  const warnings: StockWarning[] = [];
  const catalog: IngredientCatalog = {};
  const recipeLines: RecipeLine[] = [];

  for (const item of params.recipe.items) {
    const recipeQty = new Decimal(item.qty);
    const wasteRate = new Decimal(item.wastePercent).dividedBy(100);
    const consumedQty = recipeQty.times(new Decimal(1).plus(wasteRate)).times(params.lineQty);

    const { avgCostBefore, balanceAfter } = await applyStockMovement(tx, {
      businessId: params.businessId,
      outletId: params.outletId,
      ingredientId: item.ingredientId,
      qtySigned: consumedQty.negated(),
      movementType: "sale",
      refId: params.orderId,
      businessDate: params.businessDate,
      createdBy: params.createdBy,
    });

    if (balanceAfter.isNegative()) {
      warnings.push({
        ingredientId: item.ingredientId,
        ingredientName: item.ingredientName,
        resultingQty: balanceAfter.toFixed(4),
      });
    }

    // Ingredient semi-finished: cost dipakai apa adanya (avg_cost), TIDAK
    // diresolusi rekursif dari sub-resepnya -- lihat catatan di atas file.
    catalog[item.ingredientId] = { name: item.ingredientName, isSemiFinished: false, avgCost: avgCostBefore };
    recipeLines.push({
      ingredientId: item.ingredientId,
      recipeQty,
      prepWasteRate: wasteRate,
      yieldRate: new Decimal(item.yieldPercent).dividedBy(100),
    });
  }

  const unitCogs = calculateRecipeCost(
    recipeLines,
    new Decimal(params.recipe.overheadCost),
    new Decimal(params.recipe.outputQty),
    catalog
  );

  return { unitCogs, warnings };
}

// ---------------------------------------------------------------------
// B5: konsumsi bahan dari modifier
// ---------------------------------------------------------------------

export type ModifierIngredient = { ingredientId: string; ingredientQty: string } | null;

export async function loadModifierIngredients(
  db: ReadableDb,
  modifierIds: string[]
): Promise<Map<string, ModifierIngredient>> {
  if (modifierIds.length === 0) return new Map();
  const rows = await db
    .select({ id: modifiers.id, ingredientId: modifiers.ingredientId, ingredientQty: modifiers.ingredientQty })
    .from(modifiers)
    .where(inArray(modifiers.id, modifierIds));
  const result = new Map<string, ModifierIngredient>();
  for (const row of rows) {
    result.set(
      row.id,
      row.ingredientId && row.ingredientQty ? { ingredientId: row.ingredientId, ingredientQty: row.ingredientQty } : null
    );
  }
  return result;
}

/**
 * Potong stok untuk SATU modifier terpilih pada satu baris order (kalau
 * modifier itu punya ingredient_id+ingredient_qty terisi -- kalau tidak,
 * tidak melakukan apa pun). Konsumsi ikut skala qty baris, sama seperti
 * modifierTotal (harga) yang juga ikut terkali qty di calculateOrder().
 * Balik unitCogs modifier ini (ingredientQty x avg_cost) untuk disimpan
 * di order_item_modifiers.unit_cogs.
 */
export async function deductStockForModifier(
  tx: Tx,
  params: {
    businessId: string;
    outletId: string;
    orderId: string;
    businessDate: string;
    createdBy: string | null;
    ingredient: ModifierIngredient;
    lineQty: Decimal;
  }
): Promise<{ unitCogs: Decimal; warning: StockWarning | null }> {
  if (!params.ingredient) {
    return { unitCogs: new Decimal(0), warning: null };
  }

  const [ingredientRow] = await tx
    .select({ name: ingredients.name })
    .from(ingredients)
    .where(eq(ingredients.id, params.ingredient.ingredientId));
  const ingredientName = ingredientRow?.name ?? params.ingredient.ingredientId;

  const perUnitQty = new Decimal(params.ingredient.ingredientQty);
  const consumedQty = perUnitQty.times(params.lineQty);

  const { avgCostBefore, balanceAfter } = await applyStockMovement(tx, {
    businessId: params.businessId,
    outletId: params.outletId,
    ingredientId: params.ingredient.ingredientId,
    qtySigned: consumedQty.negated(),
    movementType: "sale",
    refId: params.orderId,
    businessDate: params.businessDate,
    createdBy: params.createdBy,
  });

  return {
    unitCogs: perUnitQty.times(avgCostBefore),
    warning: balanceAfter.isNegative()
      ? { ingredientId: params.ingredient.ingredientId, ingredientName, resultingQty: balanceAfter.toFixed(4) }
      : null,
  };
}

// ---------------------------------------------------------------------
// B4: restock (void/refund) -- kebalikan dari deductStockForOrderLine
// ---------------------------------------------------------------------

/**
 * Kembalikan stok untuk qty tertentu dari SATU order_item, pakai resep
 * AKTIF SAAT INI (bukan snapshot resep yang dipakai saat jual -- sistem
 * ini tidak menyimpan breakdown ingredient per order_item, cuma angka
 * HPP agregat yang sudah dibekukan di order_items.unit_cogs). Kalau
 * resepnya sudah dihapus/diubah sejak saat jual, restock ini pakai
 * resep yang ADA SEKARANG -- keterbatasan yang diketahui, bukan bug
 * tersembunyi (dicatat eksplisit di plan doc). Produk tanpa resep aktif
 * sekarang -> tidak ada apa pun untuk direstock, dilewati diam-diam
 * (simetris dengan "produk tanpa resep tidak memotong stok saat jual").
 */
export async function restockForOrderItem(
  tx: Tx,
  params: {
    businessId: string;
    outletId: string;
    orderId: string;
    businessDate: string;
    createdBy: string | null;
    recipe: ActiveRecipe | null;
    qty: Decimal;
    reasonNote: string;
  }
): Promise<void> {
  if (!params.recipe || params.recipe.items.length === 0) return;

  for (const item of params.recipe.items) {
    const recipeQty = new Decimal(item.qty);
    const wasteRate = new Decimal(item.wastePercent).dividedBy(100);
    const restoredQty = recipeQty.times(new Decimal(1).plus(wasteRate)).times(params.qty);
    if (restoredQty.isZero()) continue;

    await applyStockMovement(tx, {
      businessId: params.businessId,
      outletId: params.outletId,
      ingredientId: item.ingredientId,
      qtySigned: restoredQty,
      movementType: "refund_in",
      refId: params.orderId,
      businessDate: params.businessDate,
      createdBy: params.createdBy,
      note: params.reasonNote,
    });
  }
}
