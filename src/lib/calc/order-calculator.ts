import { Decimal, roundTo, round2 } from "../utils/money";
import type { RoundingMode } from "../utils/money";

/**
 * Kalkulator struk — CALC-SPEC bagian A. Fungsi murni: tanpa akses database,
 * tanpa fetch, tanpa Date.now(). Urutan langkah 1-10 di CALC-SPEC A.3 tidak
 * boleh ditukar.
 */

export type CalcLine = {
  id: string;
  qty: Decimal;
  unitPrice: Decimal;
  modifierTotal: Decimal; // total harga modifier per 1 unit
  itemDiscount: Decimal; // nominal, sudah dikonversi dari persen kalau perlu
  isTaxable: boolean;
};

export type CalcSettings = {
  discountType: "amount" | "percent" | "none"; // default 'none', lihat CALC-SPEC A.2
  orderDiscountPercent: Decimal; // PECAHAN (0.10 = 10%), bukan angka persen.
  // Konversi dari input UI (yang memakai 10) dilakukan di layer pemanggil,
  // bukan di dalam kalkulator. Berlaku juga untuk serviceChargePercent
  // dan taxPercent di bawah.
  orderDiscountAmount: Decimal; // dipakai kalau discountType = 'amount'
  maxDiscount: Decimal | null; // cap
  serviceChargePercent: Decimal; // pecahan
  taxPercent: Decimal; // pecahan
  taxInclusive: boolean;
  serviceChargeInTaxBase: boolean; // setting per outlet, default true
  roundingTo: number; // 100 = bulatkan ke Rp 100 — satuan konfigurasi, bukan uang
  roundingMode: RoundingMode;
};

export type CalcLineResult = {
  id: string;
  grossAmount: Decimal;
  itemDiscount: Decimal;
  allocatedOrderDiscount: Decimal;
  netAmount: Decimal;
};

export type CalcResult = {
  lines: CalcLineResult[];
  subtotal: Decimal;
  itemDiscountTotal: Decimal;
  orderDiscount: Decimal;
  discountTotal: Decimal;
  netSales: Decimal;
  serviceCharge: Decimal;
  taxBase: Decimal;
  taxAmount: Decimal;
  totalBeforeRounding: Decimal;
  rounding: Decimal;
  total: Decimal;
  // discountTotal = itemDiscountTotal + orderDiscount
};

const ZERO = new Decimal(0);

type LineCalc = {
  line: CalcLine;
  grossAmount: Decimal;
  afterItemDisc: Decimal;
};

export function calculateOrder(lines: CalcLine[], s: CalcSettings): CalcResult {
  // 1. grossAmount_i, 2. afterItemDisc_i
  const lineCalcs: LineCalc[] = lines.map((l) => {
    const grossAmount = l.qty.times(l.unitPrice.plus(l.modifierTotal));
    const afterItemDisc = grossAmount.minus(l.itemDiscount);
    return { line: l, grossAmount, afterItemDisc };
  });

  // 3. subtotal, itemDiscountTotal, discountBase
  const subtotal = lineCalcs.reduce((sum, lc) => sum.plus(lc.grossAmount), ZERO);
  const itemDiscountTotal = lines.reduce((sum, l) => sum.plus(l.itemDiscount), ZERO);
  const discountBase = lineCalcs.reduce((sum, lc) => sum.plus(lc.afterItemDisc), ZERO);

  // 4. orderDiscount — ditentukan oleh discountType (CALC-SPEC A.2)
  let orderDiscount: Decimal;
  switch (s.discountType) {
    case "amount":
      orderDiscount = s.orderDiscountAmount;
      break;
    case "percent":
      orderDiscount = s.orderDiscountPercent.times(discountBase);
      break;
    case "none":
      orderDiscount = ZERO;
      break;
  }
  if (s.maxDiscount !== null) {
    orderDiscount = Decimal.min(orderDiscount, s.maxDiscount);
  }
  orderDiscount = Decimal.min(orderDiscount, discountBase);

  // 5. allocated_i (baris terakhir menyerap sisa pembulatan), netAmount_i
  const allocated: Decimal[] = lineCalcs.map(() => ZERO);
  if (!discountBase.isZero()) {
    let allocatedSoFar = ZERO;
    for (let i = 0; i < lineCalcs.length - 1; i++) {
      const share = round2(
        orderDiscount.times(lineCalcs[i]!.afterItemDisc).dividedBy(discountBase)
      );
      allocated[i] = share;
      allocatedSoFar = allocatedSoFar.plus(share);
    }
    const lastIndex = lineCalcs.length - 1;
    if (lastIndex >= 0) {
      allocated[lastIndex] = orderDiscount.minus(allocatedSoFar);
    }
  }
  const netAmount = lineCalcs.map((lc, i) => lc.afterItemDisc.minus(allocated[i]!));

  // 6. netSales
  const netSales = subtotal.minus(itemDiscountTotal).minus(orderDiscount);

  // 7. serviceCharge
  const serviceCharge = round2(s.serviceChargePercent.times(netSales));

  // 8. taxBase
  let taxBase = lineCalcs.reduce(
    (sum, lc, i) => (lc.line.isTaxable ? sum.plus(netAmount[i]!) : sum),
    ZERO
  );
  if (s.serviceChargeInTaxBase) {
    taxBase = taxBase.plus(serviceCharge);
  }

  // 9. taxAmount, totalBeforeRounding
  let taxAmount: Decimal;
  let totalBeforeRounding: Decimal;
  if (s.taxInclusive) {
    const taxDivisor = s.taxPercent.plus(1);
    if (taxDivisor.isZero()) {
      throw new Error(
        "calculateOrder: taxPercent tidak boleh -1 saat taxInclusive true (1 + taxPercent jadi nol)"
      );
    }
    taxAmount = round2(taxBase.minus(taxBase.dividedBy(taxDivisor)));
    totalBeforeRounding = netSales.plus(serviceCharge);
  } else {
    taxAmount = round2(s.taxPercent.times(taxBase));
    totalBeforeRounding = netSales.plus(serviceCharge).plus(taxAmount);
  }

  // 10. total, rounding
  const total = roundTo(totalBeforeRounding, s.roundingTo, s.roundingMode);
  const rounding = total.minus(totalBeforeRounding);

  const resultLines: CalcLineResult[] = lineCalcs.map((lc, i) => ({
    id: lc.line.id,
    grossAmount: lc.grossAmount,
    itemDiscount: lc.line.itemDiscount,
    allocatedOrderDiscount: allocated[i]!,
    netAmount: netAmount[i]!,
  }));

  return {
    lines: resultLines,
    subtotal,
    itemDiscountTotal,
    orderDiscount,
    discountTotal: itemDiscountTotal.plus(orderDiscount),
    netSales,
    serviceCharge,
    taxBase,
    taxAmount,
    totalBeforeRounding,
    rounding,
    total,
  };
}
