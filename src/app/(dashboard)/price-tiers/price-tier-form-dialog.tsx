"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { savePriceTier, type PriceTierFormState } from "./actions";
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

export type PriceTierFormValue = {
  id: string;
  code: string;
  name: string;
  channel: string | null;
  markupPercent: string | null;
  isDefault: boolean;
};

const initialState: PriceTierFormState = {};

export function PriceTierFormDialog({
  priceTier,
  trigger,
}: {
  priceTier?: PriceTierFormValue;
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(
    savePriceTier,
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
              {priceTier ? strings.priceTiers.editTitle : strings.priceTiers.addTitle}
            </DialogTitle>
          </DialogHeader>
          {priceTier ? (
            <input type="hidden" name="id" value={priceTier.id} />
          ) : null}
          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="code">{strings.priceTiers.code}</Label>
              <Input
                id="code"
                name="code"
                defaultValue={priceTier?.code}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">{strings.priceTiers.name}</Label>
              <Input
                id="name"
                name="name"
                defaultValue={priceTier?.name}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="channel">{strings.priceTiers.channel}</Label>
              <Input
                id="channel"
                name="channel"
                defaultValue={priceTier?.channel ?? ""}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="markupPercent">
                {strings.priceTiers.markupPercent}
              </Label>
              <Input
                id="markupPercent"
                name="markupPercent"
                type="number"
                step="0.0001"
                defaultValue={priceTier?.markupPercent ?? "0"}
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="isDefault"
                name="isDefault"
                defaultChecked={priceTier?.isDefault ?? false}
              />
              <Label htmlFor="isDefault">{strings.priceTiers.isDefault}</Label>
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
