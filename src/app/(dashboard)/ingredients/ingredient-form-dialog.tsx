"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { saveIngredient, type IngredientFormState } from "./actions";
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

export type UnitOption = { code: string; name: string };

export type IngredientFormValue = {
  id: string;
  code: string | null;
  name: string;
  category: string | null;
  baseUnit: string;
  purchaseUnit: string;
  purchaseFactor: string;
  yieldPercent: string;
  isSemiFinished: boolean;
  shelfLifeDays: number | null;
};

const initialState: IngredientFormState = {};
const EXAMPLE_QTY = 2;

// Preview murni tampilan (bukan kalkulasi bisnis, CLAUDE.md §3.5) -- cuma
// merapikan angka di layar sebelum disimpan, tidak pernah dikirim ke server.
function formatPreviewNumber(value: number): string {
  if (!Number.isFinite(value)) return "";
  return value.toFixed(8).replace(/\.?0+$/, "");
}

export function IngredientFormDialog({
  ingredient,
  unitOptions,
  baseUnitLocked,
  trigger,
}: {
  ingredient?: IngredientFormValue;
  unitOptions: UnitOption[];
  baseUnitLocked?: boolean;
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(saveIngredient, initialState);

  const [baseUnit, setBaseUnit] = useState(ingredient?.baseUnit ?? unitOptions[0]?.code ?? "");
  const [purchaseUnit, setPurchaseUnit] = useState(
    ingredient?.purchaseUnit ?? unitOptions[0]?.code ?? ""
  );
  const [purchaseFactor, setPurchaseFactor] = useState(ingredient?.purchaseFactor ?? "1");

  useEffect(() => {
    if (state.error) {
      toast.error(state.error);
    }
  }, [state]);

  function resetControlledFields() {
    setBaseUnit(ingredient?.baseUnit ?? unitOptions[0]?.code ?? "");
    setPurchaseUnit(ingredient?.purchaseUnit ?? unitOptions[0]?.code ?? "");
    setPurchaseFactor(ingredient?.purchaseFactor ?? "1");
  }

  const factorNumber = Number(purchaseFactor);
  const previewValid = Boolean(baseUnit) && Boolean(purchaseUnit) && factorNumber > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) resetControlledFields();
      }}
    >
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
              {ingredient ? strings.ingredients.editTitle : strings.ingredients.addTitle}
            </DialogTitle>
          </DialogHeader>
          {ingredient ? <input type="hidden" name="id" value={ingredient.id} /> : null}
          <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">{strings.ingredients.name}</Label>
              <Input id="name" name="name" defaultValue={ingredient?.name} required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="code">{strings.ingredients.code}</Label>
              <Input id="code" name="code" defaultValue={ingredient?.code ?? ""} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="category">{strings.ingredients.category}</Label>
              <Input
                id="category"
                name="category"
                placeholder={strings.ingredients.categoryPlaceholder}
                defaultValue={ingredient?.category ?? ""}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="baseUnit">{strings.ingredients.baseUnit}</Label>
              <select
                id="baseUnit"
                name="baseUnit"
                value={baseUnit}
                onChange={(e) => setBaseUnit(e.target.value)}
                disabled={baseUnitLocked}
                required
                className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm disabled:opacity-50"
              >
                {unitOptions.map((u) => (
                  <option key={u.code} value={u.code}>
                    {u.code} -- {u.name}
                  </option>
                ))}
              </select>
              {baseUnitLocked ? (
                <p className="text-xs text-muted-foreground">
                  {strings.ingredients.baseUnitLockedHint}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="purchaseUnit">{strings.ingredients.purchaseUnit}</Label>
              <select
                id="purchaseUnit"
                name="purchaseUnit"
                value={purchaseUnit}
                onChange={(e) => setPurchaseUnit(e.target.value)}
                required
                className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
              >
                {unitOptions.map((u) => (
                  <option key={u.code} value={u.code}>
                    {u.code} -- {u.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="purchaseFactor">{strings.ingredients.purchaseFactor}</Label>
              <Input
                id="purchaseFactor"
                name="purchaseFactor"
                type="number"
                step="0.00000001"
                min={0}
                value={purchaseFactor}
                onChange={(e) => setPurchaseFactor(e.target.value)}
                required
              />
            </div>
            <div className="rounded-lg border border-input bg-muted/40 px-3 py-2 text-sm">
              {previewValid ? (
                <>
                  <p>
                    {strings.ingredients.previewLine1
                      .replace("{purchaseUnit}", purchaseUnit)
                      .replace("{factor}", formatPreviewNumber(factorNumber))
                      .replace("{baseUnit}", baseUnit)}
                  </p>
                  <p className="text-muted-foreground">
                    {strings.ingredients.previewLine2
                      .replace("{qty}", String(EXAMPLE_QTY))
                      .replace("{purchaseUnit}", purchaseUnit)
                      .replace("{result}", formatPreviewNumber(EXAMPLE_QTY * factorNumber))
                      .replace("{baseUnit}", baseUnit)}
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground">{strings.ingredients.previewPlaceholder}</p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="yieldPercent">{strings.ingredients.yieldPercent}</Label>
              <Input
                id="yieldPercent"
                name="yieldPercent"
                type="number"
                step="0.0001"
                min={0}
                defaultValue={ingredient?.yieldPercent ?? "100"}
              />
              <p className="text-xs text-muted-foreground">{strings.ingredients.yieldPercentHint}</p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="shelfLifeDays">{strings.ingredients.shelfLifeDays}</Label>
              <Input
                id="shelfLifeDays"
                name="shelfLifeDays"
                type="number"
                step="1"
                min={0}
                defaultValue={ingredient?.shelfLifeDays ?? ""}
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="isSemiFinished"
                name="isSemiFinished"
                defaultChecked={ingredient?.isSemiFinished ?? false}
              />
              <Label htmlFor="isSemiFinished" className="text-sm font-normal">
                {strings.ingredients.isSemiFinished}
              </Label>
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
