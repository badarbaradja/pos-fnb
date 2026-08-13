"use client";

import { Decimal } from "decimal.js";
import type { PosProduct } from "@/app/(pos)/pos/get-pos-catalog";
import { formatIDR } from "@/lib/utils/money";

export function ProductCard({
  product,
  priceTierId,
  onSelect,
}: {
  product: PosProduct;
  priceTierId: string;
  onSelect: (product: PosProduct) => void;
}) {
  const basePrice = new Decimal(product.pricesByTier[priceTierId] ?? "0");
  const hasChoices = product.variants.length > 0 || product.modifierGroups.length > 0;

  return (
    <button
      type="button"
      onClick={() => onSelect(product)}
      className="flex flex-col items-start gap-1 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted"
    >
      <span className="text-sm font-medium">{product.name}</span>
      <span className="text-xs text-muted-foreground">
        {formatIDR(basePrice)}
        {hasChoices ? "+" : ""}
      </span>
    </button>
  );
}
