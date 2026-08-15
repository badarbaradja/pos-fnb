"use client";

import { Decimal } from "decimal.js";
import type { PosProduct } from "@/app/(pos)/pos/get-pos-catalog";
import { ProductInitialsAvatar } from "@/components/products/product-initials-avatar";
import { formatIDR } from "@/lib/utils/money";
import { id as strings } from "@/lib/i18n/id";

export function ProductCard({
  product,
  priceTierId,
  onSelect,
}: {
  product: PosProduct;
  priceTierId: string;
  onSelect: (product: PosProduct) => void;
}) {
  // Key TIDAK ADA di pricesByTier (bukan string "0") berarti produk ini
  // sungguh belum diberi harga di tier ini -- beda dari harga gratis yang
  // memang sengaja (T09c). Menjual tanpa harga harus MUSTAHIL, bukan
  // sekadar tidak disarankan, jadi kartunya dinonaktifkan total di sini
  // (bukan cuma validasi server) supaya tidak ada jalur sama sekali untuk
  // menambah baris ini ke keranjang.
  const priceStr = product.pricesByTier[priceTierId];
  const priceNotSet = priceStr === undefined;
  const basePrice = new Decimal(priceStr ?? "0");
  const hasChoices = product.variants.length > 0 || product.modifierGroups.length > 0;

  return (
    <button
      type="button"
      disabled={priceNotSet}
      onClick={() => onSelect(product)}
      className="flex flex-col items-start gap-1.5 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-card"
    >
      {product.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed URL Supabase Storage, bukan aset Next static
        <img
          src={product.imageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="aspect-square w-full rounded-md object-cover"
        />
      ) : (
        <ProductInitialsAvatar name={product.name} />
      )}
      <span className="text-sm font-medium">{product.name}</span>
      <span className="text-xs text-muted-foreground">
        {priceNotSet ? (
          strings.pos.priceNotSet
        ) : (
          <>
            {formatIDR(basePrice)}
            {hasChoices ? "+" : ""}
          </>
        )}
      </span>
    </button>
  );
}
