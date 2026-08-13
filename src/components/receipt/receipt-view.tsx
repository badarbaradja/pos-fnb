import { toZonedTime } from "date-fns-tz";
import { format } from "date-fns";
import type { Receipt } from "@/lib/printing/receipt-template";
import { formatIDR } from "@/lib/utils/money";
import { getChannelLabel } from "@/lib/pos/channel-labels";
import { id as strings } from "@/lib/i18n/id";

/**
 * Renderer HTML untuk struktur Receipt (lib/printing/receipt-template.ts).
 * Sengaja terpisah dari buildReceipt() -- nanti produksi butuh renderer
 * ESC/POS untuk printer thermal langsung, yang akan konsumsi struktur
 * Receipt yang sama, cuma keluarannya bukan JSX/HTML.
 *
 * CSS cetak (@page, @media print) di sini, bukan di globals.css --
 * spesifik untuk halaman struk, tidak perlu memengaruhi halaman lain.
 */

function formatDateTime(date: Date, timezone: string): string {
  return format(toZonedTime(date, timezone), "dd/MM/yyyy HH:mm");
}

export function ReceiptView({ receipt }: { receipt: Receipt }) {
  return (
    <>
      <style>{`
        @page {
          size: 80mm auto;
          margin: 0;
        }
        @media print {
          body * {
            visibility: hidden;
          }
          #receipt-print-area,
          #receipt-print-area * {
            visibility: visible;
          }
          #receipt-print-area {
            position: absolute;
            top: 0;
            left: 0;
            width: 80mm;
            padding: 4mm;
          }
        }
      `}</style>
      <div
        id="receipt-print-area"
        className="mx-auto w-[80mm] bg-white p-3 font-mono text-xs text-black"
      >
        {receipt.isReprint ? (
          <div className="mb-2 text-center font-bold">{strings.receipt.reprintBadge}</div>
        ) : null}

        <div className="text-center">
          <div className="text-sm font-bold">{receipt.businessName}</div>
          <div>{receipt.outletName}</div>
          {receipt.outletAddress ? <div>{receipt.outletAddress}</div> : null}
          {receipt.outletPhone ? <div>{receipt.outletPhone}</div> : null}
        </div>

        <div className="my-2 border-t border-dashed border-black" />

        <div className="flex justify-between">
          <span>{receipt.orderNumber}</span>
        </div>
        <div className="flex justify-between">
          <span>{strings.receipt.dateLabel}</span>
          <span>
            {receipt.paidAt
              ? formatDateTime(receipt.paidAt, receipt.businessTimezone)
              : "-"}
          </span>
        </div>
        <div className="flex justify-between">
          <span>{strings.receipt.cashierLabel}</span>
          <span>{receipt.cashierName ?? strings.receipt.cashierUnknown}</span>
        </div>
        <div className="flex justify-between">
          <span>{strings.receipt.channelLabel}</span>
          <span>{getChannelLabel(receipt.channel)}</span>
        </div>

        <div className="my-2 border-t border-dashed border-black" />

        {receipt.lines.map((line, index) => (
          <div key={index} className="mb-1.5">
            <div className="flex justify-between">
              <span>
                {line.productName}
                {line.variantName ? ` (${line.variantName})` : ""}
              </span>
              <span>{formatIDR(line.netAmount)}</span>
            </div>
            <div className="text-[10px] text-gray-700">
              {line.qty.toString()} x {formatIDR(line.unitPrice)}
            </div>
            {line.modifiers.map((m, mIndex) => (
              <div key={mIndex} className="pl-2 text-[10px] text-gray-700">
                + {m.name}
                {!m.price.isZero() ? ` (${formatIDR(m.price)})` : ""}
              </div>
            ))}
            {line.note ? (
              <div className="pl-2 text-[10px] italic text-gray-700">
                &ldquo;{line.note}&rdquo;
              </div>
            ) : null}
          </div>
        ))}

        <div className="my-2 border-t border-dashed border-black" />

        <div className="flex justify-between">
          <span>{strings.receipt.subtotal}</span>
          <span>{formatIDR(receipt.subtotal)}</span>
        </div>
        {!receipt.itemDiscountTotal.isZero() ? (
          <div className="flex justify-between">
            <span>{strings.receipt.itemDiscount}</span>
            <span>-{formatIDR(receipt.itemDiscountTotal)}</span>
          </div>
        ) : null}
        {!receipt.orderDiscount.isZero() ? (
          <div className="flex justify-between">
            <span>{strings.receipt.orderDiscount}</span>
            <span>-{formatIDR(receipt.orderDiscount)}</span>
          </div>
        ) : null}
        {!receipt.serviceCharge.isZero() ? (
          <div className="flex justify-between">
            <span>{strings.receipt.serviceCharge}</span>
            <span>{formatIDR(receipt.serviceCharge)}</span>
          </div>
        ) : null}
        {!receipt.taxAmount.isZero() ? (
          <div className="flex justify-between">
            <span>{strings.receipt.tax}</span>
            <span>{formatIDR(receipt.taxAmount)}</span>
          </div>
        ) : null}
        {!receipt.rounding.isZero() ? (
          <div className="flex justify-between">
            <span>{strings.receipt.rounding}</span>
            <span>{formatIDR(receipt.rounding)}</span>
          </div>
        ) : null}
        <div className="flex justify-between text-sm font-bold">
          <span>{strings.receipt.total}</span>
          <span>{formatIDR(receipt.total)}</span>
        </div>

        <div className="my-2 border-t border-dashed border-black" />

        <div className="font-bold">{strings.receipt.paymentHeading}</div>
        {receipt.payments.map((p, index) => (
          <div key={index} className="flex justify-between">
            <span>
              {p.methodName}
              {p.reference ? ` (${p.reference})` : ""}
            </span>
            <span>{formatIDR(p.amount)}</span>
          </div>
        ))}
        <div className="flex justify-between">
          <span>{strings.receipt.received}</span>
          <span>{formatIDR(receipt.totalReceived)}</span>
        </div>
        <div className="flex justify-between">
          <span>{strings.receipt.change}</span>
          <span>{formatIDR(receipt.totalChange)}</span>
        </div>

        <div className="my-2 border-t border-dashed border-black" />

        <div className="text-center">{strings.receipt.footerNote}</div>
        {receipt.isReprint ? (
          <div className="mt-1 text-center text-[10px] text-gray-700">
            {strings.receipt.printedAtLabel}:{" "}
            {formatDateTime(receipt.printedAt, receipt.businessTimezone)}
          </div>
        ) : null}
      </div>
    </>
  );
}
