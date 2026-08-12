/**
 * T04/T06-audit — Test untuk src/lib/calc/cogs.ts, CALC-SPEC bagian B.
 * TC-08 s/d TC-12, TC-18 pakai nilai numerik polos. Nilai ekspektasi TC-08..
 * TC-12 TIDAK BOLEH diubah. Test circular reference, kedalaman maksimal,
 * calculateVariance, dan berbagai pembagi nol ditambahkan sendiri (tidak
 * ada golden case di spec untuk kasus-kasus ini).
 *
 * Catatan desain penting (bukan tebakan bisnis, murni pembacaan literal rumus):
 *
 * 1. `prepWasteRate`/`yieldRate` adalah PECAHAN (0.03 = 3%, 1 = 100%), sama
 *    seperti CalcSettings.*Percent di order-calculator.ts. Field ini
 *    sebelumnya bernama `wasteRate`, diganti `prepWasteRate` supaya tidak
 *    bentrok nama dengan `wasteToCogsRate` di kpi.ts (konsep berbeda).
 * 2. Signature calculateRecipeCost() tidak diberikan eksplisit di CALC-SPEC
 *    (beda dari calculateOrder() yang punya A.1). Didesain menerima resep +
 *    "katalog bahan" (map id -> definisi bahan) supaya rekursi ke bahan
 *    semi-finished bisa dilakukan tanpa akses database (tetap fungsi murni) —
 *    katalog sudah harus di-resolve penuh oleh pemanggil sebelum dipanggil.
 * 3. TC-18 (di bawah): nilai presisi penuh hasil (725000-0+33105.02)/5000
 *    adalah 151.621004, bukan 151.62100 — keduanya sama kalau dibulatkan ke
 *    5 desimal (digit ke-6 adalah 4, jadi pembulatan ke bawah). calculateIncomingCost()
 *    tidak melakukan pembulatan apa pun (konsisten dengan B.1 yang juga tidak
 *    dibulatkan), jadi test ini memakai nilai presisi penuh.
 */
import { describe, it, expect } from "vitest";
import { Decimal } from "../../utils/money";
import {
  calculateRecipeCost,
  calculateNewAvgCost,
  allocateShippingCost,
  calculateIncomingCost,
  calculateVariance,
} from "../cogs";
import type { IngredientCatalog, RecipeLine } from "../cogs";

const D = (n: number) => new Decimal(n);

describe("TC-08 — HPP Caffe Latte", () => {
  it("hpp = 7858.30 dari 4 bahan mentah", () => {
    const catalog: IngredientCatalog = {
      "biji-kopi": { name: "Biji kopi", isSemiFinished: false, avgCost: D(145) },
      "susu-uht": { name: "Susu UHT", isSemiFinished: false, avgCost: D(18.5) },
      "gula-cair": { name: "Gula cair", isSemiFinished: false, avgCost: D(12) },
      "cup-lid": { name: "Cup + lid", isSemiFinished: false, avgCost: D(1350) },
    };
    const recipe: RecipeLine[] = [
      { ingredientId: "biji-kopi", recipeQty: D(18), prepWasteRate: D(0.03), yieldRate: D(1) },
      { ingredientId: "susu-uht", recipeQty: D(200), prepWasteRate: D(0), yieldRate: D(1) },
      { ingredientId: "gula-cair", recipeQty: D(10), prepWasteRate: D(0), yieldRate: D(1) },
      { ingredientId: "cup-lid", recipeQty: D(1), prepWasteRate: D(0), yieldRate: D(1) },
    ];

    const hpp = calculateRecipeCost(recipe, D(0), D(1), catalog);

    expect(hpp.toString()).toBe("7858.3");
  });
});

describe("TC-09 — yield di bawah 100%", () => {
  it("lineCost Ayam fillet = 8437.50", () => {
    const catalog: IngredientCatalog = {
      "ayam-fillet": { name: "Ayam fillet", isSemiFinished: false, avgCost: D(45) },
    };
    const recipe: RecipeLine[] = [
      {
        ingredientId: "ayam-fillet",
        recipeQty: D(150),
        prepWasteRate: D(0),
        yieldRate: D(0.8),
      },
    ];

    const lineCost = calculateRecipeCost(recipe, D(0), D(1), catalog);

    expect(lineCost.toString()).toBe("8437.5");
  });
});

