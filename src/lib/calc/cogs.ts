import { Decimal, round2 } from "../utils/money";

/**
 * HPP / COGS — CALC-SPEC bagian B. Fungsi murni: tanpa akses database, tanpa
 * fetch, tanpa Date.now().
 *
 * PENTING: `wastePercent` dan `yieldPercent` di bawah adalah ANGKA PERSEN
 * POLOS (3 = 3%, 100 = 100%), BUKAN pecahan — kebalikan dari `CalcSettings.*Percent`
 * di order-calculator.ts (yang pecahan, 0.10 = 10%). Ini konsekuensi langsung
 * dari rumus B.1 yang memakai "/100" eksplisit, beda dari rumus A.3 yang tidak.
 */

const ZERO = new Decimal(0);
const HUNDRED = new Decimal(100);
const MAX_RECIPE_DEPTH = 5;

export type RecipeLine = {
  ingredientId: string;
  recipeQty: Decimal;
  wastePercent: Decimal; // ANGKA PERSEN (3 = 3%)
  yieldPercent: Decimal; // ANGKA PERSEN (100 = 100%)
};

export type IngredientCost =
  | { name: string; isSemiFinished: false; avgCost: Decimal }
  | {
      name: string;
      isSemiFinished: true;
      recipe: RecipeLine[];
      overheadCost: Decimal;
      outputQty: Decimal;
    };

/**
 * Katalog bahan sudah ter-resolve penuh (id -> definisi), disiapkan oleh
 * pemanggil dari database sebelum memanggil calculateRecipeCost(). Supaya
 * fungsi ini tetap murni, ia tidak pernah melakukan lookup ke luar dirinya.
 */
export type IngredientCatalog = Record<string, IngredientCost>;

/**
 * calculateRecipeCost() — CALC-SPEC B.1.
 * hppProduk = Σ lineCost + (overheadCost / outputQty)
 * Rekursif untuk bahan is_semi_finished, maksimal 5 level. Circular reference
 * dan bahan yang tidak ada di catalog melempar error yang menyebut nama/id
 * bahannya.
 */
export function calculateRecipeCost(
  recipe: RecipeLine[],
  overheadCost: Decimal,
  outputQty: Decimal,
  catalog: IngredientCatalog
): Decimal {
  return resolveRecipeCost(recipe, overheadCost, outputQty, catalog, []);
}

function resolveRecipeCost(
  recipe: RecipeLine[],
  overheadCost: Decimal,
  outputQty: Decimal,
  catalog: IngredientCatalog,
  path: string[] // ingredientId dari akar sampai level saat ini (untuk deteksi circular & kedalaman)
): Decimal {
  let total = ZERO;

  for (const line of recipe) {
    const effectiveQty = line.recipeQty.times(
      new Decimal(1).plus(line.wastePercent.dividedBy(HUNDRED))
    );

    const ingredient = catalog[line.ingredientId];
    if (!ingredient) {
      throw new Error(
        `calculateRecipeCost: bahan "${line.ingredientId}" tidak ditemukan di catalog`
      );
    }

    let baseCost: Decimal;
    if (ingredient.isSemiFinished) {
      if (path.includes(line.ingredientId)) {
        throw new Error(
          `calculateRecipeCost: circular reference terdeteksi pada bahan "${ingredient.name}" (path: ${[...path, line.ingredientId].join(" > ")})`
        );
      }
      if (path.length + 2 > MAX_RECIPE_DEPTH) {
        throw new Error(
          `calculateRecipeCost: kedalaman resep melebihi maksimal ${MAX_RECIPE_DEPTH} level pada bahan "${ingredient.name}"`
        );
      }
      // resolveRecipeCost mengembalikan TOTAL biaya untuk outputQty unit
      // (batch). Dibagi outputQty dulu supaya jadi biaya PER UNIT, karena
      // recipeQty di baris pemanggil dinyatakan dalam satuan per unit bahan
      // semi-finished ini (sama seperti avgCost bahan mentah yang per unit).
      const batchCost = resolveRecipeCost(
        ingredient.recipe,
        ingredient.overheadCost,
        ingredient.outputQty,
        catalog,
        [...path, line.ingredientId]
      );
      baseCost = batchCost.dividedBy(ingredient.outputQty);
    } else {
      baseCost = ingredient.avgCost;
    }

    const effectiveCost = baseCost.dividedBy(line.yieldPercent.dividedBy(HUNDRED));
    const lineCost = effectiveQty.times(effectiveCost);
    total = total.plus(lineCost);
  }

  return total.plus(overheadCost.dividedBy(outputQty));
}

