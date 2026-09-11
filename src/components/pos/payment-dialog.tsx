"use client";

import { useState } from "react";
import { Decimal } from "decimal.js";
import { toast } from "sonner";
import { useCartStore } from "@/lib/store/cart-store";
import type { CalcResult } from "@/lib/calc/order-calculator";
import type { PosPaymentMethod } from "@/app/(pos)/pos/get-pos-catalog";
import { payOrder } from "@/app/(pos)/pos/actions";
import { generateId } from "@/lib/utils/id";
import { formatIDR } from "@/lib/utils/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { id as strings } from "@/lib/i18n/id";

type PaymentRow = { id: string; paymentMethodId: string; amount: string; reference: string };

/**
 * Dipasang lewat `key` di CartPanel supaya remount penuh setiap dialog ini
 * dibuka -- orderId dan baris pembayaran harus segar per sesi checkout,
 * tapi STABIL selama dialog ini terbuka (termasuk saat "Konfirmasi Bayar"
 * ditekan berkali-kali/double-tap) supaya payOrder() di server bisa
 * mengenali submit ganda lewat id yang sama (docs/04-CATATAN-TEKNIS.md §9).
 */
export function PaymentDialog({
  open,
  onOpenChange,
  calcResult,
  paymentMethods,
  outletId,
  deviceId,
  priceTierId,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  calcResult: CalcResult;
  paymentMethods: PosPaymentMethod[];
  outletId: string;
  deviceId: string;
  priceTierId: string;
  onSuccess: (result: { orderId: string; orderNumber: string; change: string }) => void;
}) {
  const lines = useCartStore((s) => s.lines);
  const discountType = useCartStore((s) => s.discountType);
  const orderDiscountAmount = useCartStore((s) => s.orderDiscountAmount);
  const orderDiscountPercentInput = useCartStore((s) => s.orderDiscountPercentInput);

  const [orderId] = useState(() => generateId());
  const [rows, setRows] = useState<PaymentRow[]>(() => [
    {
      id: generateId(),
      paymentMethodId: paymentMethods[0]?.id ?? "",
      amount: calcResult.total.toFixed(2),
      reference: "",
    },
  ]);
  const [isPending, setIsPending] = useState(false);

  const totalReceived = rows.reduce(
    (sum, r) => sum.plus(r.amount === "" ? "0" : r.amount),
    new Decimal(0)
  );
  const change = Decimal.max(0, totalReceived.minus(calcResult.total));
  const canConfirm = totalReceived.greaterThanOrEqualTo(calcResult.total) && !isPending;

  function updateRow(id: string, patch: Partial<PaymentRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      {
        id: generateId(),
        paymentMethodId: paymentMethods[0]?.id ?? "",
        amount: "0",
        reference: "",
      },
    ]);
  }

  function removeRow(id: string) {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));
  }

  async function handleConfirm() {
    setIsPending(true);
    try {
      const result = await payOrder({
        orderId,
        outletId,
        deviceId,
        priceTierId,
        lines: lines.map((l) => ({
          id: l.id,
          productId: l.productId,
          variantId: l.variantId,
          modifierIds: l.modifiers.map((m) => m.modifierId),
          qty: l.qty.toString(),
          itemDiscount: l.itemDiscount.toString(),
          note: l.note,
        })),
        discountType,
        orderDiscountAmount: orderDiscountAmount.toString(),
        orderDiscountPercentInput: orderDiscountPercentInput.toString(),
        payments: rows.map((r) => ({
          id: r.id,
          paymentMethodId: r.paymentMethodId,
          amount: r.amount === "" ? "0" : r.amount,
          reference: r.reference,
        })),
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      if (result.success) {
        onSuccess(result.success);
        onOpenChange(false);
      }
    } catch (err) {
      console.error("Bayar pesanan gagal:", err);
      toast.error(err instanceof Error ? err.message : strings.common.unexpectedError);
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{strings.pos.paymentDialogTitle}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex items-center justify-between text-sm font-medium">
            <span>{strings.pos.totalDue}</span>
            <span>{formatIDR(calcResult.total)}</span>
          </div>

          <div className="flex flex-col gap-3">
            {rows.map((row) => {
              const selectedMethod = paymentMethods.find(
                (pm) => pm.id === row.paymentMethodId
              );
              return (
                <div key={row.id} className="flex flex-col gap-2 rounded-lg border p-2">
                  <div className="flex items-end gap-2">
                    <div className="flex flex-1 flex-col gap-1">
                      <Label className="text-xs">{strings.pos.paymentMethodLabel}</Label>
                      <div className="flex flex-wrap gap-1">
                        {paymentMethods.map((pm) => (
                          <Button
                            key={pm.id}
                            type="button"
                            size="sm"
                            variant={row.paymentMethodId === pm.id ? "default" : "outline"}
                            onClick={() => updateRow(row.id, { paymentMethodId: pm.id })}
                          >
                            {pm.name}
                          </Button>
                        ))}
                      </div>
                    </div>
                    <div className="flex w-32 flex-col gap-1">
                      <Label className="text-xs">{strings.pos.paymentAmountLabel}</Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={row.amount}
                        onChange={(e) => updateRow(row.id, { amount: e.target.value })}
                      />
                    </div>
                    {rows.length > 1 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeRow(row.id)}
                      >
                        {strings.pos.removePaymentRow}
                      </Button>
                    ) : null}
                  </div>
                  {selectedMethod?.requiresRef ? (
                    <div className="flex flex-col gap-1">
                      <Label className="text-xs">{strings.pos.paymentReferenceLabel}</Label>
                      <Input
                        value={row.reference}
                        placeholder={strings.pos.paymentReferencePlaceholder}
                        onChange={(e) => updateRow(row.id, { reference: e.target.value })}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={addRow}
          >
            {strings.pos.addPaymentRow}
          </Button>

          <div className="flex flex-col gap-1 border-t pt-3 text-sm">
            <div className="flex items-center justify-between text-muted-foreground">
              <span>{strings.pos.totalReceived}</span>
              <span>{formatIDR(totalReceived)}</span>
            </div>
            <div className="flex items-center justify-between text-base font-semibold">
              <span>{strings.pos.changeDue}</span>
              <span>{formatIDR(change)}</span>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            {strings.pos.cancel}
          </Button>
          <Button onClick={handleConfirm} disabled={!canConfirm}>
            {isPending ? strings.pos.processingPayment : strings.pos.confirmPayment}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
