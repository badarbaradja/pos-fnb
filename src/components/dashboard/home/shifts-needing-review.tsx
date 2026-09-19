"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  confirmForceClosedReconciliation,
  forceCloseShift,
  reconcileForceClosedShift,
} from "@/app/(dashboard)/shifts/actions";
import type { ShiftNeedingReviewRow } from "@/lib/pos/shift";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { id as strings } from "@/lib/i18n/id";

/**
 * components/dashboard/home/shifts-needing-review.tsx — §14 prasyarat
 * shift (13 September 2026). Dua kategori baris (lihat
 * getShiftsNeedingReview): shift BASI (masih 'open', tidak bisa dipakai
 * jualan lagi -- tombol "Tutup Paksa") dan shift yang SUDAH ditutup
 * paksa tapi kas belum dihitung (tombol "Hitung Kas & Selesaikan").
 */
export function ShiftsNeedingReview({ shifts }: { shifts: ShiftNeedingReviewRow[] }) {
  if (shifts.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-destructive/50 bg-destructive/5 p-3 shadow-xs">
      <h2 className="font-heading text-sm font-semibold text-destructive">{strings.shift.needsReviewBadge}</h2>
      <p className="text-xs text-muted-foreground">{strings.shift.needsReviewHint}</p>
      <ul className="flex flex-col gap-2">
        {shifts.map((shift) => (
          <li
            key={shift.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-background p-2.5 text-sm"
          >
            <div className="flex flex-col">
              <span className="font-medium">
                {shift.employeeName}
                <span className="ml-2 text-xs text-muted-foreground">{shift.outletName}</span>
              </span>
              <span className="text-xs text-muted-foreground">
                {strings.shift.staleShiftListLabel} · {shift.businessDate}
              </span>
            </div>
            {shift.reviewReason === "stale" ? (
              <ForceCloseDialog shiftId={shift.id} employeeName={shift.employeeName} />
            ) : (
              <ReconcileDialog shiftId={shift.id} employeeName={shift.employeeName} />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ForceCloseDialog({ shiftId, employeeName }: { shiftId: string; employeeName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit() {
    setIsPending(true);
    try {
      const result = await forceCloseShift(shiftId, reason);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(strings.shift.forceCloseSuccess);
      setOpen(false);
      setReason("");
      router.refresh();
    } catch (err) {
      console.error("Tutup paksa shift gagal:", err);
      toast.error(err instanceof Error ? err.message : strings.common.unexpectedError);
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="destructive" size="sm">{strings.shift.forceCloseButton}</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{strings.shift.forceCloseDialogTitle.replace("{employee}", employeeName)}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <p className="text-sm text-muted-foreground">{strings.shift.forceCloseDialogHint}</p>
          <div className="flex flex-col gap-1">
            <Label htmlFor="forceCloseReason">{strings.shift.forceCloseReasonLabel}</Label>
            <Textarea
              id="forceCloseReason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={strings.shift.forceCloseReasonPlaceholder}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            {strings.common.cancel}
          </Button>
          <Button
            variant="destructive"
            onClick={handleSubmit}
            disabled={isPending || reason.trim() === ""}
          >
            {isPending ? strings.common.saving : strings.shift.forceCloseSubmitButton}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReconcileDialog({ shiftId, employeeName }: { shiftId: string; employeeName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [countedCash, setCountedCash] = useState("");
  const [isPending, setIsPending] = useState(false);
  // Terisi HANYA kalau reconcileForceClosedShift() melaporkan selisih di
  // luar toleransi -- dialog pindah ke langkah kedua (alasan wajib),
  // pola sama alur tutup shift normal dua langkah.
  const [pendingReason, setPendingReason] = useState<{ tolerance: string; variance: string } | null>(null);
  const [reason, setReason] = useState("");

  async function handleSubmitCash() {
    setIsPending(true);
    try {
      const result = await reconcileForceClosedShift(shiftId, countedCash);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      if (result.success!.requiresReason) {
        setPendingReason({ tolerance: result.success!.tolerance, variance: result.success!.cashVariance });
        return;
      }
      toast.success(strings.shift.reconcileSuccess);
      setOpen(false);
      router.refresh();
    } catch (err) {
      console.error("Rekonsiliasi shift gagal:", err);
      toast.error(err instanceof Error ? err.message : strings.common.unexpectedError);
    } finally {
      setIsPending(false);
    }
  }

  async function handleSubmitReason() {
    setIsPending(true);
    try {
      const result = await confirmForceClosedReconciliation(shiftId, reason);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(strings.shift.reconcileSuccess);
      setOpen(false);
      setPendingReason(null);
      setReason("");
      router.refresh();
    } catch (err) {
      console.error("Konfirmasi rekonsiliasi shift gagal:", err);
      toast.error(err instanceof Error ? err.message : strings.common.unexpectedError);
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm">{strings.shift.reconcileButton}</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{strings.shift.reconcileDialogTitle.replace("{employee}", employeeName)}</DialogTitle>
        </DialogHeader>
        {!pendingReason ? (
          <>
            <div className="flex flex-col gap-4 py-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="reconcileCountedCash">{strings.shift.countedCashLabel}</Label>
                <Input
                  id="reconcileCountedCash"
                  type="number"
                  min={0}
                  step="0.01"
                  value={countedCash}
                  onChange={(e) => setCountedCash(e.target.value)}
                  required
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
                {strings.common.cancel}
              </Button>
              <Button onClick={handleSubmitCash} disabled={isPending || countedCash.trim() === ""}>
                {isPending ? strings.common.saving : strings.shift.reconcileSubmitButton}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-4 py-2">
              <p className="text-sm text-destructive">
                {strings.shift.cashVarianceLabel}: {pendingReason.variance} ({strings.shift.toleranceNote}{" "}
                {pendingReason.tolerance})
              </p>
              <div className="flex flex-col gap-1">
                <Label htmlFor="reconcileReason">{strings.shift.reasonRequiredLabel}</Label>
                <Textarea
                  id="reconcileReason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={strings.shift.reasonPlaceholder}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
                {strings.common.cancel}
              </Button>
              <Button onClick={handleSubmitReason} disabled={isPending || reason.trim() === ""}>
                {isPending ? strings.common.saving : strings.shift.confirmCloseButton}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
