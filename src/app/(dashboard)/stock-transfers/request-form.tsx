"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { requestStockTransfer, type StockTransferFormState } from "./actions";
import { LinePreview } from "./line-preview";
import { Badge } from "@/components/ui/badge";
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
export type LastRequestLine = { ingredientId: string; unit: string; qty: string };
export type StockByIngredient = Record<string, string>; // ingredientId -> qty_on_hand (base_unit)

type LineState = { key: string; ingredientId: string; unitChoice: "purchase" | "base"; qty: string };

function newLine(defaultIngredientId: string): LineState {
  return { key: crypto.randomUUID(), ingredientId: defaultIngredientId, unitChoice: "purchase", qty: "" };
}

const initialState: StockTransferFormState = {};

/**
 * Halaman request outlet -- SYARAT, bukan pelengkap (instruksi Anda):
 * pilih bahan, ketik jumlah, kirim, target di bawah 30 detik untuk 5
 * bahan. Tanpa field wajib lain di luar itu -- outlet, catatan (opsional),
 * siapa yang minta, lalu baris bahan. Tombol "Ulangi Permintaan Terakhir"
 * mengisi form dari lastRequestLines (dari server, sudah diambil sekali
 * saat halaman dibuka -- bukan fetch tambahan saat tombol ditekan).
 */
export function RequestStockTransferForm({
  outlets,
  ingredients,
  employees,
  lastRequestByOutlet,
  centralKitchenStock,
  outletStockByOutlet,
}: {
  outlets: OutletOption[];
  ingredients: IngredientOption[];
  employees: EmployeeOption[];
  lastRequestByOutlet: Record<string, LastRequestLine[]>;
  centralKitchenStock: StockByIngredient;
  outletStockByOutlet: Record<string, StockByIngredient>;
}) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(requestStockTransfer, initialState);
  const [lines, setLines] = useState<LineState[]>([newLine(ingredients[0]?.id ?? "")]);
  const [toOutletId, setToOutletId] = useState(outlets[0]?.id ?? "");

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

  function applyLastRequest() {
    const lastRequestLines = lastRequestByOutlet[toOutletId] ?? [];
    if (lastRequestLines.length === 0) {
      toast.error(strings.stockTransfers.repeatLastEmpty);
      return;
    }
    setLines(
      lastRequestLines.map((l) => {
        const ingredient = ingredientById.get(l.ingredientId);
        const unitChoice: "purchase" | "base" =
          ingredient && l.unit === ingredient.purchaseUnit ? "purchase" : "base";
        return { key: crypto.randomUUID(), ingredientId: l.ingredientId, unitChoice, qty: l.qty };
      })
    );
    toast.success(strings.stockTransfers.repeatLastApplied);
  }

  const linesJson = JSON.stringify(
    lines.map((l) => ({ ingredientId: l.ingredientId, unitChoice: l.unitChoice, qty: l.qty }))
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

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{strings.stockTransfers.requestHint}</p>
        <Button type="button" variant="outline" size="sm" onClick={applyLastRequest}>
          {strings.stockTransfers.repeatLastButton}
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="toOutletId">{strings.stockTransfers.outlet}</Label>
          <select
            id="toOutletId"
            name="toOutletId"
            required
            value={toOutletId}
            onChange={(e) => setToOutletId(e.target.value)}
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
          <Label htmlFor="requestedBy">{strings.stockTransfers.requestedByLabel}</Label>
          <select
            id="requestedBy"
            name="requestedBy"
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
        </div>
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor="note">{strings.stockTransfers.note}</Label>
          <Input id="note" name="note" />
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {lines.map((line) => {
          const ingredient = ingredientById.get(line.ingredientId);
          const unit = line.unitChoice === "purchase" ? ingredient?.purchaseUnit : ingredient?.baseUnit;
          const factor = line.unitChoice === "purchase" ? Number(ingredient?.purchaseFactor ?? 1) : 1;
          // Stok gudang pusat + stok outlet peminta, TIDAK PERNAH memblokir
          // (§4 instruksi CEO) -- murni informasi supaya orang bisa
          // memutuskan sendiri, bukan minta jumlah buta lalu ditolak Ita.
          const warehouseQty = Number(centralKitchenStock[line.ingredientId] ?? "0");
          const outletQty = Number(outletStockByOutlet[toOutletId]?.[line.ingredientId] ?? "0");
          const requestedQtyBase = Number(line.qty || 0) * factor;
          const exceedsWarehouse = line.qty.trim() !== "" && requestedQtyBase > warehouseQty;
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
                    value={line.unitChoice}
                    onChange={(e) => updateLine(line.key, { unitChoice: e.target.value as "purchase" | "base" })}
                    className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
                  >
                    <option value="purchase">
                      {strings.stockTransfers.unitChoicePurchase.replace("{unit}", ingredient?.purchaseUnit ?? "")}
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
              {ingredient ? (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {warehouseQty <= 0 ? (
                    <Badge variant="destructive">{strings.stockTransfers.warehouseStockEmpty}</Badge>
                  ) : (
                    <Badge variant="secondary">
                      {strings.stockTransfers.warehouseStockLabel}: {warehouseQty} {ingredient.baseUnit}
                    </Badge>
                  )}
                  <Badge variant="secondary">
                    {strings.stockTransfers.outletStockLabel}: {outletQty} {ingredient.baseUnit}
                  </Badge>
                </div>
              ) : null}
              <div className="flex flex-col gap-2">
                <Label>{strings.stockTransfers.requestedQtyLabel}</Label>
                <Input
                  type="number"
                  step="0.0001"
                  min={0}
                  value={line.qty}
                  onChange={(e) => updateLine(line.key, { qty: e.target.value })}
                  required
                />
                {exceedsWarehouse ? (
                  <p className="text-xs text-amber-600 dark:text-amber-500">
                    {strings.stockTransfers.exceedsWarehouseStockWarning
                      .replace("{available}", String(warehouseQty))
                      .replace("{unit}", ingredient?.baseUnit ?? "")}
                  </p>
                ) : null}
              </div>
              {ingredient ? (
                <LinePreview baseUnit={ingredient.baseUnit} unit={unit ?? ""} factor={factor} qty={line.qty} />
              ) : null}
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
          {isPending ? strings.common.saving : strings.stockTransfers.requestSubmitButton}
        </Button>
      </div>
    </form>
  );
}
