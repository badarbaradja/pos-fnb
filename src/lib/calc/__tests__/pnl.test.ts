/**
 * T05 — Test untuk src/lib/calc/pnl.ts, CALC-SPEC bagian C.
 * TC-13 pakai nilai numerik polos, tidak boleh diubah.
 *
 * Catatan desain: calculatePnL() menerima nilai yang SUDAH TERAGREGASI
 * (grossSales, discountTotal, refundTotal, cogs, komponen opex) — bukan
 * array Order[]/Refund[] mentah, karena tipe Order/OrderItem/Refund belum
 * didefinisikan di manapun di codebase ini (T06 belum dikerjakan). `opex`
 * dijumlahkan dari 9 komponen DI DALAM fungsi.
 *
 * grossMarginRate/netMarginRate mengembalikan PECAHAN (dulu grossMarginPct/
 * netMarginPct, skala 0-100) — nilainya TIDAK berubah, cuma dibagi 100:
 * 68,82% -> 0.6882, 38,71% -> 0.3871, dibulatkan 4 desimal HALF_UP.
 */
import { describe, it, expect } from "vitest";
import { Decimal } from "../../utils/money";
import { calculatePnL } from "../pnl";
import type { PnLInput } from "../pnl";

const D = (n: number) => new Decimal(n);

function baseInput(overrides: Partial<PnLInput> = {}): PnLInput {
  return {
    grossSales: D(0),
    discountTotal: D(0),
    refundTotal: D(0),
    cogs: D(0),
    laborCost: D(0),
    occupancy: D(0),
    utility: D(0),
    marketing: D(0),
    commission: D(0),
    mdr: D(0),
    supplies: D(0),
    admin: D(0),
    depreciation: D(0),
    otherIncome: D(0),
    otherExpense: D(0),
    incomeTax: D(0),
    ...overrides,
  };
}

describe("TC-13 — P&L satu hari", () => {
  it("seluruh nilai antara sesuai spesifikasi", () => {
    const input = baseInput({
      grossSales: D(10000000),
      discountTotal: D(500000),
      refundTotal: D(200000),
      cogs: D(2900000),
      laborCost: D(1800000),
      occupancy: D(500000),
      utility: D(300000),
      depreciation: D(200000),
    });

    const result = calculatePnL(input);

    expect(result.netSales.toString()).toBe("9300000");
    expect(result.grossProfit.toString()).toBe("6400000");
    expect(result.grossMarginRate).not.toBeNull();
    expect(result.grossMarginRate!.toString()).toBe("0.6882");
    expect(result.opex.toString()).toBe("2800000");
    expect(result.operatingProfit.toString()).toBe("3600000");
    expect(result.netProfit.toString()).toBe("3600000");
    expect(result.netMarginRate).not.toBeNull();
    expect(result.netMarginRate!.toString()).toBe("0.3871");
  });
});

describe("calculatePnL — netSales = 0", () => {
  it("grossMarginRate dan netMarginRate null, bukan NaN/Infinity", () => {
    const input = baseInput({
      grossSales: D(500000),
      discountTotal: D(300000),
      refundTotal: D(200000), // netSales = 500000-300000-200000 = 0
      cogs: D(0),
    });

    const result = calculatePnL(input);

    expect(result.netSales.toString()).toBe("0");
    expect(result.grossMarginRate).toBeNull();
    expect(result.netMarginRate).toBeNull();
    // nilai absolut (bukan persentase) tetap terhitung normal
    expect(result.grossProfit.toString()).toBe("0");
    expect(result.operatingProfit.toString()).toBe("0");
    expect(result.netProfit.toString()).toBe("0");
  });
});
