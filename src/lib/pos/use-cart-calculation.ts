"use client";

import { useCartStore } from "../store/cart-store";
import { calculateCart, type OutletCalcConfig } from "./calc-adapter";
import type { PosProduct } from "@/app/(pos)/pos/get-pos-catalog";

/**
 * Satu-satunya tempat calculateOrder() dipanggil di layar kasir (T12).
 * Panggil ini SEKALI di komponen root POS, lalu turunkan hasilnya (CalcResult)
 * ke komponen anak lewat props -- jangan panggil ulang di tempat lain.
 */
export function useCartCalculation(
  products: PosProduct[],
  priceTierId: string,
  outlet: OutletCalcConfig
) {
  const lines = useCartStore((s) => s.lines);
  const discountType = useCartStore((s) => s.discountType);
  const orderDiscountAmount = useCartStore((s) => s.orderDiscountAmount);
  const orderDiscountPercentInput = useCartStore(
    (s) => s.orderDiscountPercentInput
  );

  return calculateCart(
    lines,
    products,
    priceTierId,
    outlet,
    discountType,
    orderDiscountAmount,
    orderDiscountPercentInput
  );
}
