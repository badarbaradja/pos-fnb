"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Decimal } from "decimal.js";
import { toast } from "sonner";
import { saveShiftOpnameItems, submitShiftOpname } from "@/app/(pos)/pos/shift/actions";
import type { ShiftOpnameItemRow } from "@/lib/stock-opnames/shift-opname";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { id as strings } from "@/lib/i18n/id";

type RowState = { physicalQty: string; reason: string };

/**
 * Rencana Revisi 24 September 2026 §7 poin 4 -- satu komponen dipakai untuk
 * DUA konteks: 'buka' (halaman tersendiri, gerbang sebelum kasir jualan --
 * lihat pos/shift/opname-buka/page.tsx) dan 'tutup' (DITEMPEL di layar
 * tutup shift yang sudah ada, bukan langkah terpisah -- lihat
 * close-shift-form.tsx/close-cashless-shift-form.tsx).
 *
 * Baseline pembanding per baris: 'buka' pakai item.previousClosingBalance
 * (saldo akhir shift sebelumnya, dari stock_movements.balanceAfter --
 * sudah dihitung server di getShiftOpnameItemsForSession), 'tutup' pakai
 * item.systemQty (snapshot qty_on_hand saat sesi dibuat). `null` pada
 * keduanya berarti TIDAK ADA pembanding untuk bahan ini -- baik karena
 * shift pertama di outlet, atau bahan ini baru ditandai hitungTiapShift
 * setelah outlet berjalan (tidak pernah ada movement sebelumnya) -- di
 * kedua kasus TIDAK PERNAH menampilkan selisih (apalagi mewajibkan
 * alasan), sama persis logika validasiAlasanSelisihWajib di
 * lib/stock-opnames/manage.ts supaya UI dan server tidak pernah berbeda
 * pendapat soal kapan alasan wajib.
 *
 * Ambang (varianceAlertValue/Percent) di sini HANYA untuk pratinjau live --
 * penegakan sesungguhnya (menolak submit tanpa alasan) ada di server lewat
 * validasiAlasanSelisihWajib, dipanggil dari submitOpnameWithDb.
 */
