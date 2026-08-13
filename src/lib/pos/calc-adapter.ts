import { Decimal } from "decimal.js";
import { calculateOrder, type CalcLine, type CalcSettings } from "../calc/order-calculator";
import type { CartLine, DiscountType } from "../store/cart-store";
import type { PosProduct } from "@/app/(pos)/pos/get-pos-catalog";

/**
 * Satu-satunya jembatan antara state keranjang (Zustand) dan
 * lib/calc/order-calculator.ts. Semua komponen POS WAJIB membaca angka
 * kalkulasi lewat hasil calculateOrder() ini -- jangan ada komponen yang
 * menjumlahkan subtotal/diskon sendiri (kesepakatan T12).
 */

export type OutletCalcConfig = {
  taxPercent: string; // dari outlets, skala 0-100 (mis. "10"), BUKAN pecahan
  taxInclusive: boolean;
  serviceChargePercent: string; // skala 0-100
  serviceChargeInTaxBase: boolean;
  roundingTo: number;
};

/**
 * Harga produk baris ini untuk tingkat harga yang sedang dipilih --
 * pricesByTier + priceDelta varian sudah ada di memori (katalog di-fetch
 * sekali), jadi ganti tier tidak perlu query ulang.
 */
function resolveUnitPrice(
  line: CartLine,
  products: PosProduct[],
  priceTierId: string
): Decimal {
  const product = products.find((p) => p.id === line.productId);
  const basePrice = new Decimal(product?.pricesByTier[priceTierId] ?? "0");
  const variant = product?.variants.find((v) => v.id === line.variantId);
  const variantDelta = variant ? new Decimal(variant.priceDelta) : new Decimal(0);
  return basePrice.plus(variantDelta);
}

function toCalcLine(
  line: CartLine,
  products: PosProduct[],
  priceTierId: string
): CalcLine {
  const modifierTotal = line.modifiers.reduce(
    (sum, m) => sum.plus(m.price),
    new Decimal(0)
  );
  return {
    id: line.id,
    qty: line.qty,
    unitPrice: resolveUnitPrice(line, products, priceTierId),
    modifierTotal, // TC-01: modifier masuk ke sini, bukan baris terpisah
    itemDiscount: line.itemDiscount,
    isTaxable: line.isTaxable,
  };
}

function toCalcSettings(
  outlet: OutletCalcConfig,
  discountType: DiscountType,
  orderDiscountAmount: Decimal,
  orderDiscountPercentInput: Decimal
): CalcSettings {
  return {
    discountType,
    // Konversi skala 0-100 -> pecahan dilakukan di sini (layer pemanggil),
    // bukan di dalam kalkulator (docs/03-CALC-SPEC.md A.1).
    orderDiscountPercent: orderDiscountPercentInput.dividedBy(100),
    orderDiscountAmount,
    maxDiscount: null,
    serviceChargePercent: new Decimal(outlet.serviceChargePercent).dividedBy(100),
    taxPercent: new Decimal(outlet.taxPercent).dividedBy(100),
    taxInclusive: outlet.taxInclusive,
    serviceChargeInTaxBase: outlet.serviceChargeInTaxBase,
    roundingTo: outlet.roundingTo,
    roundingMode: "nearest", // default CALC-SPEC A.1, tidak ada kolom outlet untuk ini
  };
}

export function calculateCart(
  lines: CartLine[],
  products: PosProduct[],
  priceTierId: string,
  outlet: OutletCalcConfig,
  discountType: DiscountType,
  orderDiscountAmount: Decimal,
  orderDiscountPercentInput: Decimal
) {
  const calcLines = lines.map((line) => toCalcLine(line, products, priceTierId));
  const settings = toCalcSettings(
    outlet,
    discountType,
    orderDiscountAmount,
    orderDiscountPercentInput
  );
  return calculateOrder(calcLines, settings);
}
