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
      className="group flex flex-col justify-between rounded-xl border bg-card p-2 text-left shadow-xs transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md active:translate-y-0 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-xs sm:p-2.5 min-w-0"
    >
      <div className="relative h-16 w-full shrink-0 overflow-hidden rounded-md bg-muted sm:h-20">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed URL Supabase Storage, bukan aset Next static
          <img
            src={product.imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <ProductInitialsAvatar
            name={product.name}
            className="h-full w-full !aspect-auto rounded-md text-xs font-bold sm:text-sm"
          />
        )}
      </div>
      <div className="flex w-full flex-1 flex-col justify-between pt-1.5 min-w-0">
        <span className="line-clamp-2 text-xs font-medium leading-tight sm:text-sm" title={product.name}>
          {product.name}
        </span>
        <div className="mt-1 flex items-center justify-between gap-1">
          {/* Harga TIDAK pakai warna accent -- setiap kartu menampilkan
              harga, memberi semuanya warna primary akan membanjiri layar
              (instruksi eksplisit Phase 2: hindari semua elemen memakai
              accent color sekaligus). Accent disimpan utk aksi/status aktif. */}
          {priceNotSet ? (
            <span className="text-[11px] text-muted-foreground">{strings.pos.priceNotSet}</span>
          ) : (
            <span className="text-xs font-semibold tabular-nums sm:text-sm">
              {formatIDR(basePrice)}
            </span>
          )}
          {hasChoices ? (
            <span className="rounded-full bg-muted px-1.5 py-0.2 text-[0.65rem] font-bold text-muted-foreground">
              +
            </span>
          ) : null}
        </div>
      </div>
    </button>
  );
}
