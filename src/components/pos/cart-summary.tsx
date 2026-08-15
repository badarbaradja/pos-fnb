"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Decimal } from "decimal.js";
import { toast } from "sonner";
import { useCartStore, type DiscountType } from "@/lib/store/cart-store";
import type { CalcResult } from "@/lib/calc/order-calculator";
import type { PosPaymentMethod } from "@/app/(pos)/pos/get-pos-catalog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PaymentDialog } from "./payment-dialog";
import { TotalRow } from "./total-row";
import { id as strings } from "@/lib/i18n/id";

/**
 * Blok diskon + total + tombol Bayar + PaymentDialog, diekstrak dari
 * cart-panel.tsx (T18b) supaya dipakai ulang PERSIS SAMA di CartPanel
 * (panel sisi desktop/tablet) dan MobileCartSheet (bottom sheet mobile) --
 * bukan diduplikasi, supaya logika checkout tidak bisa menyimpang antara
 * dua tempat itu. Self-sufficient: baca state diskon langsung dari
 * useCartStore, kelola sendiri buka/tutup PaymentDialog.
 *
 * `onPaySuccess` opsional -- dipanggil SETELAH clear cart + sebelum
 * redirect, dipakai MobileCartSheet untuk menutup sheet-nya sendiri.
 * CartPanel (desktop) tidak perlu ini karena tidak ada sheet untuk
 * ditutup.
 */
export function CartSummary({
  calcResult,
  paymentMethods,
  outletId,
  deviceId,
  priceTierId,
  onPaySuccess,
}: {
  calcResult: CalcResult;
  paymentMethods: PosPaymentMethod[];
  outletId: string;
  deviceId: string;
  priceTierId: string;
  onPaySuccess?: () => void;
}) {
  const router = useRouter();
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [paymentDialogKey, setPaymentDialogKey] = useState(0);
  const lines = useCartStore((s) => s.lines);
  const discountType = useCartStore((s) => s.discountType);
  const orderDiscountAmount = useCartStore((s) => s.orderDiscountAmount);
  const orderDiscountPercentInput = useCartStore((s) => s.orderDiscountPercentInput);
  const setDiscountType = useCartStore((s) => s.setDiscountType);
  const setOrderDiscountAmount = useCartStore((s) => s.setOrderDiscountAmount);
  const setOrderDiscountPercentInput = useCartStore(
    (s) => s.setOrderDiscountPercentInput
  );

  return (
    <>
      <div className="flex flex-col gap-2">
        <Label>{strings.pos.orderDiscountTitle}</Label>
        <div className="flex gap-2">
          {(
            [
              ["none", strings.pos.discountTypeNone],
              ["amount", strings.pos.discountTypeAmount],
              ["percent", strings.pos.discountTypePercent],
            ] as [DiscountType, string][]
          ).map(([type, label]) => (
            <Button
              key={type}
              type="button"
              size="sm"
              className="h-11"
              variant={discountType === type ? "default" : "outline"}
              onClick={() => setDiscountType(type)}
            >
              {label}
            </Button>
          ))}
        </div>
        {discountType === "amount" ? (
          <Input
            type="number"
            min={0}
            step="0.01"
            value={orderDiscountAmount.toString()}
            onChange={(e) =>
              setOrderDiscountAmount(
                e.target.value === "" ? new Decimal(0) : new Decimal(e.target.value)
              )
            }
            placeholder={strings.pos.orderDiscountAmountLabel}
          />
        ) : null}
        {discountType === "percent" ? (
          <Input
            type="number"
            min={0}
            max={100}
            step="0.01"
            value={orderDiscountPercentInput.toString()}
            onChange={(e) =>
              setOrderDiscountPercentInput(
                e.target.value === "" ? new Decimal(0) : new Decimal(e.target.value)
              )
            }
            placeholder={strings.pos.orderDiscountPercentLabel}
          />
        ) : null}
      </div>

      <div className="flex flex-col gap-1 text-sm">
        <TotalRow label={strings.pos.subtotal} value={calcResult.subtotal} />
        {!calcResult.itemDiscountTotal.isZero() ? (
          <TotalRow
            label={strings.pos.itemDiscountTotal}
            value={calcResult.itemDiscountTotal.negated()}
          />
        ) : null}
        {!calcResult.orderDiscount.isZero() ? (
          <TotalRow
            label={strings.pos.orderDiscount}
            value={calcResult.orderDiscount.negated()}
          />
        ) : null}
        <TotalRow label={strings.pos.netSales} value={calcResult.netSales} />
        <TotalRow label={strings.pos.serviceCharge} value={calcResult.serviceCharge} />
        <TotalRow label={strings.pos.taxAmount} value={calcResult.taxAmount} />
        {!calcResult.rounding.isZero() ? (
          <TotalRow label={strings.pos.rounding} value={calcResult.rounding} />
        ) : null}
        <TotalRow label={strings.pos.total} value={calcResult.total} emphasize />
      </div>

      <Button
        size="lg"
        className="h-11 w-full"
        disabled={lines.length === 0}
        onClick={() => {
          // key baru -> PaymentDialog remount penuh -> orderId & baris
          // pembayaran segar untuk sesi checkout ini (lihat komentar di
          // payment-dialog.tsx).
          setPaymentDialogKey((k) => k + 1);
          setPaymentDialogOpen(true);
        }}
      >
        {strings.pos.payButton}
      </Button>

      <PaymentDialog
        key={paymentDialogKey}
        open={paymentDialogOpen}
        onOpenChange={setPaymentDialogOpen}
        calcResult={calcResult}
        paymentMethods={paymentMethods}
        outletId={outletId}
        deviceId={deviceId}
        priceTierId={priceTierId}
        onSuccess={(result) => {
          toast.success(
            `${strings.pos.paymentSuccess} — ${strings.pos.orderNumberLabel}: ${result.orderNumber}`
          );
          useCartStore.getState().clear();
          onPaySuccess?.();
          // ?fresh=1 -- menandai kunjungan pertama (bukan cetak ulang) ke
          // halaman struk, lihat komentar di receipt/[orderId]/page.tsx.
          router.push(`/pos/receipt/${result.orderId}?fresh=1`);
        }}
      />
    </>
  );
}
