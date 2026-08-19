"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { pairDevice } from "@/app/(pos)/pos/setup/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { id as strings } from "@/lib/i18n/id";

export type DeviceOption = {
  id: string;
  name: string;
  serialNumber: string;
  outletName: string;
};

type PairHint = { deviceId: string; deviceName: string; outletName: string };

// localStorage, BUKAN cookie -- ini cuma PETUNJUK pemulihan kalau cookie
// httpOnly hilang (cache dibersihkan, tablet di-reset, incognito), dibaca
// di client supaya siapa pun yang duduk di kasir (termasuk yang TIDAK
// punya izin memasangkan) tetap bisa lihat "tablet ini sebelumnya
// tersambung ke mana" tanpa perlu query server. Server TETAP validasi
// ulang lewat cookie setiap request -- lihat lib/pos/device-pairing.ts.
const HINT_KEY = "pos_device_hint";

function parseHint(raw: string | null): PairHint | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.deviceId === "string" &&
      typeof parsed?.deviceName === "string" &&
      typeof parsed?.outletName === "string"
    ) {
      return parsed as PairHint;
    }
    return null;
  } catch {
    return null;
  }
}

function writeHint(hint: PairHint) {
  try {
    window.localStorage.setItem(HINT_KEY, JSON.stringify(hint));
  } catch {
    // localStorage penuh/diblokir -- petunjuk cuma kenyamanan, aman diabaikan.
  }
}

// useSyncExternalStore (bukan useState+useEffect) -- pola sama
// lib/hooks/use-is-client.ts, supaya tidak kena lint
// react-hooks/set-state-in-effect DAN supaya nilai server (SSR, localStorage
// belum ada) vs client tidak mismatch. cache di luar komponen supaya
// getSnapshot() tetap kembalikan referensi STABIL selama string mentahnya
// belum berubah (syarat useSyncExternalStore, kalau tidak bisa infinite
// loop render).
let cachedRaw: string | null = null;
let cachedHint: PairHint | null = null;

function getSnapshot(): PairHint | null {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(HINT_KEY);
  } catch {
    raw = null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedHint = parseHint(raw);
  }
  return cachedHint;
}

function getServerSnapshot(): PairHint | null {
  return null;
}

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function usePairHint(): PairHint | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function SetupForm({
  canManage,
  devices,
}: {
  canManage: boolean;
  devices: DeviceOption[];
}) {
  const router = useRouter();
  const hint = usePairHint();
  // null = belum dipilih manual, ikuti hint/default. Sekali user memilih
  // sendiri dari dropdown, pilihannya menang atas hint (mis. tablet ini
  // memang pindah tempat, lihat setupHintFoundBody).
  const [manualSelection, setManualSelection] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const hintedIdIsValid = Boolean(hint && devices.some((d) => d.id === hint.deviceId));
  const selectedId =
    manualSelection ?? (hintedIdIsValid ? hint!.deviceId : (devices[0]?.id ?? ""));

  async function handleConnect() {
    if (!selectedId) return;
    setIsPending(true);
    try {
      const result = await pairDevice(selectedId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      if (result.success) {
        writeHint({
          deviceId: result.success.device.id,
          deviceName: result.success.device.name,
          outletName: result.success.outlet.name,
        });
        if (result.success.warning) {
          toast.warning(result.success.warning);
        }
        toast.success(
          `${strings.pos.setupSuccessTitle} — ${result.success.device.name}`
        );
        router.push("/pos");
        router.refresh();
      }
    } finally {
      setIsPending(false);
    }
  }

  if (!canManage) {
    return (
      <div className="flex w-full max-w-sm flex-col gap-2 rounded-lg border p-4">
        <p className="text-sm font-semibold">{strings.pos.setupBlockedTitle}</p>
        <p className="text-sm text-muted-foreground">
          {hint
            ? strings.pos.setupBlockedBodyWithHint
                .replace("{device}", hint.deviceName)
                .replace("{outlet}", hint.outletName)
            : strings.pos.setupBlockedBodyNoHint}
        </p>
      </div>
    );
  }

  if (devices.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{strings.pos.setupNoDevices}</p>
    );
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-4">
      {hint ? (
        <div className="flex flex-col gap-1 rounded-lg border p-3">
          <p className="text-sm font-semibold">{strings.pos.setupHintFoundTitle}</p>
          <p className="text-sm text-muted-foreground">
            {strings.pos.setupHintFoundBody
              .replace("{device}", hint.deviceName)
              .replace("{outlet}", hint.outletName)}
          </p>
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        <Label htmlFor="deviceId">{strings.pos.setupDeviceLabel}</Label>
        <select
          id="deviceId"
          value={selectedId}
          onChange={(e) => setManualSelection(e.target.value)}
          className="h-11 rounded-lg border border-input bg-transparent px-2.5 text-sm"
        >
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.outletName} · {d.name} ({d.serialNumber})
            </option>
          ))}
        </select>
      </div>
      <Button onClick={handleConnect} disabled={isPending || !selectedId}>
        {isPending ? strings.pos.setupConnecting : strings.pos.setupConnectButton}
      </Button>
    </div>
  );
}