describe("calculateRecipeCost — rekursi bahan semi-finished", () => {
  it("HPP bahan semi-finished dipakai sebagai avgCost di level di atasnya", () => {
    // Sirup gula: 100 sirup dari 100 gula (avgCost 12) + overhead 0 -> avgCost sirup = 12/unit
    const catalog: IngredientCatalog = {
      gula: { name: "Gula pasir", isSemiFinished: false, avgCost: D(12) },
      "sirup-gula": {
        name: "Sirup gula",
        isSemiFinished: true,
        recipe: [
          { ingredientId: "gula", recipeQty: D(100), prepWasteRate: D(0), yieldRate: D(1) },
        ],
        overheadCost: D(0),
        outputQty: D(100), // hpp per unit output sirup = (100*12)/100 = 12
      },
    };
    const recipe: RecipeLine[] = [
      {
        ingredientId: "sirup-gula",
        recipeQty: D(10),
        prepWasteRate: D(0),
        yieldRate: D(1),
      },
    ];

    const hpp = calculateRecipeCost(recipe, D(0), D(1), catalog);

    // effectiveCost sirup = 12 (hpp per unit sirup) / 1 = 12
    // lineCost = 10 * 12 = 120
    expect(hpp.toString()).toBe("120");
  });

  it("menambahkan overheadCost / outputQty produk induk", () => {
    const catalog: IngredientCatalog = {
      gula: { name: "Gula pasir", isSemiFinished: false, avgCost: D(12) },
    };
    const recipe: RecipeLine[] = [
      { ingredientId: "gula", recipeQty: D(10), prepWasteRate: D(0), yieldRate: D(1) },
    ];

    // lineCost = 10*12 = 120; overhead 50 / outputQty 5 = 10 -> hpp = 130
    const hpp = calculateRecipeCost(recipe, D(50), D(5), catalog);

    expect(hpp.toString()).toBe("130");
  });

  it("melempar error kalau bahan tidak ditemukan di katalog", () => {
    const catalog: IngredientCatalog = {};
    const recipe: RecipeLine[] = [
      { ingredientId: "tidak-ada", recipeQty: D(1), prepWasteRate: D(0), yieldRate: D(1) },
    ];

    expect(() => calculateRecipeCost(recipe, D(0), D(1), catalog)).toThrow(
      /tidak-ada/
    );
  });

  it("melempar error jelas berisi nama bahan kalau ada circular reference", () => {
    const catalog: IngredientCatalog = {
      "sirup-a": {
        name: "Sirup A",
        isSemiFinished: true,
        recipe: [
          { ingredientId: "sirup-b", recipeQty: D(1), prepWasteRate: D(0), yieldRate: D(1) },
        ],
        overheadCost: D(0),
        outputQty: D(1),
      },
      "sirup-b": {
        name: "Sirup B",
        isSemiFinished: true,
        recipe: [
          { ingredientId: "sirup-a", recipeQty: D(1), prepWasteRate: D(0), yieldRate: D(1) },
        ],
        overheadCost: D(0),
        outputQty: D(1),
      },
    };
    const recipe: RecipeLine[] = [
      { ingredientId: "sirup-a", recipeQty: D(1), prepWasteRate: D(0), yieldRate: D(1) },
    ];

    expect(() => calculateRecipeCost(recipe, D(0), D(1), catalog)).toThrow(
      /Sirup A/
    );
  });

  it("melempar error kalau resep lebih dalam dari 5 level", () => {
    // root -> L1 -> L2 -> L3 -> L4 -> L5 (level ke-6, seharusnya ditolak)
    const rawLeaf: IngredientCatalog[string] = {
      name: "Bahan mentah",
      isSemiFinished: false,
      avgCost: D(1),
    };
    const semi = (name: string, next: string): IngredientCatalog[string] => ({
      name,
      isSemiFinished: true,
      recipe: [
        { ingredientId: next, recipeQty: D(1), prepWasteRate: D(0), yieldRate: D(1) },
      ],
      overheadCost: D(0),
      outputQty: D(1),
    });

    const catalog: IngredientCatalog = {
      raw: rawLeaf,
      L5: semi("L5", "raw"),
      L4: semi("L4", "L5"),
      L3: semi("L3", "L4"),
      L2: semi("L2", "L3"),
      L1: semi("L1", "L2"),
    };
    const recipe: RecipeLine[] = [
      { ingredientId: "L1", recipeQty: D(1), prepWasteRate: D(0), yieldRate: D(1) },
    ];

    expect(() => calculateRecipeCost(recipe, D(0), D(1), catalog)).toThrow(
      /level|depth|kedalaman/i
    );
  });

  it("resep tepat 5 level tidak melempar error", () => {
    const rawLeaf: IngredientCatalog[string] = {
      name: "Bahan mentah",
      isSemiFinished: false,
      avgCost: D(1),
    };
    const semi = (name: string, next: string): IngredientCatalog[string] => ({
      name,
      isSemiFinished: true,
      recipe: [
        { ingredientId: next, recipeQty: D(1), prepWasteRate: D(0), yieldRate: D(1) },
      ],
      overheadCost: D(0),
      outputQty: D(1),
    });

    const catalog: IngredientCatalog = {
      raw: rawLeaf,
      L4: semi("L4", "raw"),
      L3: semi("L3", "L4"),
      L2: semi("L2", "L3"),
      L1: semi("L1", "L2"),
    };
    // root(1) -> L1(2) -> L2(3) -> L3(4) -> L4(5) -> raw : tepat 5 level
    const recipe: RecipeLine[] = [
      { ingredientId: "L1", recipeQty: D(1), prepWasteRate: D(0), yieldRate: D(1) },
    ];

    expect(() => calculateRecipeCost(recipe, D(0), D(1), catalog)).not.toThrow();
  });

  it("melempar error jelas kalau outputQty = 0 di level akar (bukan error generik)", () => {
    const catalog: IngredientCatalog = {
      gula: { name: "Gula pasir", isSemiFinished: false, avgCost: D(12) },
    };
    const recipe: RecipeLine[] = [
      { ingredientId: "gula", recipeQty: D(10), prepWasteRate: D(0), yieldRate: D(1) },
    ];

    expect(() => calculateRecipeCost(recipe, D(50), D(0), catalog)).toThrow(
      /outputQty/i
    );
  });

  it("melempar error jelas berisi nama bahan kalau outputQty = 0 di bahan semi-finished", () => {
    const catalog: IngredientCatalog = {
      gula: { name: "Gula pasir", isSemiFinished: false, avgCost: D(12) },
      "sirup-rusak": {
        name: "Sirup rusak",
        isSemiFinished: true,
        recipe: [
          { ingredientId: "gula", recipeQty: D(100), prepWasteRate: D(0), yieldRate: D(1) },
        ],
        overheadCost: D(0),
        outputQty: D(0), // salah data: batch tidak menghasilkan output apa pun
      },
    };
    const recipe: RecipeLine[] = [
      { ingredientId: "sirup-rusak", recipeQty: D(1), prepWasteRate: D(0), yieldRate: D(1) },
    ];

    expect(() => calculateRecipeCost(recipe, D(0), D(1), catalog)).toThrow(
      /Sirup rusak/
    );
  });

  it("melempar error jelas berisi nama bahan kalau yieldRate = 0", () => {
    const catalog: IngredientCatalog = {
      "ayam-busuk": { name: "Ayam fillet", isSemiFinished: false, avgCost: D(45) },
    };
    const recipe: RecipeLine[] = [
      {
        ingredientId: "ayam-busuk",
        recipeQty: D(150),
        prepWasteRate: D(0),
        yieldRate: D(0), // salah data: yield 0% tidak masuk akal, tapi jangan diam-diam bagi nol
      },
    ];

    expect(() => calculateRecipeCost(recipe, D(0), D(1), catalog)).toThrow(
      /Ayam fillet/
    );
  });
});

