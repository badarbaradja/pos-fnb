"use client";

import { useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Decimal } from "decimal.js";
import { toast } from "sonner";
import { useCartStore, type CartLine, type DiscountType } from "@/lib/store/cart-store";
import type { CalcResult } from "@/lib/calc/order-calculator";
import type { PosPaymentMethod } from "@/app/(pos)/pos/get-pos-catalog";
import { formatIDR } from "@/lib/utils/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PaymentDialog } from "./payment-dialog";
import { id as strings } from "@/lib/i18n/id";

function subscribeNoop() {
  return () => {};
}

/**
 * true hanya di klien, false saat SSR -- dipakai supaya createPortal (footer,
 * di bawah) tidak dipanggil dengan `document` yang belum ada saat render
 * server. useSyncExternalStore (bukan useState+useEffect) supaya tidak kena
 * lint react-hooks/set-state-in-effect untuk pola "tandai sudah mount" ini.
 */
function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false
  );
}

/**
 * Semua angka di panel ini (per baris maupun total) datang dari satu
 * `calcResult` yang dihitung SEKALI lewat useCartCalculation() di
 * pos-screen.tsx -- panel ini tidak pernah menjumlahkan apa pun sendiri
 * (kesepakatan T12).
 */
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
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [paymentDialogKey, setPaymentDialogKey] = useState(0);
  const isClient = useIsClient();
  const router = useRouter();
  const lines = useCartStore((s) => s.lines);
  const removeLine = useCartStore((s) => s.removeLine);
  const setQty = useCartStore((s) => s.setQty);
  const setItemDiscount = useCartStore((s) => s.setItemDiscount);
  const setNote = useCartStore((s) => s.setNote);
  const discountType = useCartStore((s) => s.discountType);
  const orderDiscountAmount = useCartStore((s) => s.orderDiscountAmount);
  const orderDiscountPercentInput = useCartStore((s) => s.orderDiscountPercentInput);
  const setDiscountType = useCartStore((s) => s.setDiscountType);
  const setOrderDiscountAmount = useCartStore((s) => s.setOrderDiscountAmount);
  const setOrderDiscountPercentInput = useCartStore(
    (s) => s.setOrderDiscountPercentInput
  );

  const resultById = new Map(calcResult.lines.map((l) => [l.id, l]));

  const footer = (
    // fixed + portal ke document.body (bukan child biasa di pohon React) --
    // ini percobaan kedua untuk bug "tombol Bayar tenggelam". Percobaan
    // pertama (fixed biasa, tanpa portal, cuma beda class per breakpoint)
    // TERBUKTI TIDAK CUKUP di pengujian nyata -- dilaporkan tombol tetap
    // ikut ke-scroll hilang walau sudah `position:fixed` dan hard refresh.
    // Dugaan kuat: ada leluhur (kemungkinan dari base-ui Dialog/Portal yang
    // pernah terbuka, atau sesuatu yang belum ketemu lewat audit kode) yang
    // membentuk containing block baru (transform/filter/contain), yang
    // bikin `fixed` jadi relatif ke leluhur itu, bukan ke viewport. Portal
    // React memindahkan node ini jadi ANAK LANGSUNG document.body -- keluar
    // total dari pohon DOM CartPanel/pos-screen/(pos)-layout, jadi kebal
    // terhadap containing block leluhur mana pun yang belum ketemu itu.
    // SELALU fixed (tidak ada lagi md:static) karena begitu dipindah lewat
    // portal, "static" tidak lagi berarti "di dalam kolom cart" -- posisi
    // & lebarnya diatur manual per breakpoint di bawah.
    <div className="fixed inset-x-0 bottom-0 z-40 flex flex-col gap-3 border-t bg-background p-4 md:inset-x-auto md:right-0 md:w-[360px] md:border-l">
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
        className="w-full"
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
    </div>
  );

  return (
    <div className="flex flex-col border-l bg-background md:h-full">
      <div className="shrink-0 border-b p-4">
        <h2 className="text-sm font-semibold">{strings.pos.cartTitle}</h2>
      </div>

      {/* pb besar supaya baris terakhir tidak ketutup footer yang sekarang
          melayang (portal) di atas konten, bukan lagi bagian dari alur
          normal kolom ini. */}
      <div className="p-4 pb-[480px] md:min-h-0 md:flex-1 md:overflow-y-auto">
        {lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">{strings.pos.cartEmpty}</p>
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

      {isClient ? createPortal(footer, document.body) : null}

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
          // ?fresh=1 -- menandai kunjungan pertama (bukan cetak ulang) ke
          // halaman struk, lihat komentar di receipt/[orderId]/page.tsx.
          router.push(`/pos/receipt/${result.orderId}?fresh=1`);
        }}
      />
    </div>
  );
}

function TotalRow({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: Decimal;
  emphasize?: boolean;
}) {
  return (
    <div
      className={
        emphasize
          ? "flex items-center justify-between border-t pt-1 text-base font-semibold"
          : "flex items-center justify-between text-muted-foreground"
      }
    >
      <span>{label}</span>
      <span>{formatIDR(value)}</span>
    </div>
  );
}

function CartLineRow({
  line,
  result,
  onRemove,
  onQtyChange,
  onItemDiscountChange,
  onNoteChange,
}: {
  line: CartLine;
  result: CalcResult["lines"][number] | undefined;
  onRemove: () => void;
  onQtyChange: (qty: Decimal) => void;
  onItemDiscountChange: (amount: Decimal) => void;
  onNoteChange: (note: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-medium">
            {line.productName}
            {line.variantName ? ` — ${line.variantName}` : ""}
          </div>
          {line.modifiers.length > 0 ? (
            <div className="text-xs text-muted-foreground">
              {line.modifiers.map((m) => m.name).join(", ")}
            </div>
          ) : null}
        </div>
        <Button variant="ghost" size="sm" onClick={onRemove}>
          {strings.pos.removeLine}
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={() => onQtyChange(Decimal.max(new Decimal(1), line.qty.minus(1)))}
        >
          -
        </Button>
        <span className="w-8 text-center text-sm">{line.qty.toString()}</span>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={() => onQtyChange(line.qty.plus(1))}
        >
          +
        </Button>
        <span className="ml-auto text-sm font-medium">
          {result ? formatIDR(result.netAmount) : null}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <Label className="text-xs">{strings.pos.itemDiscountLabel}</Label>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={line.itemDiscount.toString()}
            onChange={(e) =>
              onItemDiscountChange(
                e.target.value === "" ? new Decimal(0) : new Decimal(e.target.value)
              )
            }
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">{strings.pos.noteLabel}</Label>
          <Input
            value={line.note}
            placeholder={strings.pos.notePlaceholder}
            onChange={(e) => onNoteChange(e.target.value)}
          />
        </div>
      </div>

      {result && !result.allocatedOrderDiscount.isZero() ? (
        <div className="text-xs text-muted-foreground">
          {strings.pos.lineDiscountAllocated}: -{formatIDR(result.allocatedOrderDiscount)}
        </div>
      ) : null}
    </div>
  );
}
