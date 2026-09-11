"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { openShift } from "@/app/(pos)/pos/shift/actions";
import { generateId } from "@/lib/utils/id";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { id as strings } from "@/lib/i18n/id";

export function OpenShiftForm({
  outletId,
  deviceId,
  cashEnabled,
}: {
  outletId: string;
  deviceId: string;
  cashEnabled: boolean;
}) {
  const router = useRouter();
  const [employeeCode, setEmployeeCode] = useState("");
  const [pin, setPin] = useState("");
  const [openingCash, setOpeningCash] = useState("0");
  const [servedByName, setServedByName] = useState("");
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsPending(true);
    try {
      const result = await openShift({
        id: generateId(),
        outletId,
        deviceId,
        employeeCode,
        pin,
        // Server tetap memaksa "0" untuk outlet cashless walau field ini
        // dikirim -- lihat komentar di openShiftWithDb (lib/pos/shift.ts).
        openingCash: cashEnabled ? openingCash : "0",
        // Server yang memutuskan apakah ini wajib (tergantung
        // employees.isSharedAccount, tidak diketahui di klien SEBELUM PIN
        // diverifikasi) -- field ini SELALU dikirim, kosong kalau memang
        // tidak relevan (TT09b).
        servedByName,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      if (result.success) {
        toast.success(`${strings.shift.openTitle} — ${result.success.employeeName}`);
        router.push("/pos");
        router.refresh();
      }
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="employeeCode">{strings.shift.employeeCodeLabel}</Label>
        <Input
          id="employeeCode"
          value={employeeCode}
          onChange={(e) => setEmployeeCode(e.target.value)}
          autoComplete="off"
          required
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="pin">{strings.shift.pinLabel}</Label>
        <Input
          id="pin"
          type="password"
          inputMode="numeric"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          autoComplete="off"
          required
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="servedByName">{strings.shift.servedByNameLabel}</Label>
        <Input
          id="servedByName"
          value={servedByName}
          onChange={(e) => setServedByName(e.target.value)}
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">{strings.shift.servedByNameHint}</p>
      </div>
      {cashEnabled ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="openingCash">{strings.shift.openingCashLabel}</Label>
          <Input
            id="openingCash"
            type="number"
            min={0}
            step="0.01"
            value={openingCash}
            onChange={(e) => setOpeningCash(e.target.value)}
            required
          />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{strings.shift.noOpeningCashNote}</p>
      )}
      <Button type="submit" disabled={isPending}>
        {isPending ? strings.shift.opening : strings.shift.openButton}
      </Button>
    </form>
  );
}
