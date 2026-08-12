/**
 * T03 — Golden test cases untuk calculateOrder(), CALC-SPEC bagian A.
 * TC-01 s/d TC-07, TC-16, TC-17. Nilai ekspektasi memakai notasi numerik
 * polos (yang di dalam kurung di CALC-SPEC), bukan notasi Indonesia.
 * JANGAN UBAH ANGKA EKSPEKTASI DI FILE INI.
 *
 * Catatan penting hasil pembacaan spesifikasi (bukan tebakan bisnis baru,
 * murni konsekuensi aritmetik dari rumus & golden case yang sudah ada):
 *
 * 1. Field *Percent (orderDiscountPercent, serviceChargePercent, taxPercent)
 *    menyimpan PECAHAN (0.10 = 10%), bukan 10. Dibuktikan dari TC-01:
 *    rumus langkah 4 "orderDiscountPercent × discountBase" tanpa /100, dan
 *    9600 = 96000 × 0.10 (bukan × 10). Sama untuk service charge & pajak.
 * 2. `discountBase` bukan field CalcResult (tidak ada di signature A.1).
 *    Tapi discountBase = subtotal - itemDiscountTotal secara aljabar
 *    (ΣafterItemDisc = Σgross - Σitemdiscount), jadi TC-01 mengecek nilai
 *    ini lewat kombinasi `result.subtotal` dan `result.itemDiscountTotal`.
 * 3. Langkah 4 "orderDiscount = orderDiscountAmount, ATAU orderDiscountPercent
 *    × discountBase" — spec tidak menyebut field penentu mode secara eksplisit.
 *    Diasumsikan: kalau orderDiscountAmount > 0, pakai itu; kalau tidak, pakai
 *    persen. Semua golden test hanya mengisi salah satu (tidak pernah dua-duanya
 *    sekaligus), jadi asumsi ini tidak memengaruhi angka ekspektasi manapun.
 */
import { describe, it, expect } from "vitest";
import { Decimal } from "../../utils/money";
import type { RoundingMode } from "../../utils/money";
import { calculateOrder } from "../order-calculator";
import type { CalcLine, CalcSettings } from "../order-calculator";

function line(overrides: Partial<CalcLine> & { id: string }): CalcLine {
  return {
    qty: new Decimal(1),
    unitPrice: new Decimal(0),
    modifierTotal: new Decimal(0),
    itemDiscount: new Decimal(0),
    isTaxable: true,
    ...overrides,
  };
}

function baseSettings(overrides: Partial<CalcSettings> = {}): CalcSettings {
  return {
    orderDiscountPercent: new Decimal(0),
    orderDiscountAmount: new Decimal(0),
    maxDiscount: null,
    serviceChargePercent: new Decimal(0),
    taxPercent: new Decimal(0),
    taxInclusive: false,
    serviceChargeInTaxBase: true,
    roundingTo: 100,
    roundingMode: "nearest",
    ...overrides,
  };
}

describe("TC-01 — kasus standar (wajib lolos persis)", () => {
  it("seluruh nilai antara sesuai spesifikasi persis", () => {
    const lines: CalcLine[] = [
      line({
        id: "L1",
        qty: new Decimal(2),
        unitPrice: new Decimal(28000),
        modifierTotal: new Decimal(5000),
        itemDiscount: new Decimal(0),
        isTaxable: true,
      }),
      line({
        id: "L2",
        qty: new Decimal(1),
        unitPrice: new Decimal(35000),
        modifierTotal: new Decimal(0),
        itemDiscount: new Decimal(5000),
        isTaxable: true,
      }),
    ];
    const settings = baseSettings({
      orderDiscountPercent: new Decimal(0.1),
      maxDiscount: new Decimal(15000),
      serviceChargePercent: new Decimal(0.05),
      taxPercent: new Decimal(0.1),
      taxInclusive: false,
      roundingTo: 100,
      roundingMode: "nearest",
    });

    const result = calculateOrder(lines, settings);

    expect(result.lines[0]!.grossAmount.toString()).toBe("66000");
    expect(result.lines[1]!.grossAmount.toString()).toBe("35000");
    expect(result.subtotal.toString()).toBe("101000");
    expect(result.itemDiscountTotal.toString()).toBe("5000");
    // discountBase (bukan field CalcResult, lihat catatan #2 di atas)
    expect(result.subtotal.minus(result.itemDiscountTotal).toString()).toBe(
      "96000"
    );
    expect(result.orderDiscount.toString()).toBe("9600");
    expect(result.lines[0]!.allocatedOrderDiscount.toString()).toBe("6600");
    expect(result.lines[1]!.allocatedOrderDiscount.toString()).toBe("3000");
    expect(result.lines[0]!.netAmount.toString()).toBe("59400");
    expect(result.lines[1]!.netAmount.toString()).toBe("27000");
    expect(result.netSales.toString()).toBe("86400");
    expect(result.serviceCharge.toString()).toBe("4320");
    expect(result.taxBase.toString()).toBe("90720");
    expect(result.taxAmount.toString()).toBe("9072");
    expect(result.totalBeforeRounding.toString()).toBe("99792");
    expect(result.total.toString()).toBe("99800");
    expect(result.rounding.toString()).toBe("8");
  });
});

