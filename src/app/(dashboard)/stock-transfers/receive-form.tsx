"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { receiveStockTransfer, type ReceiveStockTransferFormState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { id as strings } from "@/lib/i18n/id";

export type OutletOption = { id: string; name: string };
export type EmployeeOption = { id: string; fullName: string };
export type IngredientOption = {
  id: string;
  name: string;
  baseUnit: string;
  purchaseUnit: string;
  purchaseFactor: string;
};

type LineState = {
  key: string;
  ingredientId: string;
  enteredUnitChoice: "purchase" | "base";
  enteredQty: string;
  enteredUnitCost: string;
};

function newLine(defaultIngredientId: string): LineState {
  return {
    key: crypto.randomUUID(),
    ingredientId: defaultIngredientId,
    enteredUnitChoice: "purchase",
    enteredQty: "",
    enteredUnitCost: "",
  };
}

function formatPreviewNumber(value: number): string {
  if (!Number.isFinite(value)) return "";
  return value.toFixed(8).replace(/\.?0+$/, "");
}

function LinePreview({ ingredient, line }: { ingredient: IngredientOption | undefined; line: LineState }) {
  if (!ingredient) return null;

  const unit = line.enteredUnitChoice === "purchase" ? ingredient.purchaseUnit : ingredient.baseUnit;
  const factor = line.enteredUnitChoice === "purchase" ? Number(ingredient.purchaseFactor) : 1;
  const qty = Number(line.enteredQty);
  const valid = Number.isFinite(qty) && qty > 0 && Number.isFinite(factor) && factor > 0;

  if (!valid) {
    return <p className="text-xs text-muted-foreground">{strings.ingredients.previewPlaceholder}</p>;
  }

  const line1 =
    line.enteredUnitChoice === "purchase"
      ? strings.stockTransfers.previewLine1Convert
          .replace("{unit}", unit)
          .replace("{factor}", formatPreviewNumber(factor))
          .replace("{baseUnit}", ingredient.baseUnit)
      : strings.stockTransfers.previewLine1Identity.replace(/\{unit\}/g, unit);

  const line2 = strings.stockTransfers.previewLine2
    .replace("{qty}", line.enteredQty)
    .replace("{unit}", unit)
    .replace("{result}", formatPreviewNumber(qty * factor))
    .replace("{baseUnit}", ingredient.baseUnit);

  return (
    <div className="rounded-lg border border-input bg-muted/40 px-3 py-2 text-sm">
      <p>{line1}</p>
      <p className="text-muted-foreground">{line2}</p>
    </div>
  );
}

const initialState: ReceiveStockTransferFormState = {};

export function ReceiveStockTransferForm({
  outlets,
  ingredients,
  employees,
}: {
  outlets: OutletOption[];
  ingredients: IngredientOption[];
  employees: EmployeeOption[];
}) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(receiveStockTransfer, initialState);
  const [lines, setLines] = useState<LineState[]>([newLine(ingredients[0]?.id ?? "")]);

  useEffect(() => {
    if (state.error) {
      toast.error(state.error);
    }
  }, [state]);

  const ingredientById = new Map(ingredients.map((i) => [i.id, i]));

  function updateLine(key: string, patch: Partial<LineState>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function removeLine(key: string) {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));
  }

  const linesJson = JSON.stringify(
    lines.map((l) => ({
      ingredientId: l.ingredientId,
      enteredUnitChoice: l.enteredUnitChoice,
      enteredQty: l.enteredQty,
      enteredUnitCost: l.enteredUnitCost,
    }))
  );

  return (
    <form
      action={async (formData) => {
        await formAction(formData);
        if (!state.error) {
          router.push("/stock-transfers");
        }
      }}
      className="flex flex-col gap-6"
    >
      <input type="hidden" name="linesJson" value={linesJson} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="toOutletId">{strings.stockTransfers.outlet}</Label>
          <select
            id="toOutletId"
            name="toOutletId"
            required
            defaultValue={outlets[0]?.id ?? ""}
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
          >
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="number">{strings.stockTransfers.number}</Label>
          <Input id="number" name="number" placeholder={strings.stockTransfers.numberPlaceholder} required />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="receivedBy">{strings.stockTransfers.receivedByLabel}</Label>
          <select
            id="receivedBy"
            name="receivedBy"
            required
            defaultValue={employees[0]?.id ?? ""}
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
          >
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.fullName}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">{strings.stockTransfers.receivedByHint}</p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="note">{strings.stockTransfers.note}</Label>
          <Input id="note" name="note" />
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {lines.map((line) => {
          const ingredient = ingredientById.get(line.ingredientId);
          return (
            <div key={line.key} className="flex flex-col gap-3 rounded-lg border border-border p-4">
              <div className="grid gap-3 sm:grid-cols-4">
                <div className="flex flex-col gap-2 sm:col-span-2">
                  <Label>{strings.stockTransfers.ingredient}</Label>
                  <select
                    value={line.ingredientId}
                    onChange={(e) => updateLine(line.key, { ingredientId: e.target.value })}
                    className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
                  >
                    {ingredients.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-2">
                  <Label>{strings.stockTransfers.unitChoice}</Label>
                  <select
                    value={line.enteredUnitChoice}
                    onChange={(e) =>
                      updateLine(line.key, { enteredUnitChoice: e.target.value as "purchase" | "base" })
                    }
                    className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
                  >
                    <option value="purchase">
                      {strings.stockTransfers.unitChoicePurchase.replace(
                        "{unit}",
                        ingredient?.purchaseUnit ?? ""
                      )}
                    </option>
                    <option value="base">
                      {strings.stockTransfers.unitChoiceBase.replace("{unit}", ingredient?.baseUnit ?? "")}
                    </option>
                  </select>
                </div>
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => removeLine(line.key)}
                    disabled={lines.length <= 1}
                  >
                    {strings.stockTransfers.removeLineButton}
                  </Button>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label>{strings.stockTransfers.enteredQty}</Label>
                  <Input
                    type="number"
                    step="0.0001"
                    min={0}
                    value={line.enteredQty}
                    onChange={(e) => updateLine(line.key, { enteredQty: e.target.value })}
                    required
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>{strings.stockTransfers.enteredUnitCost}</Label>
                  <Input
                    type="number"
                    step="0.00000001"
                    min={0}
                    value={line.enteredUnitCost}
                    onChange={(e) => updateLine(line.key, { enteredUnitCost: e.target.value })}
                    required
                  />
                </div>
              </div>
              <LinePreview ingredient={ingredient} line={line} />
            </div>
          );
        })}
      </div>

      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setLines((prev) => [...prev, newLine(ingredients[0]?.id ?? "")])}
        >
          {strings.stockTransfers.addLineButton}
        </Button>
      </div>

      <div>
        <Button type="submit" disabled={isPending}>
          {isPending ? strings.common.saving : strings.stockTransfers.submitButton}
        </Button>
      </div>
    </form>
  );
}
