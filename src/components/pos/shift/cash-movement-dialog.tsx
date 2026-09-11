"use client";

import { useState } from "react";
import { toast } from "sonner";
import { addCashMovement } from "@/app/(pos)/pos/shift/actions";
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

type MovementType = "cash_in" | "cash_out";

export function CashMovementDialog({ shiftId }: { shiftId: string }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<MovementType>("cash_out");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [isPending, setIsPending] = useState(false);

  function resetForm() {
    setType("cash_out");
    setAmount("");
    setReason("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsPending(true);
    try {
      const result = await addCashMovement({
        id: generateId(),
        shiftId,
        type,
        amount,
        reason,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(strings.shift.cashMovementSuccess);
      resetForm();
      setOpen(false);
    } catch (err) {
      console.error("Catat mutasi kas gagal:", err);
      toast.error(err instanceof Error ? err.message : strings.common.unexpectedError);
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) resetForm();
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            {strings.shift.cashMovementButton}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{strings.shift.cashMovementTitle}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">{strings.shift.cashMovementTypeLabel}</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={type === "cash_in" ? "default" : "outline"}
                onClick={() => setType("cash_in")}
              >
                {strings.shift.cashMovementTypeIn}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={type === "cash_out" ? "default" : "outline"}
                onClick={() => setType("cash_out")}
              >
                {strings.shift.cashMovementTypeOut}
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="movementAmount" className="text-xs">
              {strings.shift.cashMovementAmountLabel}
            </Label>
            <Input
              id="movementAmount"
              type="number"
              min={0}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="movementReason" className="text-xs">
              {strings.shift.cashMovementReasonLabel}
            </Label>
            <Textarea
              id="movementReason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={strings.shift.cashMovementReasonPlaceholder}
              required
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {strings.pos.cancel}
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? strings.common.saving : strings.shift.cashMovementSubmit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
