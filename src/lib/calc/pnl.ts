import { Decimal, round2 } from "../utils/money";

/**
 * Laba Rugi — CALC-SPEC bagian C. Fungsi murni: tanpa akses database, tanpa
 * fetch, tanpa Date.now().
 *
 * Semua field input SUDAH TERAGREGASI (grossSales = Σ order.subtotal,
 * discountTotal = Σ order.discountTotal, dst.) — pemanggil yang menjumlahkan
 * dari baris order/refund/orderItem mentah, karena tipe Order/OrderItem/
 * Refund belum didefinisikan di lib/db/schema.ts (T06 belum dikerjakan).
 * `cogs` juga diterima sebagai satu nilai gabungan (Σ orderItem.cogsAmount +
 * wasteValue sudah dijumlahkan pemanggil) — TC-13 memberi contoh persis
 * seperti ini, satu angka "cogs" tanpa dipecah.
 */

export type PnLInput = {
  grossSales: Decimal;
  discountTotal: Decimal;
  refundTotal: Decimal;
  cogs: Decimal;
  laborCost: Decimal;
  occupancy: Decimal;
  utility: Decimal;
  marketing: Decimal;
  commission: Decimal;
  mdr: Decimal;
  supplies: Decimal;
  admin: Decimal;
  depreciation: Decimal;
  otherIncome: Decimal;
  otherExpense: Decimal;
  incomeTax: Decimal;
};

export type PnLResult = {
  grossSales: Decimal;
  discountTotal: Decimal;
  refundTotal: Decimal;
  netSales: Decimal;
  cogs: Decimal;
  grossProfit: Decimal;
  grossMarginPct: Decimal | null;
  opex: Decimal;
  operatingProfit: Decimal;
  netProfit: Decimal;
  netMarginPct: Decimal | null;
};

/**
 * calculatePnL() — CALC-SPEC C.
 * netSales = 0 -> grossMarginPct & netMarginPct null, bukan NaN/Infinity.
 * Pajak (PB1) dan service charge TIDAK masuk ke sini — netSales di sini
 * murni dari grossSales/discountTotal/refundTotal, sesuai aturan C.
 */
export function calculatePnL(input: PnLInput): PnLResult {
  const netSales = input.grossSales
    .minus(input.discountTotal)
    .minus(input.refundTotal);

  const grossProfit = netSales.minus(input.cogs);

  const opex = input.laborCost
    .plus(input.occupancy)
    .plus(input.utility)
    .plus(input.marketing)
    .plus(input.commission)
    .plus(input.mdr)
    .plus(input.supplies)
    .plus(input.admin)
    .plus(input.depreciation);

  const operatingProfit = grossProfit.minus(opex);
  const netProfit = operatingProfit
    .plus(input.otherIncome)
    .minus(input.otherExpense)
    .minus(input.incomeTax);

  const netSalesIsZero = netSales.isZero();
  const grossMarginPct = netSalesIsZero
    ? null
    : round2(grossProfit.dividedBy(netSales).times(100));
  const netMarginPct = netSalesIsZero
    ? null
    : round2(netProfit.dividedBy(netSales).times(100));

  return {
    grossSales: input.grossSales,
    discountTotal: input.discountTotal,
    refundTotal: input.refundTotal,
    netSales,
    cogs: input.cogs,
    grossProfit,
    grossMarginPct,
    opex,
    operatingProfit,
    netProfit,
    netMarginPct,
  };
}
