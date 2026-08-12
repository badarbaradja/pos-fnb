/**
 * T04 — Test untuk src/lib/calc/cogs.ts, CALC-SPEC bagian B.
 * TC-08 s/d TC-12 pakai nilai numerik polos. Nilai ekspektasi TC-08..TC-12
 * TIDAK BOLEH diubah. Test circular reference, kedalaman maksimal, dan
 * calculateVariance ditambahkan sendiri (tidak ada golden case di spec untuk
 * kasus-kasus ini).
 *
 * Catatan desain penting (bukan tebakan bisnis, murni pembacaan literal rumus):
 *
 * 1. Di bagian B, rumus "effectiveQty = recipeQty × (1 + wastePercent/100)" dan
 *    "effectiveCost = avgCost / (yieldPercent/100)" MEMAKAI /100 secara eksplisit.
 *    Ini KEBALIKAN dari CalcSettings.*Percent di bagian A (yang pecahan, tanpa
 *    /100). Jadi di cogs.ts, wastePercent/yieldPercent adalah ANGKA PERSEN
 *    POLOS (3 = 3%, 100 = 100%), bukan pecahan. Dibuktikan oleh TC-09:
 *    45 / (80/100) = 56.25 — hanya cocok kalau yieldPercent diisi 80, bukan 0.8.
 * 2. Signature calculateRecipeCost() tidak diberikan eksplisit di CALC-SPEC
 *    (beda dari calculateOrder() yang punya A.1). Didesain menerima resep +
 *    "katalog bahan" (map id -> definisi bahan) supaya rekursi ke bahan
 *    semi-finished bisa dilakukan tanpa akses database (tetap fungsi murni) —
 *    katalog sudah harus di-resolve penuh oleh pemanggil sebelum dipanggil.
 * 3. "costMasuk per base unit" (formula tanpa nama di B.2, kombinasi
 *    hargaBeliPerPurchaseUnit − diskonPerUnit + alokasiOngkirPerUnit, dibagi
 *    purchaseFactor) SENGAJA TIDAK diimplementasikan di T04 ini. Tidak ada
 *    golden test yang menguji rumus itu end-to-end, dan penamaan field
 *    "PerUnit" ambigu: tidak jelas apakah itu nilai per satu purchase unit
 *    atau total per baris pembelian (TC-12 sendiri memberi contoh dengan
 *    "hargaBeli 5kg = 725.000" yang merupakan TOTAL baris, bukan harga per kg).
 *    Ditandai untuk ditanyakan, bukan ditebak.
 */
import { describe, it, expect } from "vitest";
import { Decimal } from "../../utils/money";
import {
  calculateRecipeCost,
  calculateNewAvgCost,
  allocateShippingCost,
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
      { ingredientId: "biji-kopi", recipeQty: D(18), wastePercent: D(3), yieldPercent: D(100) },
      { ingredientId: "susu-uht", recipeQty: D(200), wastePercent: D(0), yieldPercent: D(100) },
      { ingredientId: "gula-cair", recipeQty: D(10), wastePercent: D(0), yieldPercent: D(100) },
      { ingredientId: "cup-lid", recipeQty: D(1), wastePercent: D(0), yieldPercent: D(100) },
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
        wastePercent: D(0),
        yieldPercent: D(80),
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
          { ingredientId: "gula", recipeQty: D(100), wastePercent: D(0), yieldPercent: D(100) },
        ],
        overheadCost: D(0),
        outputQty: D(100), // hpp per unit output sirup = (100*12)/100 = 12
      },
    };
    const recipe: RecipeLine[] = [
      {
        ingredientId: "sirup-gula",
        recipeQty: D(10),
        wastePercent: D(0),
        yieldPercent: D(100),
      },
    ];

    const hpp = calculateRecipeCost(recipe, D(0), D(1), catalog);

    // effectiveCost sirup = 12 (hpp per unit sirup) / (100/100) = 12
    // lineCost = 10 * 12 = 120
    expect(hpp.toString()).toBe("120");
  });

  it("menambahkan overheadCost / outputQty produk induk", () => {
    const catalog: IngredientCatalog = {
      gula: { name: "Gula pasir", isSemiFinished: false, avgCost: D(12) },
    };
    const recipe: RecipeLine[] = [
      { ingredientId: "gula", recipeQty: D(10), wastePercent: D(0), yieldPercent: D(100) },
    ];

    // lineCost = 10*12 = 120; overhead 50 / outputQty 5 = 10 -> hpp = 130
    const hpp = calculateRecipeCost(recipe, D(50), D(5), catalog);

    expect(hpp.toString()).toBe("130");
  });

  it("melempar error kalau bahan tidak ditemukan di katalog", () => {
    const catalog: IngredientCatalog = {};
    const recipe: RecipeLine[] = [
      { ingredientId: "tidak-ada", recipeQty: D(1), wastePercent: D(0), yieldPercent: D(100) },
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
          { ingredientId: "sirup-b", recipeQty: D(1), wastePercent: D(0), yieldPercent: D(100) },
        ],
        overheadCost: D(0),
        outputQty: D(1),
      },
      "sirup-b": {
        name: "Sirup B",
        isSemiFinished: true,
        recipe: [
          { ingredientId: "sirup-a", recipeQty: D(1), wastePercent: D(0), yieldPercent: D(100) },
        ],
        overheadCost: D(0),
        outputQty: D(1),
      },
    };
    const recipe: RecipeLine[] = [
      { ingredientId: "sirup-a", recipeQty: D(1), wastePercent: D(0), yieldPercent: D(100) },
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
        { ingredientId: next, recipeQty: D(1), wastePercent: D(0), yieldPercent: D(100) },
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
      { ingredientId: "L1", recipeQty: D(1), wastePercent: D(0), yieldPercent: D(100) },
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
        { ingredientId: next, recipeQty: D(1), wastePercent: D(0), yieldPercent: D(100) },
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
      { ingredientId: "L1", recipeQty: D(1), wastePercent: D(0), yieldPercent: D(100) },
    ];

    expect(() => calculateRecipeCost(recipe, D(0), D(1), catalog)).not.toThrow();
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