export function ShiftOpnameForm({
  jenis,
  opnameId,
  outletId,
  businessDate,
  items,
  isFirstShiftAtOutlet,
  varianceAlertValue,
  varianceAlertPercent,
}: {
  jenis: "buka" | "tutup";
  opnameId: string;
  outletId: string;
  businessDate: string;
  items: ShiftOpnameItemRow[];
  isFirstShiftAtOutlet: boolean;
  varianceAlertValue: string;
  varianceAlertPercent: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(
      items.map((i) => [
        i.ingredientId,
        { physicalQty: i.physicalQty ?? "", reason: i.varianceReason ?? "" },
      ])
    )
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  function baselineFor(item: ShiftOpnameItemRow): string | null {
    return jenis === "buka" ? item.previousClosingBalance : item.systemQty;
  }

  function varianceFor(
    item: ShiftOpnameItemRow,
    row: RowState
  ): { variance: Decimal; melampauiAmbang: boolean } | null {
    const base = baselineFor(item);
    if (base === null || row.physicalQty.trim() === "") return null;
    const baseD = new Decimal(base);
    const physical = new Decimal(row.physicalQty);
    const variance = physical.minus(baseD);
    const totalCost = variance.abs().times(item.unitCost);
    const lampauiNilai = totalCost.greaterThan(varianceAlertValue);
    const lampauiPersen =
      !baseD.isZero() &&
      variance.abs().div(baseD.abs()).times(100).greaterThan(varianceAlertPercent);
    return { variance, melampauiAmbang: lampauiNilai || lampauiPersen };
  }

  function updateRow(ingredientId: string, patch: Partial<RowState>) {
    setRows((r) => ({ ...r, [ingredientId]: { ...r[ingredientId]!, ...patch } }));
  }

  async function persistAll(): Promise<boolean> {
    const payload = items
      .filter((i) => rows[i.ingredientId]!.physicalQty.trim() !== "")
      .map((i) => ({
        ingredientId: i.ingredientId,
        physicalQty: rows[i.ingredientId]!.physicalQty,
        unitCost: i.unitCost,
        varianceReason: rows[i.ingredientId]!.reason.trim() || undefined,
      }));
    if (payload.length === 0) return true;
    const result = await saveShiftOpnameItems({ opnameId, outletId, items: payload });
    if (result.error) {
      toast.error(result.error);
      return false;
    }
    return true;
  }

  // Dipakai jenis 'tutup' saja -- autosave per baris (onBlur) supaya
  // finalizeShiftClosingOpnameIfAny (dipanggil dari tombol tutup shift yang
  // SUDAH ADA, di luar komponen ini) melihat data terbaru saat kasir
  // menekan tombol itu. TIDAK ADA tombol submit terpisah di sini untuk
  // 'tutup' -- itu yang membuat closeAndReopenShiftWithDb dkk tetap satu
  // langkah.
  async function handleBlurSave() {
    await persistAll();
  }

  async function handleSubmitOpening(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const ok = await persistAll();
      if (!ok) return;
      const result = await submitShiftOpname({ opnameId, outletId, businessDate });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(strings.shiftOpname.openingSubmittedSuccess);
      router.push("/pos");
      router.refresh();
    } catch (err) {
      console.error("Submit opname buka gagal:", err);
      toast.error(err instanceof Error ? err.message : strings.common.unexpectedError);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (items.length === 0) {
    return jenis === "tutup" ? null : (
      <p className="text-sm text-muted-foreground">{strings.shiftOpname.noFlaggedIngredients}</p>
    );
  }

  const rowsBody = (
    <div className="flex flex-col gap-3">
      {jenis === "buka" && isFirstShiftAtOutlet ? (
        <p className="text-sm text-muted-foreground">{strings.shiftOpname.firstShiftNote}</p>
      ) : null}
      {items.map((item) => {
        const row = rows[item.ingredientId]!;
        const base = baselineFor(item);
        const v = varianceFor(item, row);
        const noBaselineNote =
          base === null && !(jenis === "buka" && isFirstShiftAtOutlet);
        return (
          <div key={item.ingredientId} className="flex flex-col gap-2 rounded-lg border p-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium">{item.ingredientName}</span>
              <span className="text-xs text-muted-foreground">{item.baseUnit}</span>
            </div>
            {jenis === "buka" ? (
              <div className="text-xs text-muted-foreground">
                {base === null
                  ? noBaselineNote
                    ? strings.shiftOpname.noBaselineNote
                    : null
                  : `${strings.shiftOpname.colPreviousClosing}: ${base} ${item.baseUnit}`}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">
                {strings.shiftOpname.colSystemQty}: {item.systemQty} {item.baseUnit}
              </div>
            )}
            <div className="flex items-center gap-2">
              <Label htmlFor={`qty-${jenis}-${item.ingredientId}`} className="w-28 text-xs">
                {strings.shiftOpname.colPhysicalQty}
              </Label>
              <Input
                id={`qty-${jenis}-${item.ingredientId}`}
                type="number"
                step="0.01"
                min={0}
                className="h-11"
                value={row.physicalQty}
                onChange={(e) => updateRow(item.ingredientId, { physicalQty: e.target.value })}
                onBlur={jenis === "tutup" ? handleBlurSave : undefined}
              />
            </div>
            {v ? (
              <div
                className={
                  v.melampauiAmbang
                    ? "text-sm font-medium text-destructive"
                    : "text-sm text-muted-foreground"
                }
              >
                {strings.shiftOpname.colVariance}: {v.variance.toFixed(2)} {item.baseUnit}
              </div>
            ) : null}
            {v?.melampauiAmbang ? (
              <div className="flex flex-col gap-1">
                <Label htmlFor={`reason-${jenis}-${item.ingredientId}`} className="text-xs">
                  {strings.shiftOpname.reasonRequiredLabel}
                </Label>
                <Textarea
                  id={`reason-${jenis}-${item.ingredientId}`}
                  value={row.reason}
                  onChange={(e) => updateRow(item.ingredientId, { reason: e.target.value })}
                  onBlur={jenis === "tutup" ? handleBlurSave : undefined}
                  placeholder={strings.shiftOpname.reasonPlaceholder}
                  required
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );

  if (jenis === "tutup") {
    return (
      <div className="flex w-full max-w-sm flex-col gap-2">
        <h2 className="text-base font-semibold">{strings.shiftOpname.closingTitle}</h2>
        <p className="text-sm text-muted-foreground">{strings.shiftOpname.closingHint}</p>
        {rowsBody}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmitOpening} className="flex w-full max-w-sm flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">{strings.shiftOpname.openingTitle}</h1>
        <p className="text-sm text-muted-foreground">{strings.shiftOpname.openingHint}</p>
      </div>
      {rowsBody}
      <Button type="submit" disabled={isSubmitting} size="lg">
        {isSubmitting ? strings.shiftOpname.openingSubmitting : strings.shiftOpname.openingSubmitButton}
      </Button>
    </form>
  );
}
