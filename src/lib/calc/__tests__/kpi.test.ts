/**
 * T05/T06-audit — Test untuk src/lib/calc/kpi.ts, CALC-SPEC bagian D.
 * Tidak ada golden test case di CALC-SPEC untuk bagian D, jadi seluruh test
 * di bawah ditulis sendiri dari rumus, dengan fokus pada aturan wajib:
 * SETIAP pembagian aman terhadap pembagi nol -> null, bukan NaN/Infinity.
 * Angka dipilih supaya pembagian genap (tidak perlu pembulatan) agar test
 * ini murni menguji kebenaran rumus & null-safety, bukan konvensi pembulatan
 * yang tidak disebutkan spec.
 *
 * Semua fungsi *Rate/*Ratio mengembalikan PECAHAN (0.3 = 30%), bukan skala
 * 0-100 — diperbaiki dari versi sebelumnya supaya konsisten dengan seluruh
 * lib/calc/. wasteToCogsRate (dulu wastePercent) dan marginOfSafetyRate
 * (dulu marginOfSafetyPercent) juga di-rename sekaligus.
 */
import { describe, it, expect } from "vitest";
import { Decimal } from "../../utils/money";
import {
  foodCostRate,
  laborCostRate,
  occupancyCostRate,
  primeCostRate,
  averageCheck,
  salesPerGuest,
  voidRate,
  discountRate,
  wasteToCogsRate,
  contributionMarginRatio,
  bepRupiah,
  bepPorsi,
  marginOfSafetyRate,
} from "../kpi";

const D = (n: number) => new Decimal(n);

describe("foodCostRate", () => {
  it("cogs / netSales (pecahan)", () => {
    expect(foodCostRate(D(3000), D(10000))!.toString()).toBe("0.3");
  });
  it("netSales = 0 -> null", () => {
    expect(foodCostRate(D(3000), D(0))).toBeNull();
  });
});

describe("laborCostRate", () => {
  it("laborCost / netSales (pecahan)", () => {
    expect(laborCostRate(D(2000), D(10000))!.toString()).toBe("0.2");
  });
  it("netSales = 0 -> null", () => {
    expect(laborCostRate(D(2000), D(0))).toBeNull();
  });
});

describe("occupancyCostRate", () => {
  it("occupancyCost / netSales (pecahan)", () => {
    expect(occupancyCostRate(D(500), D(10000))!.toString()).toBe("0.05");
  });
  it("netSales = 0 -> null", () => {
    expect(occupancyCostRate(D(500), D(0))).toBeNull();
  });
});

describe("primeCostRate", () => {
  it("foodCostRate + laborCostRate (pecahan)", () => {
    expect(primeCostRate(D(0.3), D(0.2))!.toString()).toBe("0.5");
  });
  it("salah satu input null -> null (bukan ikut dijumlahkan sebagai 0)", () => {
    expect(primeCostRate(null, D(0.2))).toBeNull();
    expect(primeCostRate(D(0.3), null)).toBeNull();
    expect(primeCostRate(null, null)).toBeNull();
  });
});

describe("averageCheck", () => {
  it("netSales / orderCount", () => {
    expect(averageCheck(D(10000), D(10))!.toString()).toBe("1000");
  });
  it("orderCount = 0 -> null", () => {
    expect(averageCheck(D(10000), D(0))).toBeNull();
  });
});

describe("salesPerGuest", () => {
  it("netSales / guestCount", () => {
    expect(salesPerGuest(D(10000), D(20))!.toString()).toBe("500");
  });
  it("guestCount = 0 -> null", () => {
    expect(salesPerGuest(D(10000), D(0))).toBeNull();
  });
});

describe("voidRate", () => {
  it("voidCount / orderCount (pecahan)", () => {
    expect(voidRate(D(2), D(10))!.toString()).toBe("0.2");
  });
  it("orderCount = 0 -> null", () => {
    expect(voidRate(D(2), D(0))).toBeNull();
  });
});

describe("discountRate", () => {
  it("discountTotal / grossSales (pecahan)", () => {
    expect(discountRate(D(500), D(10000))!.toString()).toBe("0.05");
  });
  it("grossSales = 0 -> null", () => {
    expect(discountRate(D(500), D(0))).toBeNull();
  });
});

describe("wasteToCogsRate", () => {
  it("wasteValue / cogs (pecahan)", () => {
    expect(wasteToCogsRate(D(100), D(2000))!.toString()).toBe("0.05");
  });
  it("cogs = 0 -> null", () => {
    expect(wasteToCogsRate(D(100), D(0))).toBeNull();
  });
});

describe("contributionMarginRatio", () => {
  it("(netSales - variableCost) / netSales", () => {
    expect(contributionMarginRatio(D(10000), D(4000))!.toString()).toBe("0.6");
  });
  it("netSales = 0 -> null", () => {
    expect(contributionMarginRatio(D(0), D(4000))).toBeNull();
  });
});

describe("bepRupiah", () => {
  it("fixedCost / contributionMarginRatio", () => {
    expect(bepRupiah(D(6000), D(0.6))!.toString()).toBe("10000");
  });
  it("contributionMarginRatio null -> null (tidak bisa dihitung)", () => {
    expect(bepRupiah(D(6000), null)).toBeNull();
  });
  it("contributionMarginRatio = 0 -> null, bukan Infinity", () => {
    expect(bepRupiah(D(6000), D(0))).toBeNull();
  });
});

describe("bepPorsi", () => {
  it("fixedCost / (avgPrice - avgHpp)", () => {
    expect(bepPorsi(D(6000), D(50), D(20))!.toString()).toBe("200");
  });
  it("avgPrice === avgHpp -> null, bukan Infinity", () => {
    expect(bepPorsi(D(6000), D(20), D(20))).toBeNull();
  });
  it("avgHpp > avgPrice -> hasil negatif apa adanya (bukan diclamp)", () => {
    // Margin per porsi negatif berarti rugi per unit; BEP negatif adalah
    // sinyal valid (tidak akan pernah balik modal), bukan kasus yang
    // "ditolak" oleh kalkulator murni.
    const result = bepPorsi(D(6000), D(20), D(30));
    expect(result).not.toBeNull();
    expect(result!.isNegative()).toBe(true);
  });
});

describe("marginOfSafetyRate", () => {
  it("(netSales - bepRupiah) / netSales (pecahan)", () => {
    expect(marginOfSafetyRate(D(10000), D(6000))!.toString()).toBe("0.4");
  });
  it("netSales = 0 -> null", () => {
    expect(marginOfSafetyRate(D(0), D(6000))).toBeNull();
  });
  it("bepRupiah null -> null (ikut merambat)", () => {
    expect(marginOfSafetyRate(D(10000), null)).toBeNull();
  });
});
