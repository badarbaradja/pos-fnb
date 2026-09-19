"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { closeAndReopenShift } from "@/app/(pos)/pos/shift/actions";
import { generateId } from "@/lib/utils/id";
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

const CHECK_INTERVAL_MS = 30_000;

/**
 * components/pos/shift/shift-cutover-bar.tsx — §14 prasyarat shift, poin
 * Indokopi 24 jam (13 September 2026, keputusan CEO). Outlet yang tidak
 * pernah tutup tidak punya jeda alami untuk mengganti shift di batas
 * hari bisnis -- pita ini muncul SEBELUM cutoff (non-blocking, transaksi
 * yang sedang jalan tidak terganggu) dan menyediakan alur "tutup & buka
 * shift baru" satu langkah supaya penjaga tidak terdampar di tengah
 * melayani pembeli.
 *
 * nextCutoffInstant dihitung SEKALI di server (page.tsx) dari
 * outlet.dayCutoffTime -- komponen ini cuma membandingkan jam klien
 * terhadap instant tetap itu tiap CHECK_INTERVAL_MS, tidak pernah
 * menghitung ulang cutoff-nya sendiri.
 */
export function ShiftCutoverBar({
  shiftId,
  cashEnabled,
  nextCutoffInstant,
  warningMinutes,
}: {
  shiftId: string;
  cashEnabled: boolean;
  nextCutoffInstant: string;
  warningMinutes: number;
}) {
  const [minutesLeft, setMinutesLeft] = useState<number | null>(null);

  useEffect(() => {
    function tick() {
      const diffMs = new Date(nextCutoffInstant).getTime() - Date.now();
      setMinutesLeft(diffMs / 60000);
    }
    tick();
    const interval = setInterval(tick, CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [nextCutoffInstant]);

  if (minutesLeft === null || minutesLeft > warningMinutes) {
    return null;
  }

  const isPast = minutesLeft < 0;

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
      <span>
        {isPast
          ? strings.shift.cutoverWarningUrgent
          : strings.shift.cutoverWarning.replace("{minutes}", String(Math.max(0, Math.ceil(minutesLeft))))}
      </span>
      <CloseAndReopenDialog shiftId={shiftId} cashEnabled={cashEnabled} />
    </div>
  );
}

function CloseAndReopenDialog({ shiftId, cashEnabled }: { shiftId: string; cashEnabled: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [countedCash, setCountedCash] = useState("");
  const [employeeCode, setEmployeeCode] = useState("");
  const [pin, setPin] = useState("");
  const [servedByName, setServedByName] = useState("");
  const [reason, setReason] = useState("");
  // Terisi HANYA sesudah percobaan pertama melaporkan selisih di luar
  // toleransi -- TIDAK ADA yang tertulis ke DB sampai titik ini (lihat
  // komentar closeAndReopenShiftWithDb). Form yang sama tetap terbuka,
  // reason muncul, penjaga submit ULANG -- "satu layar", bukan navigasi.
  const [pendingVariance, setPendingVariance] = useState<{
    expectedCash: string;
    cashVariance: string;
    tolerance: string;
  } | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit() {
    setIsPending(true);
    try {
      const result = await closeAndReopenShift({
        oldShiftId: shiftId,
        countedCash: cashEnabled ? countedCash : undefined,
        reason: reason.trim() || undefined,
        newShift: {
          id: generateId(),
          employeeCode,
          pin,
          servedByName,
        },
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      if (result.needsReason) {
        setPendingVariance(result.needsReason);
        return;
      }
      if (result.success) {
        toast.success(strings.shift.cutoverSuccess);
        setOpen(false);
        router.refresh();
      }
    } catch (err) {
      console.error("Tutup & buka shift baru gagal:", err);
      toast.error(err instanceof Error ? err.message : strings.common.unexpectedError);
    } finally {
      setIsPending(false);
    }
  }

  const canSubmit =
    employeeCode.trim() !== "" &&
    pin.trim() !== "" &&
    (!cashEnabled || countedCash.trim() !== "") &&
    (pendingVariance === null || reason.trim() !== "");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm">{strings.shift.cutoverButton}</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{strings.shift.cutoverDialogTitle}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <p className="text-sm text-muted-foreground">{strings.shift.cutoverDialogHint}</p>

          {cashEnabled ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="cutoverCountedCash">{strings.shift.countedCashLabel}</Label>
              <Input
                id="cutoverCountedCash"
                type="number"
                min={0}
                step="0.01"
                value={countedCash}
                onChange={(e) => setCountedCash(e.target.value)}
                required
              />
            </div>
          ) : null}

          {pendingVariance ? (
            <div className="flex flex-col gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-2">
              <p className="text-sm text-destructive">{strings.shift.cutoverVarianceHint}</p>
              <p className="text-sm">
                {strings.shift.cashVarianceLabel}: {pendingVariance.cashVariance} ({strings.shift.toleranceNote}{" "}
                {pendingVariance.tolerance})
              </p>
              <Label htmlFor="cutoverReason">{strings.shift.reasonRequiredLabel}</Label>
              <Textarea
                id="cutoverReason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={strings.shift.reasonPlaceholder}
              />
            </div>
          ) : null}

          <div className="flex flex-col gap-2 border-t pt-2">
            <Label className="text-xs font-semibold text-muted-foreground">
              {strings.shift.cutoverNewShiftSectionTitle}
            </Label>
            <div className="flex flex-col gap-2">
              <Label htmlFor="cutoverEmployeeCode">{strings.shift.employeeCodeLabel}</Label>
              <Input
                id="cutoverEmployeeCode"
                value={employeeCode}
                onChange={(e) => setEmployeeCode(e.target.value)}
                autoComplete="off"
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="cutoverPin">{strings.shift.pinLabel}</Label>
              <Input
                id="cutoverPin"
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                autoComplete="off"
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="cutoverServedByName">{strings.shift.servedByNameLabel}</Label>
              <Input
                id="cutoverServedByName"
                value={servedByName}
                onChange={(e) => setServedByName(e.target.value)}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">{strings.shift.servedByNameHint}</p>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            {strings.common.cancel}
          </Button>
          <Button onClick={handleSubmit} disabled={isPending || !canSubmit}>
            {isPending ? strings.shift.cutoverSubmitting : strings.shift.cutoverSubmitButton}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
