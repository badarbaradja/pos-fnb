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
 * yang punya TC-13 eksplisit 2 desimal.
 *
 * `occupancyCostPercent` dan `bepPorsi` tidak ada di draf awal CALC-SPEC
 * bagian D dan ditambahkan atas permintaan eksplisit — occupancyCostPercent
 * mengikuti pola laborCostPercent (cost/netSales×100) yang sudah ada,
 * bepPorsi adalah rumus BEP-unit standar: fixedCost / (avgPrice − avgHpp).
 */

export function foodCostPercent(cogs: Decimal, netSales: Decimal): Decimal | null {
  if (netSales.isZero()) return null;
  return cogs.dividedBy(netSales).times(100);
}

export function laborCostPercent(
  laborCost: Decimal,
  netSales: Decimal
): Decimal | null {
  if (netSales.isZero()) return null;
  return laborCost.dividedBy(netSales).times(100);
}

export function occupancyCostPercent(
  occupancyCost: Decimal,
  netSales: Decimal
): Decimal | null {
  if (netSales.isZero()) return null;
  return occupancyCost.dividedBy(netSales).times(100);
}

/** target ≤ 65% (aturan operasional, bukan dicek/ditegakkan di sini) */
export function primeCostPercent(
  foodCostPct: Decimal | null,
  laborCostPct: Decimal | null
): Decimal | null {
  if (foodCostPct === null || laborCostPct === null) return null;
  return foodCostPct.plus(laborCostPct);
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
  return voidCount.dividedBy(orderCount).times(100);
}

export function discountRate(
  discountTotal: Decimal,
  grossSales: Decimal
): Decimal | null {
  if (grossSales.isZero()) return null;
  return discountTotal.dividedBy(grossSales).times(100);
}

export function wastePercent(wasteValue: Decimal, cogs: Decimal): Decimal | null {
  if (cogs.isZero()) return null;
  return wasteValue.dividedBy(cogs).times(100);
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

export function marginOfSafetyPercent(
  netSales: Decimal,
  bepRupiah: Decimal | null
): Decimal | null {
  if (netSales.isZero() || bepRupiah === null) return null;
  return netSales.minus(bepRupiah).dividedBy(netSales).times(100);
}
