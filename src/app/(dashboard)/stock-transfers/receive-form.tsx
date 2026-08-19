"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { receiveStockTransfer, type StockTransferFormState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { id as strings } from "@/lib/i18n/id";

export type EmployeeOption = { id: string; fullName: string };
export type ReceiveItemOption = {
  itemId: string;
  ingredientName: string;
  sentUnit: string;
  sentQty: string;
};

type LineState = { itemId: string; receivedQty: string; diffReason: string };

const initialState: StockTransferFormState = {};

/**
 * Halaman terima (outlet) -- setiap baris SUDAH terisi sesuai sent_qty,
 * SATUAN SAMA (tidak perlu pilih satuan lagi, sudah ditentukan gudang
 * saat kirim -- outlet cuma konfirmasi angka). Kalau sesuai, langsung
 * konfirmasi; kalau beda, ubah angka -- alasan wajib muncul otomatis.
 */
export function ReceiveStockTransferForm({
  transferId,
  items,
  employees,
}: {
  transferId: string;
  items: ReceiveItemOption[];
  employees: EmployeeOption[];
}) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(receiveStockTransfer, initialState);
  const [lines, setLines] = useState<LineState[]>(
    items.map((item) => ({ itemId: item.itemId, receivedQty: item.sentQty, diffReason: "" }))
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
      receivedQty: l.receivedQty,
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

      <p className="text-sm text-muted-foreground">{strings.stockTransfers.receiveHint}</p>

      <div className="flex flex-col gap-2 sm:max-w-xs">
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

      <div className="flex flex-col gap-4">
        {lines.map((line) => {
          const item = itemById.get(line.itemId)!;
          const differs = Number(line.receivedQty) !== Number(item.sentQty);
          return (
            <div key={line.itemId} className="flex flex-col gap-3 rounded-lg border border-border p-4">
              <div className="flex items-center justify-between">
                <p className="font-medium">{item.ingredientName}</p>
                <p className="text-xs text-muted-foreground">
                  {strings.stockTransfers.sentQtyLabel}: {item.sentQty} {item.sentUnit}
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:max-w-xs">
                <Label>
                  {strings.stockTransfers.receivedQtyLabel} ({item.sentUnit})
                </Label>
                <Input
                  type="number"
                  step="0.0001"
                  min={0}
                  value={line.receivedQty}
                  onChange={(e) => updateLine(line.itemId, { receivedQty: e.target.value })}
                  required
                />
              </div>
              {differs ? (
                <div className="flex flex-col gap-2">
                  <Label className="text-destructive">{strings.stockTransfers.receiveDiffReasonLabel}</Label>
                  <Input
                    value={line.diffReason}
                    onChange={(e) => updateLine(line.itemId, { diffReason: e.target.value })}
                    required
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div>
        <Button type="submit" disabled={isPending}>
          {isPending ? strings.common.saving : strings.stockTransfers.receiveSubmitButton}
        </Button>
      </div>
    </form>
  );
}
