import { Decimal } from "../utils/money";

/**
 * KPI — CALC-SPEC bagian D. Fungsi murni: tanpa akses database, tanpa
 * fetch, tanpa Date.now().
 *
 * Setiap fungsi di bawah adalah satu rumus pembagian berdiri sendiri
 * (bukan satu fungsi besar) supaya tiap pembagian punya test pembagi-nol
 * sendiri-sendiri. SETIAP pembagi nol mengembalikan `null`, bukan `NaN`
 * atau `Infinity`. Tidak ada rumus di sini yang dibulatkan (round2) karena
 * tidak ada golden test yang menuntut presisi tertentu — beda dari pnl.ts
 * yang punya TC-13 eksplisit.
 *
 * Semua fungsi berakhiran `Rate`/`Ratio` mengembalikan PECAHAN (0.3 = 30%),
 * konsisten dengan seluruh lib/calc/ (order-calculator.ts, cogs.ts, pnl.ts).
 * Konversi ke skala persen untuk tampilan dilakukan di layer UI. Sebelumnya
 * sebagian fungsi di sini (yang berakhiran *Percent, dan voidRate/discountRate
 * yang sudah dikali 100 walau namanya "Rate") mengembalikan skala 0-100 —
 * sudah diperbaiki supaya seragam.
 *
 * `wasteToCogsRate` (sebelumnya `wastePercent`) sengaja dinamai eksplisit
 * "ToCogs" supaya tidak bentrok dengan `prepWasteRate` di cogs.ts — dua
 * konsep berbeda: itu waste persiapan bahan per resep, ini rasio nilai
 * waste terhadap cogs.
 */

export function foodCostRate(cogs: Decimal, netSales: Decimal): Decimal | null {
  if (netSales.isZero()) return null;
  return cogs.dividedBy(netSales);
}

export function laborCostRate(
  laborCost: Decimal,
  netSales: Decimal
): Decimal | null {
  if (netSales.isZero()) return null;
  return laborCost.dividedBy(netSales);
}

export function occupancyCostRate(
  occupancyCost: Decimal,
  netSales: Decimal
): Decimal | null {
  if (netSales.isZero()) return null;
  return occupancyCost.dividedBy(netSales);
}

/** target ≤ 0.65 (65%) (aturan operasional, bukan dicek/ditegakkan di sini) */
export function primeCostRate(
  foodCostRateValue: Decimal | null,
  laborCostRateValue: Decimal | null
): Decimal | null {
  if (foodCostRateValue === null || laborCostRateValue === null) return null;
  return foodCostRateValue.plus(laborCostRateValue);
}

export function averageCheck(
  netSales: Decimal,
  orderCount: Decimal
): Decimal | null {
  if (orderCount.isZero()) return null;
  return netSales.dividedBy(orderCount);
}

export function salesPerGuest(
  netSales: Decimal,
  guestCount: Decimal
): Decimal | null {
  if (guestCount.isZero()) return null;
  return netSales.dividedBy(guestCount);
}

export function voidRate(
  voidCount: Decimal,
  orderCount: Decimal
): Decimal | null {
  if (orderCount.isZero()) return null;
  return voidCount.dividedBy(orderCount);
}

export function discountRate(
  discountTotal: Decimal,
  grossSales: Decimal
): Decimal | null {
  if (grossSales.isZero()) return null;
  return discountTotal.dividedBy(grossSales);
}

export function wasteToCogsRate(
  wasteValue: Decimal,
  cogs: Decimal
): Decimal | null {
  if (cogs.isZero()) return null;
  return wasteValue.dividedBy(cogs);
}

export function contributionMarginRatio(
  netSales: Decimal,
  variableCost: Decimal
): Decimal | null {
  if (netSales.isZero()) return null;
  return netSales.minus(variableCost).dividedBy(netSales);
}

export function bepRupiah(
  fixedCost: Decimal,
  contributionMarginRatio: Decimal | null
): Decimal | null {
  if (contributionMarginRatio === null || contributionMarginRatio.isZero()) {
    return null;
  }
  return fixedCost.dividedBy(contributionMarginRatio);
}

/** BEP dalam jumlah porsi: fixedCost / (avgPrice − avgHpp). */
export function bepPorsi(
  fixedCost: Decimal,
  avgPrice: Decimal,
  avgHpp: Decimal
): Decimal | null {
  const marginPerPorsi = avgPrice.minus(avgHpp);
  if (marginPerPorsi.isZero()) return null;
  return fixedCost.dividedBy(marginPerPorsi);
}

export function marginOfSafetyRate(
  netSales: Decimal,
  bepRupiah: Decimal | null
): Decimal | null {
  if (netSales.isZero() || bepRupiah === null) return null;
  return netSales.minus(bepRupiah).dividedBy(netSales);
}
