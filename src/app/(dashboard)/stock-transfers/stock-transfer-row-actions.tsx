"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { approveStockTransfer, cancelStockTransfer, rejectStockTransfer } from "./actions";
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
  // fixed, BUKAN di dalam alur tabel -- lihat catatan T22 v1: dalam
  // <TableCell> sempit jadi terpotong, ketahuan lewat verifikasi
  // browser. bottom-LEFT (bukan kanan, tumpang tindih toast sonner).
  return (
    <div className="fixed bottom-4 left-4 z-50 w-96 max-w-[calc(100vw-2rem)] rounded-lg border border-destructive/50 bg-background text-left shadow-lg">
      <div className="rounded-lg bg-destructive/10 p-4">
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
    </div>
  );
}

/**
 * Approve = SATU tombol, tanpa dialog -- keputusan ya/tidak murni, tidak
 * ada angka atau alasan yang perlu diisi (§ keputusan T22: approve tidak
 * menetapkan apa pun). Reject tetap lewat dialog karena alasan wajib.
 */
export function ApproveRejectButtons({
  transferId,
  employees,
}: {
  transferId: string;
  employees: EmployeeOption[];
}) {
  const router = useRouter();
  const [actorId, setActorId] = useState(employees[0]?.id ?? "");
  const [isApproving, setIsApproving] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [isRejecting, setIsRejecting] = useState(false);

  async function handleApprove() {
    setIsApproving(true);
    try {
      const result = await approveStockTransfer(transferId, actorId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(strings.stockTransfers.approveSuccess);
      router.refresh();
    } catch (err) {
      console.error("Setuju transfer stok gagal:", err);
      toast.error(err instanceof Error ? err.message : strings.common.unexpectedError);
    } finally {
      setIsApproving(false);
    }
  }

  async function handleReject() {
    setIsRejecting(true);
    try {
      const result = await rejectStockTransfer(transferId, actorId, rejectReason);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(strings.stockTransfers.rejectSuccess);
      setRejectOpen(false);
      router.refresh();
    } catch (err) {
      console.error("Tolak transfer stok gagal:", err);
      toast.error(err instanceof Error ? err.message : strings.common.unexpectedError);
    } finally {
      setIsRejecting(false);
    }
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <select
        value={actorId}
        onChange={(e) => setActorId(e.target.value)}
        className="h-8 rounded-lg border border-input bg-transparent px-1.5 text-xs"
      >
        {employees.map((e) => (
          <option key={e.id} value={e.id}>
            {e.fullName}
          </option>
        ))}
      </select>
      <Button size="sm" onClick={handleApprove} disabled={isApproving || !actorId}>
        {isApproving ? strings.common.saving : strings.stockTransfers.approveButton}
      </Button>
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogTrigger render={<Button variant="outline" size="sm">{strings.stockTransfers.rejectButton}</Button>} />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{strings.stockTransfers.rejectDialogTitle}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="rejectReason">{strings.stockTransfers.rejectReasonLabel}</Label>
            <textarea
              id="rejectReason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              required
              className="min-h-20 rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)} disabled={isRejecting}>
              {strings.common.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={isRejecting || rejectReason.trim().length === 0}
            >
              {isRejecting ? strings.common.saving : strings.stockTransfers.rejectConfirmButton}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

  // SENGAJA komponen ini tetap mounted apa pun statusnya -- lihat catatan
  // T22 v1: state `warnings` hilang persis saat router.refresh() kalau
  // parent conditional-unmount berdasar status.
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
    } catch (err) {
      console.error("Batalkan transfer stok gagal:", err);
      toast.error(err instanceof Error ? err.message : strings.common.unexpectedError);
    } finally {
      setIsPending(false);
    }
  }

  const cancellable = status === "requested" || status === "approved" || status === "received";
  if (!cancellable) {
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