describe("TC-10 — WAC dasar", () => {
  it("newAvgCost = 152.50", () => {
    const result = calculateNewAvgCost(D(1000), D(145), D(1000), D(160));
    expect(result.toString()).toBe("152.5");
  });
});

describe("TC-11 — stok nol atau negatif", () => {
  it("qtyLama = 0 -> newAvgCost = costMasuk", () => {
    const result = calculateNewAvgCost(D(0), D(999), D(500), D(200));
    expect(result.toString()).toBe("200");
  });

  it("qtyLama negatif -> newAvgCost = costMasuk", () => {
    const result = calculateNewAvgCost(D(-10), D(999), D(500), D(75));
    expect(result.toString()).toBe("75");
  });

  it("qtyLama > 0 tapi qtyLama + qtyMasuk = 0 -> melempar error, bukan bagi nol", () => {
    // qtyLama lolos guard "<=0", tapi qtyMasuk negatif membuat penyebutnya nol.
    expect(() => calculateNewAvgCost(D(100), D(50), D(-100), D(75))).toThrow();
  });
});

describe("TC-12 — alokasi ongkir", () => {
  it("alokasi kopi 33105.02, susu 16894.98, Σ alokasi === ongkirTotal", () => {
    const kopiLineTotal = D(725000);
    const susuLineTotal = D(370000);
    const shippingTotal = D(50000);

    const [kopi, susu] = allocateShippingCost(shippingTotal, [
      kopiLineTotal,
      susuLineTotal,
    ]);

    expect(kopi!.toString()).toBe("33105.02");
    expect(susu!.toString()).toBe("16894.98");
    expect(kopi!.plus(susu!).toString()).toBe(shippingTotal.toString());

    // per gram / per ml (turunan, dihitung di test, bukan bagian cogs.ts)
    const perGramKopi = kopi!.dividedBy(5000); // 5 kg = 5000 g
    const perMlSusu = susu!.dividedBy(20000); // 20 l = 20000 ml
    expect(perGramKopi.toDecimalPlaces(2).toString()).toBe("6.62");
    expect(perMlSusu.toDecimalPlaces(2).toString()).toBe("0.84");
  });

  it("mengembalikan semua nol kalau total lineTotals nol (jangan bagi nol)", () => {
    const result = allocateShippingCost(D(50000), [D(0), D(0)]);
    expect(result[0]!.toString()).toBe("0");
    expect(result[1]!.toString()).toBe("0");
  });
});

