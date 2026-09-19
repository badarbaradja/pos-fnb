"use client";

import { ShoppingCartIcon } from "lucide-react";
import { useCartStore } from "@/lib/store/cart-store";
import type { CalcResult } from "@/lib/calc/order-calculator";
import type { PosPaymentMethod } from "@/app/(pos)/pos/get-pos-catalog";
import { EmptyState } from "@/components/ui/empty-state";
import { CartLineRow } from "./cart-line-row";
import { CartSummary } from "./cart-summary";
import { id as strings } from "@/lib/i18n/id";

export function CartPanel({
  calcResult,
  paymentMethods,
  outletId,
  deviceId,
  priceTierId,
}: {
  calcResult: CalcResult;
  paymentMethods: PosPaymentMethod[];
  outletId: string;
  deviceId: string;
  priceTierId: string;
}) {
  const lines = useCartStore((s) => s.lines);
  const removeLine = useCartStore((s) => s.removeLine);
  const setQty = useCartStore((s) => s.setQty);
  const setItemDiscount = useCartStore((s) => s.setItemDiscount);
  const setNote = useCartStore((s) => s.setNote);

  const resultById = new Map(calcResult.lines.map((l) => [l.id, l]));

  return (
    <div className="hidden h-full min-h-0 min-w-0 flex-col border-l bg-background md:flex overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-b bg-card px-3 py-2.5 shadow-xs">
        <h2 className="font-heading text-sm font-semibold">{strings.pos.cartTitle}</h2>
        {lines.length > 0 ? (
          <span className="text-xs text-muted-foreground">
            {lines.length} {lines.length === 1 ? "item" : "items"}
          </span>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {lines.length === 0 ? (
          <EmptyState icon={ShoppingCartIcon} title={strings.pos.cartEmpty} />
        ) : (
          <div className="flex flex-col gap-2.5">
            {lines.map((line) => (
              <CartLineRow
                key={line.id}
                line={line}
                result={resultById.get(line.id)}
                onRemove={() => removeLine(line.id)}
                onQtyChange={(qty) => setQty(line.id, qty)}
                onItemDiscountChange={(amount) => setItemDiscount(line.id, amount)}
                onNoteChange={(note) => setNote(line.id, note)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t bg-card/60 p-3">
        <CartSummary
          calcResult={calcResult}
          paymentMethods={paymentMethods}
          outletId={outletId}
          deviceId={deviceId}
          priceTierId={priceTierId}
        />
      </div>
    </div>
  );
}