/**
 * calculateNewAvgCost() — CALC-SPEC B.2 (Weighted Average Cost).
 * qtyLama <= 0 -> newAvgCost = costMasuk (jangan pakai rumus rata-rata, TC-11).
 */
export function calculateNewAvgCost(
  qtyLama: Decimal,
  avgCostLama: Decimal,
  qtyMasuk: Decimal,
  costMasuk: Decimal
): Decimal {
  if (qtyLama.lessThanOrEqualTo(0)) {
    return costMasuk;
  }
  return qtyLama
    .times(avgCostLama)
    .plus(qtyMasuk.times(costMasuk))
    .dividedBy(qtyLama.plus(qtyMasuk));
}

/**
 * allocateShippingCost() — CALC-SPEC B.2.
 * alokasiOngkir_i = ongkirTotal × (lineTotal_i / Σ lineTotal)
 * Baris terakhir menyerap sisa pembulatan (pola sama seperti alokasi diskon
 * di order-calculator.ts) supaya Σ alokasi === ongkirTotal persis (TC-12).
 */
export function allocateShippingCost(
  shippingTotal: Decimal,
  lineTotals: Decimal[]
): Decimal[] {
  const sum = lineTotals.reduce((s, x) => s.plus(x), ZERO);

  const allocated = lineTotals.map(() => ZERO);
  if (sum.isZero()) {
    return allocated; // jangan bagi nol
  }

  let allocatedSoFar = ZERO;
  for (let i = 0; i < lineTotals.length - 1; i++) {
    const share = round2(shippingTotal.times(lineTotals[i]!).dividedBy(sum));
    allocated[i] = share;
    allocatedSoFar = allocatedSoFar.plus(share);
  }
  const lastIndex = lineTotals.length - 1;
  if (lastIndex >= 0) {
    allocated[lastIndex] = shippingTotal.minus(allocatedSoFar);
  }

  return allocated;
}

export type VarianceUsageLine = {
  qtySold: Decimal;
  recipeQty: Decimal;
};

export type VarianceResult = {
  theoreticalUsage: Decimal;
  actualUsage: Decimal;
  varianceQty: Decimal;
  varianceValue: Decimal;
  variancePercent: Decimal | null;
};

/**
 * calculateVariance() — CALC-SPEC B.3.
 * pemakaianTeoritis = 0 -> variancePercent = null, bukan Infinity.
 */
export function calculateVariance(
  usageLines: VarianceUsageLine[],
  openingStock: Decimal,
  purchases: Decimal,
  closingStock: Decimal,
  avgCost: Decimal
): VarianceResult {
  const theoreticalUsage = usageLines.reduce(
    (sum, l) => sum.plus(l.qtySold.times(l.recipeQty)),
    ZERO
  );
  const actualUsage = openingStock.plus(purchases).minus(closingStock);
  const varianceQty = actualUsage.minus(theoreticalUsage);
  const varianceValue = varianceQty.times(avgCost);
  const variancePercent = theoreticalUsage.isZero()
    ? null
    : varianceQty.dividedBy(theoreticalUsage).times(100);

  return {
    theoreticalUsage,
    actualUsage,
    varianceQty,
    varianceValue,
    variancePercent,
  };
}
