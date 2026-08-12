/**
 * T05 — Test untuk src/lib/calc/shift.ts, CALC-SPEC bagian E.
 * TC-14 pakai nilai numerik polos, tidak boleh diubah. Ditambahkan sendiri:
 * expectedCash boleh negatif (mis. cashOut/setor bank melebihi penerimaan
 * tunai) — tidak boleh ditolak atau dipaksa jadi nol, karena itu adalah
 * informasi valid yang menandakan perlu ditelusuri.
 */
import { describe, it, expect } from "vitest";
import { Decimal } from "../../utils/money";
import { calculateShiftReconciliation } from "../shift";

const D = (n: number) => new Decimal(n);

describe("TC-14 — rekonsiliasi kas shift", () => {
  it("expectedCash = 3.475.000, cashVariance = -15.000", () => {
    const result = calculateShiftReconciliation({
      openingCash: D(500000),
      cashPayments: D(3200000),
      changeGiven: D(150000),
      cashIn: D(0),
      cashOut: D(75000),
      cashRefunds: D(0),
      countedCash: D(3460000),
    });

    expect(result.expectedCash.toString()).toBe("3475000");
    expect(result.cashVariance.toString()).toBe("-15000");
  });
});

describe("calculateShiftReconciliation — expectedCash negatif", () => {
  it("tidak ditolak dan tidak dipaksa jadi nol saat cashOut melebihi penerimaan tunai", () => {
    // Kasir setor ke bank (cashOut besar) di tengah shift, lalu ada refund.
    const result = calculateShiftReconciliation({
      openingCash: D(100000),
      cashPayments: D(50000),
      changeGiven: D(0),
      cashIn: D(0),
      cashOut: D(200000),
      cashRefunds: D(0),
      countedCash: D(-50000),
    });

    expect(result.expectedCash.toString()).toBe("-50000");
    expect(result.expectedCash.isNegative()).toBe(true);
    expect(result.cashVariance.toString()).toBe("0");
  });
});
