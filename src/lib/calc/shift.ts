import { Decimal } from "../utils/money";

/**
 * Rekonsiliasi Kas Shift — CALC-SPEC bagian E. Fungsi murni: tanpa akses
 * database, tanpa fetch, tanpa Date.now().
 *
 * `expectedCash` maupun `cashVariance` boleh negatif dan TIDAK di-clamp ke
 * nol — negatif adalah informasi valid (mis. cashOut/setor bank melebihi
 * penerimaan tunai) yang menandakan ada yang perlu ditelusuri, bukan
 * kondisi error.
 *
 * PENTING — aturan write-once: `countedCash` bersifat write-once (kasir
 * mengisi SEBELUM melihat expectedCash, dan tidak boleh mengubahnya
 * setelah tersimpan). Fungsi murni ini TIDAK menegakkan aturan itu — itu
 * tanggung jawab Server Action penutupan shift (T15). Jangan lupa terapkan
 * di sana.
 */

export type ShiftReconciliationInput = {
  openingCash: Decimal;
  cashPayments: Decimal; // Σ payment tunai
  changeGiven: Decimal; // Σ kembalian
  cashIn: Decimal;
  cashOut: Decimal;
  cashRefunds: Decimal; // Σ refund tunai
  countedCash: Decimal;
};

export type ShiftReconciliationResult = {
  expectedCash: Decimal;
  cashVariance: Decimal;
};

/**
 * calculateShiftReconciliation() — CALC-SPEC E.
 * expectedCash = openingCash + Σpayment tunai − Σkembalian + cashIn − cashOut − Σrefund tunai
 * cashVariance = countedCash − expectedCash
 */
export function calculateShiftReconciliation(
  input: ShiftReconciliationInput
): ShiftReconciliationResult {
  const expectedCash = input.openingCash
    .plus(input.cashPayments)
    .minus(input.changeGiven)
    .plus(input.cashIn)
    .minus(input.cashOut)
    .minus(input.cashRefunds);

  const cashVariance = input.countedCash.minus(expectedCash);

  return { expectedCash, cashVariance };
}
