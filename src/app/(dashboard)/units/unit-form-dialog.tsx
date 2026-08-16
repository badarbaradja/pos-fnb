"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { saveUnit, type UnitFormState } from "./actions";
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

export type UnitFormValue = {
  id: string;
  code: string;
  name: string;
  baseUnit: string;
  factor: string;
};

const initialState: UnitFormState = {};

export function UnitFormDialog({
  unit,
  trigger,
}: {
  unit?: UnitFormValue;
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(saveUnit, initialState);

  useEffect(() => {
    if (state.error) {
      toast.error(state.error);
    }
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent>
        <form
          action={async (formData) => {
            await formAction(formData);
            setOpen(false);
          }}
        >
          <DialogHeader>
            <DialogTitle>{unit ? strings.units.editTitle : strings.units.addTitle}</DialogTitle>
          </DialogHeader>
          {unit ? <input type="hidden" name="id" value={unit.id} /> : null}
          <div className="flex flex-col gap-4 py-4">
            {unit ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="code">{strings.units.code}</Label>
                <Input id="code" defaultValue={unit.code} disabled />
                <p className="text-xs text-muted-foreground">{strings.units.codeLockedHint}</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <Label htmlFor="code">{strings.units.code}</Label>
                <Input id="code" name="code" placeholder="kg, g, l, ml, pcs" required />
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">{strings.units.name}</Label>
              <Input id="name" name="name" defaultValue={unit?.name} required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="baseUnit">{strings.units.baseUnit}</Label>
              <Input
                id="baseUnit"
                name="baseUnit"
                defaultValue={unit?.baseUnit}
                placeholder="g, ml, pcs"
                required
              />
              <p className="text-xs text-muted-foreground">{strings.units.baseUnitHint}</p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="factor">{strings.units.factor}</Label>
              <Input
                id="factor"
                name="factor"
                type="number"
                step="0.00000001"
                min={0}
                defaultValue={unit?.factor ?? "1"}
                required
              />
              <p className="text-xs text-muted-foreground">{strings.units.factorHint}</p>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? strings.common.saving : strings.common.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