describe("TC-02 — tanpa pajak & tanpa service charge", () => {
  it("total = harga apa adanya, taxAmount 0, rounding 0", () => {
    const lines: CalcLine[] = [
      line({ id: "L1", qty: new Decimal(1), unitPrice: new Decimal(15000) }),
    ];
    const settings = baseSettings({ roundingTo: 100 });

    const result = calculateOrder(lines, settings);

    expect(result.total.toString()).toBe("15000");
    expect(result.rounding.toString()).toBe("0");
    expect(result.taxAmount.toString()).toBe("0");
  });
});

describe("TC-03 — harga sudah termasuk pajak (taxInclusive = true)", () => {
  it("taxBase, taxAmount, total sesuai spesifikasi", () => {
    const lines: CalcLine[] = [
      line({ id: "L1", qty: new Decimal(1), unitPrice: new Decimal(110000) }),
    ];
    const settings = baseSettings({
      taxPercent: new Decimal(0.1),
      taxInclusive: true,
      roundingTo: 1,
    });

    const result = calculateOrder(lines, settings);

    expect(result.taxBase.toString()).toBe("110000");
    expect(result.taxAmount.toString()).toBe("10000");
    expect(result.total.toString()).toBe("110000");
  });
});

describe("TC-04 — sisa pembulatan alokasi diserap baris terakhir", () => {
  it("alokasi 3333.33 / 3333.33 / 3333.34, Σ allocated === orderDiscount", () => {
    const lines: CalcLine[] = [
      line({ id: "L1", qty: new Decimal(1), unitPrice: new Decimal(10000) }),
      line({ id: "L2", qty: new Decimal(1), unitPrice: new Decimal(10000) }),
      line({ id: "L3", qty: new Decimal(1), unitPrice: new Decimal(10000) }),
    ];
    const settings = baseSettings({ orderDiscountAmount: new Decimal(10000) });

    const result = calculateOrder(lines, settings);

    expect(result.lines[0]!.allocatedOrderDiscount.toString()).toBe(
      "3333.33"
    );
    expect(result.lines[1]!.allocatedOrderDiscount.toString()).toBe(
      "3333.33"
    );
    expect(result.lines[2]!.allocatedOrderDiscount.toString()).toBe(
      "3333.34"
    );

    const sumAllocated = result.lines.reduce(
      (sum, l) => sum.plus(l.allocatedOrderDiscount),
      new Decimal(0)
    );
    expect(sumAllocated.toString()).toBe(result.orderDiscount.toString());
    expect(sumAllocated.toString()).toBe("10000");
  });
});

describe("TC-05 — diskon melebihi tagihan", () => {
  it("orderDiscount di-cap, netSales dan total tidak negatif", () => {
    const lines: CalcLine[] = [
      line({ id: "L1", qty: new Decimal(1), unitPrice: new Decimal(50000) }),
    ];
    const settings = baseSettings({ orderDiscountAmount: new Decimal(80000) });

    const result = calculateOrder(lines, settings);

    expect(result.orderDiscount.toString()).toBe("50000");
    expect(result.netSales.toString()).toBe("0");
    expect(result.total.toString()).toBe("0");
  });
});

describe("TC-06 — item non-taxable dicampur", () => {
  it("taxBase hanya menghitung baris taxable", () => {
    const lines: CalcLine[] = [
      line({
        id: "L1",
        qty: new Decimal(1),
        unitPrice: new Decimal(100000),
        isTaxable: true,
      }),
      line({
        id: "L2",
        qty: new Decimal(1),
        unitPrice: new Decimal(5000),
        isTaxable: false,
      }),
    ];
    const settings = baseSettings({ taxPercent: new Decimal(0.1) });

    const result = calculateOrder(lines, settings);

    expect(result.taxBase.toString()).toBe("100000");
    expect(result.taxAmount.toString()).toBe("10000");
    expect(result.total.toString()).toBe("115000");
  });
});

describe("TC-16 — roundingMode 'nearest', rounding negatif", () => {
  it("totalBeforeRounding 99849 -> total 99800, rounding -49 persis", () => {
    const lines: CalcLine[] = [
      line({
        id: "L1",
        qty: new Decimal(1),
        unitPrice: new Decimal(99849),
        isTaxable: false,
      }),
    ];
    const settings = baseSettings({ roundingTo: 100, roundingMode: "nearest" });

    const result = calculateOrder(lines, settings);

    expect(result.totalBeforeRounding.toString()).toBe("99849");
    expect(result.total.toString()).toBe("99800");
    expect(result.total.minus(result.totalBeforeRounding).toString()).toBe(
      "-49"
    );
    expect(result.rounding.toString()).toBe("-49");
  });
});