describe("TC-18 — costMasuk per base unit, termasuk alokasi ongkir", () => {
  it("costMasuk = 151.621004 per gram (lihat catatan presisi di atas)", () => {
    const costMasuk = calculateIncomingCost({
      qtyPurchaseUnit: D(5),
      lineTotal: D(725000),
      lineDiscount: D(0),
      allocatedShipping: D(33105.02),
      purchaseFactor: D(1000),
    });

    expect(costMasuk.toString()).toBe("151.621004");
    // dibulatkan 5 desimal untuk keterbacaan, sesuai penulisan di CALC-SPEC
    expect(costMasuk.toFixed(5)).toBe("151.62100");

    // tanpa ongkir -> 145 persis (konsisten dengan avgCost kopi di TC-08)
    const withoutShipping = calculateIncomingCost({
      qtyPurchaseUnit: D(5),
      lineTotal: D(725000),
      lineDiscount: D(0),
      allocatedShipping: D(0),
      purchaseFactor: D(1000),
    });
    expect(withoutShipping.toString()).toBe("145");

    // kenaikan karena ongkir konsisten dengan TC-12 (33105.02/5000 = 6.621004 ≈ 6.62)
    const increase = costMasuk.minus(withoutShipping);
    expect(increase.toDecimalPlaces(2).toString()).toBe("6.62");
  });

  it("melempar error kalau qtyPurchaseUnit nol (bukan Infinity)", () => {
    expect(() =>
      calculateIncomingCost({
        qtyPurchaseUnit: D(0),
        lineTotal: D(725000),
        lineDiscount: D(0),
        allocatedShipping: D(33105.02),
        purchaseFactor: D(1000),
      })
    ).toThrow();
  });

  it("melempar error kalau purchaseFactor nol (bukan Infinity)", () => {
    expect(() =>
      calculateIncomingCost({
        qtyPurchaseUnit: D(5),
        lineTotal: D(725000),
        lineDiscount: D(0),
        allocatedShipping: D(33105.02),
        purchaseFactor: D(0),
      })
    ).toThrow();
  });
});

describe("calculateVariance", () => {
  it("menghitung varianceQty, varianceValue, variancePercent", () => {
    const result = calculateVariance(
      [{ qtySold: D(10), recipeQty: D(18) }],
      D(1000),
      D(500),
      D(1300),
      D(145)
    );

    // theoreticalUsage = 10*18 = 180
    // actualUsage = 1000+500-1300 = 200
    // varianceQty = 200-180 = 20
    // varianceValue = 20*145 = 2900
    // variancePercent = 20/180*100 = 11.111...
    expect(result.theoreticalUsage.toString()).toBe("180");
    expect(result.actualUsage.toString()).toBe("200");
    expect(result.varianceQty.toString()).toBe("20");
    expect(result.varianceValue.toString()).toBe("2900");
    expect(result.variancePercent).not.toBeNull();
    expect(result.variancePercent!.toDecimalPlaces(2).toString()).toBe(
      "11.11"
    );
  });

  it("pemakaianTeoritis 0 -> variancePercent null, bukan Infinity", () => {
    const result = calculateVariance([], D(100), D(0), D(50), D(10));

    expect(result.theoreticalUsage.toString()).toBe("0");
    expect(result.variancePercent).toBeNull();
    // varianceQty & varianceValue tetap terhitung normal, bukan ikut jadi null
    expect(result.varianceQty.toString()).toBe("50");
    expect(result.varianceValue.toString()).toBe("500");
  });
});
