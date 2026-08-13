"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Decimal } from "decimal.js";
import { toast } from "sonner";
import { confirmShiftClose, submitCountedCash } from "@/app/(pos)/pos/shift/actions";
import { formatIDR } from "@/lib/utils/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { id as strings } from "@/lib/i18n/id";

type ReconciliationState = {
  countedCash: string;
  expectedCash: string;
  cashVariance: string;
  tolerance: string;
  requiresReason: boolean;
  closed: boolean;
  closedAt: string | null;
};

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function ShiftSummary({
  employeeName,
  openedAt,
  closedAt,
  openingCash,
  countedCash,
  expectedCash,
  cashVariance,
  onBackToPos,
}: {
  employeeName: string;
  openedAt: string;
  closedAt: string;
  openingCash: string;
  countedCash: string;
  expectedCash: string;
  cashVariance: string;
  onBackToPos: () => void;
}) {
  return (
    <div className="flex w-full max-w-sm flex-col gap-4">
      <div className="flex flex-col gap-1 rounded-lg border p-3 text-sm">
        <h2 className="mb-1 text-base font-semibold">{strings.shift.summaryTitle}</h2>
        <SummaryRow label={strings.shift.summaryEmployee} value={employeeName} />
        <SummaryRow
          label={strings.shift.summaryOpenedAt}
          value={new Date(openedAt).toLocaleString("id-ID")}
        />
        <SummaryRow
          label={strings.shift.summaryClosedAt}
          value={new Date(closedAt).toLocaleString("id-ID")}
        />
        <div className="my-1 border-t" />
        <SummaryRow
          label={strings.shift.summaryOpeningCash}
          value={formatIDR(new Decimal(openingCash))}
        />
        <SummaryRow
          label={strings.shift.countedCashLabel}
          value={formatIDR(new Decimal(countedCash))}
        />
        <SummaryRow
          label={strings.shift.expectedCashLabel}
          value={formatIDR(new Decimal(expectedCash))}
        />
        <SummaryRow
          label={strings.shift.cashVarianceLabel}
          value={formatIDR(new Decimal(cashVariance))}
        />
      </div>
      <Button size="lg" onClick={() => window.print()}>
        {strings.shift.summaryPrintButton}
      </Button>
      <Button variant="outline" onClick={onBackToPos}>
        {strings.shift.backToPos}
      </Button>
    </div>
  );
}

export function CloseShiftForm({
  shiftId,
  employeeName,
  openedAt,
  openingCash,
  initialCountedCash,
  initialExpectedCash,
  initialCashVariance,
  tolerance,
}: {
  shiftId: string;
  employeeName: string;
  openedAt: string;
  openingCash: string;
  initialCountedCash: string | null;
  initialExpectedCash: string | null;
  initialCashVariance: string | null;
  tolerance: string;
}) {
  const router = useRouter();
  const [countedCashInput, setCountedCashInput] = useState("");
  const [reason, setReason] = useState("");
  const [isPending, setIsPending] = useState(false);
  // Kalau halaman ini di-load ulang saat counted_cash SUDAH terkunci (T15:
  // submitCountedCashWithDb sudah pernah dipanggil, sedang menunggu
  // alasan), langsung masuk fase alasan dengan angka yang SUDAH TERSIMPAN
  // -- bukan input baru, supaya reload halaman tidak membuka celah untuk
  // menghitung ulang dengan counted_cash yang berbeda.
  const [state, setState] = useState<ReconciliationState | null>(
    initialCountedCash !== null && initialExpectedCash !== null && initialCashVariance !== null
      ? {
          countedCash: initialCountedCash,
          expectedCash: initialExpectedCash,
          cashVariance: initialCashVariance,
          tolerance,
          requiresReason: true,
          closed: false,
          closedAt: null,
        }
      : null
  );

  async function handleSubmitCount(e: React.FormEvent) {
    e.preventDefault();
    setIsPending(true);
    try {
      const result = await submitCountedCash({ shiftId, countedCash: countedCashInput });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      if (result.success) {
        setState(result.success);
        if (result.success.closed) {
          toast.success(strings.shift.closedSuccess);
        }
      }
    } finally {
      setIsPending(false);
    }
  }

  async function handleConfirmClose(e: React.FormEvent) {
    e.preventDefault();
    setIsPending(true);
    try {
      const result = await confirmShiftClose({ shiftId, reason });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      if (result.success && state) {
        setState({ ...state, closed: true, closedAt: result.success.closedAt });
        toast.success(strings.shift.closedSuccess);
      }
    } finally {
      setIsPending(false);
    }
  }

  if (state?.closed && state.closedAt) {
    return (
      <ShiftSummary
        employeeName={employeeName}
        openedAt={openedAt}
        closedAt={state.closedAt}
        openingCash={openingCash}
        countedCash={state.countedCash}
        expectedCash={state.expectedCash}
        cashVariance={state.cashVariance}
        onBackToPos={() => {
          router.push("/pos");
          router.refresh();
        }}
      />
    );
  }

  if (state?.requiresReason) {
    return (
      <form onSubmit={handleConfirmClose} className="flex w-full max-w-sm flex-col gap-4">
        <div className="flex flex-col gap-1 rounded-lg border p-3 text-sm">
          <SummaryRow
            label={strings.shift.expectedCashLabel}
            value={formatIDR(new Decimal(state.expectedCash))}
          />
          <SummaryRow
            label={strings.shift.cashVarianceLabel}
            value={formatIDR(new Decimal(state.cashVariance))}
          />
          <div className="text-xs text-muted-foreground">
            {strings.shift.toleranceNote}: {formatIDR(new Decimal(state.tolerance))}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="reason">{strings.shift.reasonRequiredLabel}</Label>
          <Textarea
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={strings.shift.reasonPlaceholder}
            required
          />
        </div>
        <Button type="submit" disabled={isPending || !reason.trim()}>
          {isPending ? strings.shift.confirmingClose : strings.shift.confirmCloseButton}
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={handleSubmitCount} className="flex w-full max-w-sm flex-col gap-4">
      <p className="text-sm text-muted-foreground">{strings.shift.countedCashHint}</p>
      <div className="flex flex-col gap-2">
        <Label htmlFor="countedCash">{strings.shift.countedCashLabel}</Label>
        <Input
          id="countedCash"
          type="number"
          min={0}
          step="0.01"
          value={countedCashInput}
          onChange={(e) => setCountedCashInput(e.target.value)}
          required
        />
      </div>
      <Button type="submit" disabled={isPending}>
        {isPending ? strings.shift.submittingCount : strings.shift.submitCountButton}
      </Button>
    </form>
  );
}
