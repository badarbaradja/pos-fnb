"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { sendStockTransfer, type StockTransferFormState } from "./actions";
import { LinePreview } from "./line-preview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { id as strings } from "@/lib/i18n/id";

export type EmployeeOption = { id: string; fullName: string };
export type SendItemOption = {
  itemId: string;
  ingredientId: string;
  ingredientName: string;
  baseUnit: string;
  purchaseUnit: string;
  purchaseFactor: string;
  requestedUnit: string;
  requestedQty: string;
};

type LineState = {
  itemId: string;
  unitChoice: "purchase" | "base";
  qty: string;
  unitCost: string;
  diffReason: string;
};

const initialState: StockTransferFormState = {};

/**
 * Halaman kirim (gudang) -- setiap baris SUDAH terisi sesuai
 * requested_qty (satuan yang sama dengan yang diminta outlet), gudang
 * tinggal isi harga dan konfirmasi -- kalau semua sesuai permintaan,
 * cukup isi harga lalu satu klik "Konfirmasi Kirim" (instruksi Anda:
 * "satu tombol kalau tidak ada yang diubah" -- jumlah default sudah
 * cocok, satu-satunya yang tidak bisa didefaultkan adalah harga, karena
 * gudang belum punya sumber cost otomatis).
 */
export function SendStockTransferForm({
  transferId,
  items,
  employees,
}: {
  transferId: string;
  items: SendItemOption[];
  employees: EmployeeOption[];
}) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(sendStockTransfer, initialState);
  const [lines, setLines] = useState<LineState[]>(
    items.map((item) => ({
      itemId: item.itemId,
      unitChoice: item.requestedUnit === item.purchaseUnit ? "purchase" : "base",
      qty: item.requestedQty,
      unitCost: "",
      diffReason: "",
    }))
  );

  useEffect(() => {
    if (state.error) {
      toast.error(state.error);
    }
  }, [state]);

  const itemById = new Map(items.map((i) => [i.itemId, i]));

  function updateLine(itemId: string, patch: Partial<LineState>) {
    setLines((prev) => prev.map((l) => (l.itemId === itemId ? { ...l, ...patch } : l)));
  }

  const linesJson = JSON.stringify(
    lines.map((l) => ({
      itemId: l.itemId,
      unitChoice: l.unitChoice,
      qty: l.qty,
      unitCost: l.unitCost,
      diffReason: l.diffReason || undefined,
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
      <input type="hidden" name="transferId" value={transferId} />
      <input type="hidden" name="linesJson" value={linesJson} />

      <p className="text-sm text-muted-foreground">{strings.stockTransfers.sendHint}</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="sentBy">{strings.stockTransfers.sentByLabel}</Label>
          <select
            id="sentBy"
            name="sentBy"
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
        <div className="flex flex-col gap-2">
          <Label htmlFor="number">{strings.stockTransfers.number}</Label>
          <Input id="number" name="number" placeholder={strings.stockTransfers.numberPlaceholder} />
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {lines.map((line) => {
          const item = itemById.get(line.itemId)!;
          const unit = line.unitChoice === "purchase" ? item.purchaseUnit : item.baseUnit;
          const factor = line.unitChoice === "purchase" ? Number(item.purchaseFactor) : 1;
          const differs = Number(line.qty) !== Number(item.requestedQty);
          return (
            <div key={line.itemId} className="flex flex-col gap-3 rounded-lg border border-border p-4">
              <div className="flex items-center justify-between">
                <p className="font-medium">{item.ingredientName}</p>
                <p className="text-xs text-muted-foreground">
                  {strings.stockTransfers.requestedQtyLabel}: {item.requestedQty} {item.requestedUnit}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="flex flex-col gap-2">
                  <Label>{strings.stockTransfers.unitChoice}</Label>
                  <select
                    value={line.unitChoice}
                    onChange={(e) => updateLine(line.itemId, { unitChoice: e.target.value as "purchase" | "base" })}
                    className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
                  >
                    <option value="purchase">
                      {strings.stockTransfers.unitChoicePurchase.replace("{unit}", item.purchaseUnit)}
                    </option>
                    <option value="base">
                      {strings.stockTransfers.unitChoiceBase.replace("{unit}", item.baseUnit)}
                    </option>
                  </select>
                </div>
                <div className="flex flex-col gap-2">
                  <Label>{strings.stockTransfers.sentQtyLabel}</Label>
                  <Input
                    type="number"
                    step="0.0001"
                    min={0}
                    value={line.qty}
                    onChange={(e) => updateLine(line.itemId, { qty: e.target.value })}
                    required
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>{strings.stockTransfers.sentUnitCostLabel}</Label>
                  <Input
                    type="number"
                    step="0.00000001"
                    min={0}
                    value={line.unitCost}
                    onChange={(e) => updateLine(line.itemId, { unitCost: e.target.value })}
                    required
                  />
                </div>
              </div>
              {differs ? (
                <div className="flex flex-col gap-2">
                  <Label className="text-destructive">{strings.stockTransfers.sendDiffReasonLabel}</Label>
                  <Input
                    value={line.diffReason}
                    onChange={(e) => updateLine(line.itemId, { diffReason: e.target.value })}
                    required
                  />
                </div>
              ) : null}
              <LinePreview baseUnit={item.baseUnit} unit={unit} factor={factor} qty={line.qty} />
            </div>
          );
        })}
      </div>

      <div>
        <Button type="submit" disabled={isPending}>
          {isPending ? strings.common.saving : strings.stockTransfers.sendSubmitButton}
        </Button>
      </div>
    </form>
  );
}
