"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Decimal } from "decimal.js";
import { toast } from "sonner";
import {
  getRefundableItems,
  refundOrder,
  voidOrder,
  type RefundableItem,
} from "@/app/(pos)/pos/receipt/actions";
import type { RefundPaymentMethod } from "@/lib/pos/void-refund";
import type { OrderListRow } from "@/app/(pos)/pos/receipt/list-orders";
import { generateId } from "@/lib/utils/id";
import { formatIDR } from "@/lib/utils/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { id as strings } from "@/lib/i18n/id";

function VoidDialog({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [isPending, setIsPending] = useState(false);

  async function handleConfirm() {
    setIsPending(true);
    try {
      const result = await voidOrder({ orderId, reason });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(strings.voidRefund.voidSuccess);
      setOpen(false);
      setReason("");
      router.refresh();
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="destructive" size="sm">
            {strings.voidRefund.voidButton}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{strings.voidRefund.voidDialogTitle}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          <p className="text-sm text-muted-foreground">{strings.voidRefund.voidDialogHint}</p>
          <div className="flex flex-col gap-1">
            <Label htmlFor="voidReason">{strings.voidRefund.voidReasonLabel}</Label>
            <Textarea
              id="voidReason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={strings.voidRefund.voidReasonPlaceholder}
              required
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            {strings.pos.cancel}
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={isPending || !reason.trim()}
          >
            {isPending ? strings.common.saving : strings.voidRefund.voidConfirmButton}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RefundDialog({
  orderId,
  paymentMethods,
}: {
  orderId: string;
  paymentMethods: RefundPaymentMethod[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [items, setItems] = useState<RefundableItem[]>([]);
  const [qtyByItem, setQtyByItem] = useState<Record<string, string>>({});
  const [paymentMethodId, setPaymentMethodId] = useState(paymentMethods[0]?.id ?? "");
  const [reference, setReference] = useState("");
  const [restock, setRestock] = useState(false);
  const [reason, setReason] = useState("");

  async function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setQtyByItem({});
      setReference("");
      setRestock(false);
      setReason("");
      return;
    }
    setIsLoading(true);
    try {
      const rows = await getRefundableItems(orderId);
      setItems(rows);
    } finally {
      setIsLoading(false);
    }
  }

  const selectedMethod = paymentMethods.find((pm) => pm.id === paymentMethodId);

  const total = items.reduce((sum, item) => {
    const qty = qtyByItem[item.orderItemId];
    if (!qty || new Decimal(qty).lessThanOrEqualTo(0)) return sum;
    const originalQty = new Decimal(item.qty);
    const lineAmount = new Decimal(item.netAmount)
      .times(new Decimal(qty))
      .dividedBy(originalQty)
      .toDecimalPlaces(2);
    return sum.plus(lineAmount);
  }, new Decimal(0));

  async function handleConfirm() {
    const lines = Object.entries(qtyByItem)
      .filter(([, qty]) => qty && new Decimal(qty).greaterThan(0))
      .map(([orderItemId, qty]) => ({ orderItemId, qty }));
    if (lines.length === 0) {
      toast.error(strings.voidRefund.refundNoItemsSelected);
      return;
    }

    setIsPending(true);
    try {
      const result = await refundOrder({
        id: generateId(),
        orderId,
        paymentMethodId,
        reference,
        restock,
        reason,
        lines,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(strings.voidRefund.refundSuccess);
      setOpen(false);
      router.refresh();
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            {strings.voidRefund.refundButton}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{strings.voidRefund.refundDialogTitle}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">{strings.common.loading}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="p-2 font-medium">{strings.voidRefund.refundColItem}</th>
                    <th className="p-2 text-right font-medium">
                      {strings.voidRefund.refundColQtyRemaining}
                    </th>
                    <th className="p-2 text-right font-medium">
                      {strings.voidRefund.refundColQtyToRefund}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const remaining = new Decimal(item.qty).minus(item.refundedQty);
                    return (
                      <tr key={item.orderItemId} className="border-t">
                        <td className="p-2">
                          {item.productName}
                          {item.variantName ? ` (${item.variantName})` : ""}
                        </td>
                        <td className="p-2 text-right">{remaining.toString()}</td>
                        <td className="p-2 text-right">
                          <Input
                            type="number"
                            min={0}
                            max={remaining.toNumber()}
                            step="0.01"
                            className="w-20 text-right"
                            disabled={remaining.lessThanOrEqualTo(0)}
                            value={qtyByItem[item.orderItemId] ?? ""}
                            onChange={(e) =>
                              setQtyByItem((prev) => ({
                                ...prev,
                                [item.orderItemId]: e.target.value,
                              }))
                            }
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <Label className="text-xs">{strings.voidRefund.refundMethodLabel}</Label>
            <div className="flex flex-wrap gap-1">
              {paymentMethods.map((pm) => (
                <Button
                  key={pm.id}
                  type="button"
                  size="sm"
                  variant={paymentMethodId === pm.id ? "default" : "outline"}
                  onClick={() => setPaymentMethodId(pm.id)}
                >
                  {pm.name}
                </Button>
              ))}
            </div>
          </div>

          {selectedMethod?.requiresRef ? (
            <div className="flex flex-col gap-1">
              <Label htmlFor="refundReference">{strings.voidRefund.refundReferenceLabel}</Label>
              <Input
                id="refundReference"
                value={reference}
                placeholder={strings.voidRefund.refundReferencePlaceholder}
                onChange={(e) => setReference(e.target.value)}
              />
            </div>
          ) : null}

          <div className="flex items-center gap-2">
            <Checkbox
              id="restock"
              checked={restock}
              onCheckedChange={(checked) => setRestock(checked === true)}
            />
            <Label htmlFor="restock" className="text-sm font-normal">
              {strings.voidRefund.refundRestockLabel}
            </Label>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="refundReason">{strings.voidRefund.refundReasonLabel}</Label>
            <Textarea
              id="refundReason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={strings.voidRefund.refundReasonPlaceholder}
              required
            />
          </div>

          <div className="flex items-center justify-between border-t pt-3 text-sm font-semibold">
            <span>{strings.voidRefund.refundTotalLabel}</span>
            <span>{formatIDR(total)}</span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            {strings.pos.cancel}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isPending || !reason.trim() || !paymentMethodId || total.lessThanOrEqualTo(0)}
          >
            {isPending ? strings.common.saving : strings.voidRefund.refundConfirmButton}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function OrderRowActions({
  row,
  paymentMethods,
}: {
  row: OrderListRow;
  paymentMethods: RefundPaymentMethod[];
}) {
  if (row.status !== "paid") {
    return null;
  }

  return (
    <div className="flex gap-1">
      <RefundDialog orderId={row.id} paymentMethods={paymentMethods} />
      <VoidDialog orderId={row.id} />
    </div>
  );
}
