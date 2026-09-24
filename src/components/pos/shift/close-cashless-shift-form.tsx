"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Decimal } from "decimal.js";
import { toast } from "sonner";
import { closeCashlessShift } from "@/app/(pos)/pos/shift/actions";
import type { ShiftSalesSummary } from "@/lib/pos/shift";
import { formatIDR } from "@/lib/utils/money";
import { Button } from "@/components/ui/button";
import { id as strings } from "@/lib/i18n/id";
import { ShiftOpnameForm } from "./shift-opname-form";
import { ClosingReportForm } from "./closing-report-form";
import type { ShiftOpnameItemRow } from "@/lib/stock-opnames/shift-opname";

type ClosingOpname = {
  opnameId: string;
  items: ShiftOpnameItemRow[];
  isFirstShiftAtOutlet: boolean;
  varianceAlertValue: string;
  varianceAlertPercent: string;
};

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}

/**
 * Tutup shift untuk outlet cashless (outlet.cash_enabled = false) --
 * SATU FASE, beda dari CloseShiftForm yang dua fase (submit hitungan
 * fisik dulu, baru rekonsiliasi). Tidak ada apa pun soal kas di sini:
 * cuma ringkasan penjualan (jumlah transaksi, total per metode bayar)
 * dari getShiftSalesSummary() (lib/pos/shift.ts), lalu satu tombol tutup.
 */
export function CloseCashlessShiftForm({
  shiftId,
  employeeName,
  openedAt,
  summary,
  closingOpname,
  outletId,
  businessDate,
}: {
  shiftId: string;
  employeeName: string;
  openedAt: string;
  summary: ShiftSalesSummary;
  closingOpname: ClosingOpname | null;
  outletId: string;
  businessDate: string;
}) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [closedAt, setClosedAt] = useState<string | null>(null);

  async function handleClose() {
    setIsPending(true);
    try {
      const result = await closeCashlessShift({ shiftId });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      if (result.success) {
        setClosedAt(result.success.closedAt);
        toast.success(strings.shift.closedSuccess);
      }
    } catch (err) {
      console.error("Tutup shift cashless gagal:", err);
      toast.error(err instanceof Error ? err.message : strings.common.unexpectedError);
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-4">
      {closingOpname && !closedAt ? (
        <ShiftOpnameForm
          jenis="tutup"
          opnameId={closingOpname.opnameId}
          outletId={outletId}
          businessDate={businessDate}
          items={closingOpname.items}
          isFirstShiftAtOutlet={closingOpname.isFirstShiftAtOutlet}
          varianceAlertValue={closingOpname.varianceAlertValue}
          varianceAlertPercent={closingOpname.varianceAlertPercent}
        />
      ) : null}
      {!closedAt ? <ClosingReportForm shiftId={shiftId} /> : null}
      <div className="flex flex-col gap-1 rounded-lg border p-3 text-sm">
        <h2 className="mb-1 text-base font-semibold">{strings.shift.summaryTitle}</h2>
        <SummaryRow label={strings.shift.summaryEmployee} value={employeeName} />
        <SummaryRow
          label={strings.shift.summaryOpenedAt}
          value={new Date(openedAt).toLocaleString("id-ID")}
        />
        {closedAt ? (
          <SummaryRow
            label={strings.shift.summaryClosedAt}
            value={new Date(closedAt).toLocaleString("id-ID")}
          />
        ) : null}
        <div className="my-1 border-t" />
        <SummaryRow
          label={strings.shift.salesSummaryOrderCount}
          value={String(summary.orderCount)}
        />
        {summary.totalsByMethod.length > 0 ? (
          <>
            <div className="mt-1 text-xs text-muted-foreground">
              {strings.shift.salesSummaryByMethod}
            </div>
            {summary.totalsByMethod.map((m) => (
              <SummaryRow
                key={m.methodName}
                label={m.methodName}
                value={formatIDR(new Decimal(m.total))}
              />
            ))}
          </>
        ) : null}
      </div>

      {closedAt ? (
        <>
          <Button size="lg" onClick={() => window.print()}>
            {strings.shift.summaryPrintButton}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              router.push("/pos");
              router.refresh();
            }}
          >
            {strings.shift.backToPos}
          </Button>
        </>
      ) : (
        <Button onClick={handleClose} disabled={isPending}>
          {isPending ? strings.shift.confirmingClose : strings.shift.confirmCloseCashlessButton}
        </Button>
      )}
    </div>
  );
}
