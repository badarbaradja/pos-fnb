"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { saveModifier, type ModifierFormState } from "./actions";
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

export type ModifierFormValue = {
  id: string;
  name: string;
  price: string;
  sortOrder: number;
};

const initialState: ModifierFormState = {};

export function ModifierFormDialog({
  modifierGroupId,
  modifier,
  trigger,
}: {
  modifierGroupId: string;
  modifier?: ModifierFormValue;
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(
    saveModifier,
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
              {modifier ? strings.modifiers.editTitle : strings.modifiers.addTitle}
            </DialogTitle>
          </DialogHeader>
          <input type="hidden" name="modifierGroupId" value={modifierGroupId} />
          {modifier ? (
            <input type="hidden" name="id" value={modifier.id} />
          ) : null}
          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">{strings.modifiers.name}</Label>
              <Input
                id="name"
                name="name"
                defaultValue={modifier?.name}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="price">{strings.modifiers.price}</Label>
              <Input
                id="price"
                name="price"
                type="number"
                step="0.01"
                defaultValue={modifier?.price ?? "0"}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="sortOrder">{strings.modifiers.sortOrder}</Label>
              <Input
                id="sortOrder"
                name="sortOrder"
                type="number"
                defaultValue={modifier?.sortOrder ?? 0}
              />
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
