"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { saveModifierGroup, type ModifierGroupFormState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { id as strings } from "@/lib/i18n/id";

export type ModifierGroupFormValue = {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  isRequired: boolean;
};

const initialState: ModifierGroupFormState = {};

export function ModifierGroupFormDialog({
  modifierGroup,
  trigger,
}: {
  modifierGroup?: ModifierGroupFormValue;
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(
    saveModifierGroup,
    initialState
  );

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
            <DialogTitle>
              {modifierGroup
                ? strings.modifierGroups.editTitle
                : strings.modifierGroups.addTitle}
            </DialogTitle>
          </DialogHeader>
          {modifierGroup ? (
            <input type="hidden" name="id" value={modifierGroup.id} />
          ) : null}
          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">{strings.modifierGroups.name}</Label>
              <Input
                id="name"
                name="name"
                defaultValue={modifierGroup?.name}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="minSelect">{strings.modifierGroups.minSelect}</Label>
              <Input
                id="minSelect"
                name="minSelect"
                type="number"
                min={0}
                defaultValue={modifierGroup?.minSelect ?? 0}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="maxSelect">{strings.modifierGroups.maxSelect}</Label>
              <Input
                id="maxSelect"
                name="maxSelect"
                type="number"
                min={0}
                defaultValue={modifierGroup?.maxSelect ?? 1}
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="isRequired"
                name="isRequired"
                defaultChecked={modifierGroup?.isRequired ?? false}
              />
              <Label htmlFor="isRequired">{strings.modifierGroups.isRequired}</Label>
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
