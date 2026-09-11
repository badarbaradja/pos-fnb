"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setBarangMenumpukThreshold } from "@/app/(pos)/pos/thrift/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { id as strings } from "@/lib/i18n/id";

/**
 * components/pos/thrift/menumpuk-threshold-form.tsx — instruksi CEO 11
 * September 2026: ambang "barang menumpuk" default 60 hari, tapi wajib
 * bisa diubah Ita/CEO, bukan angka mati. Ita tidak pernah login dashboard
 * (lib/pos/thrift-statistik.ts), jadi kontrolnya taruh di sini, langsung
 * di Statistik Ita -- bukan di outlet-form-dialog.tsx dashboard yang tidak
 * pernah dia lihat.
 */
export function MenumpukThresholdForm({
  shiftId,
  currentDays,
}: {
  shiftId: string;
  currentDays: number;
}) {
  const router = useRouter();
  const [days, setDays] = useState(String(currentDays));
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsPending(true);
    try {
      const result = await setBarangMenumpukThreshold(shiftId, days);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      if (result.success) {
        toast.success(strings.statistikIta.menumpukThresholdSuccess);
        router.refresh();
      }
    } catch (err) {
      console.error("Ubah ambang barang menumpuk gagal:", err);
      toast.error(err instanceof Error ? err.message : strings.common.unexpectedError);
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 rounded-lg border p-3">
      <Label htmlFor="menumpukDays" className="text-xs">
        {strings.statistikIta.menumpukThresholdLabel}
      </Label>
      <div className="flex items-center gap-2">
        <Input
          id="menumpukDays"
          type="number"
          min={1}
          step="1"
          value={days}
          onChange={(e) => setDays(e.target.value)}
          className="w-24"
        />
        <Button type="submit" size="sm" variant="outline" disabled={isPending}>
          {isPending ? strings.statistikIta.menumpukThresholdSaving : strings.statistikIta.menumpukThresholdSave}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{strings.statistikIta.menumpukThresholdHint}</p>
    </form>
  );
}
