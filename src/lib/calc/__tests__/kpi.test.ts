/**
 * T05 — Test untuk src/lib/calc/kpi.ts, CALC-SPEC bagian D.
 * Tidak ada golden test case di CALC-SPEC untuk bagian D, jadi seluruh test
 * di bawah ditulis sendiri dari rumus, dengan fokus pada aturan wajib:
 * SETIAP pembagian aman terhadap pembagi nol -> null, bukan NaN/Infinity.
 * Angka dipilih supaya pembagian genap (tidak perlu pembulatan) agar test
 * ini murni menguji kebenaran rumus & null-safety, bukan konvensi pembulatan
 * yang tidak disebutkan spec.
 */
import { describe, it, expect } from "vitest";
import { Decimal } from "../../utils/money";
import {
  foodCostPercent,
  laborCostPercent,
  occupancyCostPercent,
  primeCostPercent,
  averageCheck,
  salesPerGuest,
  voidRate,
  discountRate,
  wastePercent,
  contributionMarginRatio,
  bepRupiah,
  bepPorsi,
  marginOfSafetyPercent,
} from "../kpi";

const D = (n: number) => new Decimal(n);

describe("foodCostPercent", () => {
  it("cogs / netSales * 100", () => {
    expect(foodCostPercent(D(3000), D(10000))!.toString()).toBe("30");
  });
  it("netSales = 0 -> null", () => {
    expect(foodCostPercent(D(3000), D(0))).toBeNull();
  });
});

describe("laborCostPercent", () => {
  it("laborCost / netSales * 100", () => {
    expect(laborCostPercent(D(2000), D(10000))!.toString()).toBe("20");
  });
  it("netSales = 0 -> null", () => {
    expect(laborCostPercent(D(2000), D(0))).toBeNull();
  });
});

describe("occupancyCostPercent", () => {
  it("occupancyCost / netSales * 100", () => {
    expect(occupancyCostPercent(D(500), D(10000))!.toString()).toBe("5");
  });
  it("netSales = 0 -> null", () => {
    expect(occupancyCostPercent(D(500), D(0))).toBeNull();
  });
});

describe("primeCostPercent", () => {
  it("foodCostPercent + laborCostPercent", () => {
    expect(primeCostPercent(D(30), D(20))!.toString()).toBe("50");
  });
  it("salah satu input null -> null (bukan ikut dijumlahkan sebagai 0)", () => {
    expect(primeCostPercent(null, D(20))).toBeNull();
    expect(primeCostPercent(D(30), null)).toBeNull();
    expect(primeCostPercent(null, null)).toBeNull();
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
  it("voidCount / orderCount * 100", () => {
    expect(voidRate(D(2), D(10))!.toString()).toBe("20");
  });
  it("orderCount = 0 -> null", () => {
    expect(voidRate(D(2), D(0))).toBeNull();
  });
});

describe("discountRate", () => {
  it("discountTotal / grossSales * 100", () => {
    expect(discountRate(D(500), D(10000))!.toString()).toBe("5");
  });
  it("grossSales = 0 -> null", () => {
    expect(discountRate(D(500), D(0))).toBeNull();
  });
});

describe("wastePercent", () => {
  it("wasteValue / cogs * 100", () => {
    expect(wastePercent(D(100), D(2000))!.toString()).toBe("5");
  });
  it("cogs = 0 -> null", () => {
    expect(wastePercent(D(100), D(0))).toBeNull();
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

describe("marginOfSafetyPercent", () => {
  it("(netSales - bepRupiah) / netSales * 100", () => {
    expect(marginOfSafetyPercent(D(10000), D(6000))!.toString()).toBe("40");
  });
  it("netSales = 0 -> null", () => {
    expect(marginOfSafetyPercent(D(0), D(6000))).toBeNull();
  });
  it("bepRupiah null -> null (ikut merambat)", () => {
    expect(marginOfSafetyPercent(D(10000), null)).toBeNull();
  });
});
