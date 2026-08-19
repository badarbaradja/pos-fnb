"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cancelStockTransfer } from "./actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { id as strings } from "@/lib/i18n/id";

export type EmployeeOption = { id: string; fullName: string };
type Warning = { ingredientName: string; resultingQty: string; baseUnit: string };

function NegativeStockWarning({ warnings }: { warnings: Warning[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="mt-4 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-left">
      <p className="font-semibold text-destructive">{strings.stockTransfers.negativeWarningTitle}</p>
      <p className="mt-1 text-sm text-muted-foreground">{strings.stockTransfers.negativeWarningHint}</p>
      <ul className="mt-2 list-disc pl-5 text-sm">
        {warnings.map((w) => (
          <li key={w.ingredientName}>
            {strings.stockTransfers.negativeWarningLine
              .replace("{ingredient}", w.ingredientName)
              .replace("{qty}", w.resultingQty)
              .replace("{unit}", w.baseUnit)}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function StockTransferCancelButton({
  transferId,
  status,
  employees,
}: {
  transferId: string;
  status: string;
  employees: EmployeeOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [reason, setReason] = useState("");
  const [cancelledBy, setCancelledBy] = useState(employees[0]?.id ?? "");
  const [warnings, setWarnings] = useState<Warning[]>([]);

  // SENGAJA komponen ini tetap mounted apa pun statusnya (parent tidak
  // pernah conditional-unmount berdasar status) -- kalau tidak, state
  // `warnings` hilang PERSIS saat router.refresh() membuat status baris
  // ini berubah jadi 'cancelled', karena parent akan berhenti me-render
  // komponen ini sama sekali. Banner peringatan justru paling penting
  // muncul TEPAT setelah pembatalan berhasil.
  async function handleConfirm() {
    setIsPending(true);
    try {
      const result = await cancelStockTransfer(transferId, reason, cancelledBy);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(strings.stockTransfers.cancelSuccess);
      setOpen(false);
      if (result.warnings && result.warnings.length > 0) {
        setWarnings(result.warnings);
      }
      router.refresh();
    } finally {
      setIsPending(false);
    }
  }

  if (status !== "received") {
    return <NegativeStockWarning warnings={warnings} />;
  }

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger
          render={
            <Button variant="outline" size="sm">
              {strings.stockTransfers.cancelButton}
            </Button>
          }
        />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{strings.stockTransfers.cancelDialogTitle}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{strings.stockTransfers.cancelDialogHint}</p>
          <div className="flex flex-col gap-2 py-2">
            <Label htmlFor="cancelledBy">{strings.stockTransfers.receivedByLabel}</Label>
            <select
              id="cancelledBy"
              value={cancelledBy}
              onChange={(e) => setCancelledBy(e.target.value)}
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
            >
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.fullName}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="cancelReason">{strings.stockTransfers.cancelReasonLabel}</Label>
            <textarea
              id="cancelReason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              className="min-h-20 rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
              {strings.common.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirm}
              disabled={isPending || reason.trim().length === 0}
            >
              {isPending ? strings.common.saving : strings.stockTransfers.cancelConfirmButton}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <NegativeStockWarning warnings={warnings} />
    </>
  );
}