describe("TC-17 — roundingMode 'up', rounding selalu positif", () => {
  it("totalBeforeRounding 99201 -> total 99300, rounding +99", () => {
    const lines: CalcLine[] = [
      line({
        id: "L1",
        qty: new Decimal(1),
        unitPrice: new Decimal(99201),
        isTaxable: false,
      }),
    ];
    const settings = baseSettings({ roundingTo: 100, roundingMode: "up" });

    const result = calculateOrder(lines, settings);

    expect(result.totalBeforeRounding.toString()).toBe("99201");
    expect(result.total.toString()).toBe("99300");
    expect(result.rounding.toString()).toBe("99");
    expect(result.rounding.greaterThanOrEqualTo(0)).toBe(true);
  });
});

// --- TC-07: property-based test, 1000 iterasi input acak (deterministik via seed) ---

function mulberry32(seed: number): () => number {
  let a = seed;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function randBool(rng: () => number, probTrue: number): boolean {
  return rng() < probTrue;
}

function randChoice<T>(rng: () => number, options: readonly T[]): T {
  return options[randInt(rng, 0, options.length - 1)]!;
}

function randomOrder(
  rng: () => number,
  roundingMode: RoundingMode
): { lines: CalcLine[]; settings: CalcSettings } {
  const lineCount = randInt(rng, 1, 5);
  const lines: CalcLine[] = [];
  let discountBaseApprox = 0;

  for (let i = 0; i < lineCount; i++) {
    const qty = randInt(rng, 1, 5);
    const unitPrice = randInt(rng, 1000, 100000);
    const modifierTotal = randInt(rng, 0, 10000);
    const grossAmount = qty * (unitPrice + modifierTotal);
    const itemDiscount = randInt(rng, 0, grossAmount);
    discountBaseApprox += grossAmount - itemDiscount;

    lines.push({
      id: `line-${i}`,
      qty: new Decimal(qty),
      unitPrice: new Decimal(unitPrice),
      modifierTotal: new Decimal(modifierTotal),
      itemDiscount: new Decimal(itemDiscount),
      isTaxable: randBool(rng, 0.7),
    });
  }

  const useAmountDiscount = randBool(rng, 0.5);
  const orderDiscountPercent = useAmountDiscount
    ? new Decimal(0)
    : new Decimal(randInt(rng, 0, 30)).dividedBy(100);
  const orderDiscountAmount = useAmountDiscount
    ? new Decimal(randInt(rng, 0, Math.max(1, Math.round(discountBaseApprox * 1.5))))
    : new Decimal(0);

  const maxDiscount = randBool(rng, 0.5)
    ? new Decimal(randInt(rng, 0, Math.max(1, Math.round(discountBaseApprox * 1.2))))
    : null;

  const settings: CalcSettings = {
    orderDiscountPercent,
    orderDiscountAmount,
    maxDiscount,
    serviceChargePercent: new Decimal(randInt(rng, 0, 10)).dividedBy(100),
    taxPercent: new Decimal(randInt(rng, 0, 15)).dividedBy(100),
    taxInclusive: randBool(rng, 0.3),
    serviceChargeInTaxBase: randBool(rng, 0.7),
    roundingTo: randChoice(rng, [1, 10, 50, 100, 500, 1000] as const),
    roundingMode,
  };

  return { lines, settings };
}

describe("TC-07 — properti invarian (property-based test, 1000 iterasi acak)", () => {
  it("Σ netAmount === netSales, Σ allocated === orderDiscount, total >= 0, rounding sesuai rentang mode", () => {
    const modes: readonly RoundingMode[] = ["nearest", "up", "down"];
    const rng = mulberry32(20260812);
    const ITERATIONS = 1000;

    for (let iter = 0; iter < ITERATIONS; iter++) {
      const mode = modes[iter % modes.length]!;
      const { lines, settings } = randomOrder(rng, mode);
      const result = calculateOrder(lines, settings);

      const sumNetAmount = result.lines.reduce(
        (sum, l) => sum.plus(l.netAmount),
        new Decimal(0)
      );
      const sumAllocated = result.lines.reduce(
        (sum, l) => sum.plus(l.allocatedOrderDiscount),
        new Decimal(0)
      );

      expect(sumNetAmount.toString()).toBe(result.netSales.toString());
      expect(sumAllocated.toString()).toBe(result.orderDiscount.toString());
      expect(result.total.greaterThanOrEqualTo(0)).toBe(true);

      const halfStep = settings.roundingTo / 2;
      if (mode === "nearest") {
        expect(result.rounding.greaterThan(-halfStep)).toBe(true);
        expect(result.rounding.lessThanOrEqualTo(halfStep)).toBe(true);
      } else if (mode === "up") {
        expect(result.rounding.greaterThanOrEqualTo(0)).toBe(true);
      } else {
        expect(result.rounding.lessThanOrEqualTo(0)).toBe(true);
      }
    }
  });
});
