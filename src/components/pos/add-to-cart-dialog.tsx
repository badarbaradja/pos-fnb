"use client";

import { useState } from "react";
import { Decimal } from "decimal.js";
import type { PosProduct } from "@/app/(pos)/pos/get-pos-catalog";
import type { NewCartLine, SelectedModifier } from "@/lib/store/cart-store";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatIDR } from "@/lib/utils/money";
import { id as strings } from "@/lib/i18n/id";

export function AddToCartDialog({
  product,
  priceTierId,
  open,
  onOpenChange,
  onConfirm,
}: {
  product: PosProduct | null;
  priceTierId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (line: NewCartLine) => void;
}) {
  const defaultVariantId =
    product?.variants.find((v) => v.isDefault)?.id ??
    product?.variants[0]?.id ??
    null;
  const [variantId, setVariantId] = useState<string | null>(defaultVariantId);
  const [selectedByGroup, setSelectedByGroup] = useState<Record<string, string[]>>(
    {}
  );

  if (!product) {
    return null;
  }

  // Preview harga di dialog ini juga cuma untuk tampilan -- baris yang
  // benar-benar masuk keranjang tidak menyimpan angka ini (lihat catatan
  // di cart-store.ts), harga baris di-resolve live dari katalog + tier
  // terpilih setiap kali calculateOrder() dipanggil.
  const basePrice = new Decimal(product.pricesByTier[priceTierId] ?? "0");
  const variant = product.variants.find((v) => v.id === variantId) ?? null;
  const unitPrice = variant ? basePrice.plus(variant.priceDelta) : basePrice;

  const allSelectedModifiers: SelectedModifier[] = product.modifierGroups.flatMap(
    (group) =>
      (selectedByGroup[group.id] ?? [])
        .map((modifierId) => group.modifiers.find((m) => m.id === modifierId))
        .filter((m): m is NonNullable<typeof m> => m != null)
        .map((m) => ({ modifierId: m.id, name: m.name, price: new Decimal(m.price) }))
  );
  const modifierTotal = allSelectedModifiers.reduce(
    (sum, m) => sum.plus(m.price),
    new Decimal(0)
  );

  const unmetRequiredGroup = product.modifierGroups.find(
    (group) => (selectedByGroup[group.id] ?? []).length < group.minSelect
  );
  const canConfirm = !unmetRequiredGroup;

  function toggleModifier(groupId: string, modifierId: string, maxSelect: number) {
    setSelectedByGroup((prev) => {
      const current = prev[groupId] ?? [];
      if (current.includes(modifierId)) {
        return { ...prev, [groupId]: current.filter((id) => id !== modifierId) };
      }
      if (current.length >= maxSelect) {
        return prev;
      }
      return { ...prev, [groupId]: [...current, modifierId] };
    });
  }

  function handleConfirm() {
    if (!product || !canConfirm) {
      return;
    }
    onConfirm({
      productId: product.id,
      productName: product.name,
      categoryName: product.categoryName,
      variantId: variant?.id ?? null,
      variantName: variant?.name ?? null,
      modifiers: allSelectedModifiers,
      qty: new Decimal(1),
      isTaxable: product.isTaxable,
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{product.name}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          {product.variants.length > 0 ? (
            <div className="flex flex-col gap-2">
              <Label>{strings.pos.variantLabel}</Label>
              <div className="flex flex-col gap-1.5">
                {product.variants.map((v) => (
                  <label
                    key={v.id}
                    className="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm"
                  >
                    <span className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="variant"
                        checked={variantId === v.id}
                        onChange={() => setVariantId(v.id)}
                      />
                      {v.name}
                    </span>
                    <span className="text-muted-foreground">
                      {v.priceDelta !== "0" && v.priceDelta !== "0.00"
                        ? `+${formatIDR(new Decimal(v.priceDelta))}`
                        : null}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {product.modifierGroups.map((group) => (
            <div key={group.id} className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Label>{group.name}</Label>
                {group.minSelect > 0 ? (
                  <span className="text-xs text-destructive">
                    {strings.pos.modifierRequiredBadge}
                  </span>
                ) : null}
                <span className="text-xs text-muted-foreground">
                  {strings.pos.modifierMinMax
                    .replace("{min}", String(group.minSelect))
                    .replace("{max}", String(group.maxSelect))}
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                {group.modifiers.map((m) => {
                  const checked = (selectedByGroup[group.id] ?? []).includes(m.id);
                  return (
                    <div
                      key={m.id}
                      className="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={`modifier-${m.id}`}
                          checked={checked}
                          onCheckedChange={() =>
                            toggleModifier(group.id, m.id, group.maxSelect)
                          }
                        />
                        <Label htmlFor={`modifier-${m.id}`}>{m.name}</Label>
                      </div>
                      {m.price !== "0" && m.price !== "0.00" ? (
                        <span className="text-muted-foreground">
                          +{formatIDR(new Decimal(m.price))}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="flex items-center justify-between border-t pt-3 text-sm font-medium">
            <span>{product.name}</span>
            <span>{formatIDR(unitPrice.plus(modifierTotal))}</span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {strings.pos.cancel}
          </Button>
          <Button onClick={handleConfirm} disabled={!canConfirm}>
            {strings.pos.addToCart}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
