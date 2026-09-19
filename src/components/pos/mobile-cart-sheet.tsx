"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { ShoppingCartIcon, XIcon } from "lucide-react";
import { useCartStore } from "@/lib/store/cart-store";
import type { CalcResult } from "@/lib/calc/order-calculator";
import type { PosPaymentMethod } from "@/app/(pos)/pos/get-pos-catalog";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { CartLineRow } from "./cart-line-row";
import { CartSummary } from "./cart-summary";
import { id as strings } from "@/lib/i18n/id";

/**
 * Bottom sheet keranjang, mobile-only (T18b) -- dialog base-ui di-style
 * ulang jadi slide-up dari bawah, SENGAJA bukan pakai DialogContent yang
 * sudah ada (components/ui/dialog.tsx, di-style modal tengah layar) supaya
 * dialog lain di app tidak ikut berubah. Isinya sama persis dengan
 * CartPanel (baris item + CartSummary), tapi sebagai konten sheet yang
 * scroll alami -- tidak butuh trik fixed+portal terpisah untuk tombol
 * Bayar seperti CartPanel desktop, karena sheet ini sendiri sudah jadi
 * overlay dengan batas tinggi sendiri (max-h-[85dvh] + overflow-y-auto
 * di body-nya).
 */
export function MobileCartSheet({
  open,
  onOpenChange,
  calcResult,
  paymentMethods,
  outletId,
  deviceId,
  priceTierId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/30 duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 md:hidden" />
        <DialogPrimitive.Popup className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-2xl bg-background outline-none duration-200 data-open:animate-in data-open:slide-in-from-bottom data-closed:animate-out data-closed:slide-out-to-bottom md:hidden">
          <div className="flex shrink-0 justify-center pt-2.5">
            <div className="h-1.5 w-10 rounded-full bg-muted-foreground/25" />
          </div>
          <div className="flex shrink-0 items-center justify-between border-b p-4 pt-2">
            <DialogPrimitive.Title className="font-heading text-sm font-semibold">
              {strings.pos.cartTitle}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close render={<Button variant="ghost" size="icon-touch" />}>
              <XIcon />
              <span className="sr-only">{strings.pos.closeCart}</span>
            </DialogPrimitive.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {lines.length === 0 ? (
              <EmptyState icon={ShoppingCartIcon} title={strings.pos.cartEmpty} />
            ) : (
              <div className="flex flex-col gap-3">
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

          <div className="flex shrink-0 flex-col gap-3 border-t bg-card p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
            <CartSummary
              calcResult={calcResult}
              paymentMethods={paymentMethods}
              outletId={outletId}
              deviceId={deviceId}
              priceTierId={priceTierId}
              onPaySuccess={() => onOpenChange(false)}
            />
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
