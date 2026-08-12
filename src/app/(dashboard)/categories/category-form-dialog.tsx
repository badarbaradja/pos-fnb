"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { saveCategory, type CategoryFormState } from "./actions";
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

export type CategoryFormValue = {
  id: string;
  name: string;
  color: string | null;
  sortOrder: number;
};

const initialState: CategoryFormState = {};

export function CategoryFormDialog({
  category,
  trigger,
}: {
  category?: CategoryFormValue;
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(
    saveCategory,
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
              {category ? strings.categories.editTitle : strings.categories.addTitle}
            </DialogTitle>
          </DialogHeader>
          {category ? <input type="hidden" name="id" value={category.id} /> : null}
          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">{strings.categories.name}</Label>
              <Input
                id="name"
                name="name"
                defaultValue={category?.name}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="color">{strings.categories.color}</Label>
              <Input
                id="color"
                name="color"
                type="color"
                defaultValue={category?.color ?? "#94a3b8"}
                className="h-10 w-20 p-1"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="sortOrder">{strings.categories.sortOrder}</Label>
              <Input
                id="sortOrder"
                name="sortOrder"
                type="number"
                defaultValue={category?.sortOrder ?? 0}
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
