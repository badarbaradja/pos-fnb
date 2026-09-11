"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { resetEmployeePin, unlockEmployee } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

function ResetPinDialog({ employeeId }: { employeeId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [newPin, setNewPin] = useState("");
  const [isPending, setIsPending] = useState(false);

  async function handleConfirm() {
    setIsPending(true);
    try {
      const result = await resetEmployeePin({ employeeId, newPin });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(strings.employees.resetPinSuccess);
      setOpen(false);
      setNewPin("");
      router.refresh();
    } catch (err) {
      console.error("Reset PIN karyawan gagal:", err);
      toast.error(err instanceof Error ? err.message : strings.common.unexpectedError);
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm">{strings.employees.resetPinButton}</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{strings.employees.resetPinDialogTitle}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          <p className="text-sm text-muted-foreground">{strings.employees.resetPinDialogHint}</p>
          <div className="flex flex-col gap-1">
            <Label htmlFor="newPin">{strings.employees.newPinLabel}</Label>
            <Input
              id="newPin"
              type="password"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              value={newPin}
              onChange={(e) => setNewPin(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            {strings.common.cancel}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isPending || !/^\d{6}$/.test(newPin)}
          >
            {isPending ? strings.common.saving : strings.employees.resetPinConfirmButton}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EmployeeRowActions({
  employeeId,
  isLocked,
  lockedUntilText,
}: {
  employeeId: string;
  isLocked: boolean;
  lockedUntilText: string | null;
}) {
  const router = useRouter();
  const [isUnlocking, setIsUnlocking] = useState(false);

  async function handleUnlock() {
    setIsUnlocking(true);
    try {
      const result = await unlockEmployee({ employeeId });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(strings.employees.unlockSuccess);
      router.refresh();
    } catch (err) {
      console.error("Buka kunci karyawan gagal:", err);
      toast.error(err instanceof Error ? err.message : strings.common.unexpectedError);
    } finally {
      setIsUnlocking(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1">
        <ResetPinDialog employeeId={employeeId} />
        {isLocked ? (
          <Button variant="outline" size="sm" onClick={handleUnlock} disabled={isUnlocking}>
            {strings.employees.unlockButton}
          </Button>
        ) : null}
      </div>
      {isLocked && lockedUntilText ? (
        <span className="text-xs text-destructive">
          {strings.employees.lockedUntilLabel.replace("{time}", lockedUntilText)}
        </span>
      ) : null}
    </div>
  );
}
