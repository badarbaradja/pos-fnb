import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { getOpenShiftForDevice, isShiftSellable } from "@/lib/pos/shift";
import { getPairedDevice } from "@/lib/pos/device-pairing";
import { OpenShiftForm } from "@/components/pos/shift/open-shift-form";
import { id as strings } from "@/lib/i18n/id";

export default async function OpenShiftPage() {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "shift.open_close"
  );

  try {
    // T22e -- outlet+device tablet ini WAJIB sudah ter-pairing, bukan
    // ditebak (dulu di sini ada duplikat resolusi "outlet aktif pertama"
    // yang sama dengan get-pos-catalog.ts -- sekarang satu sumber
    // kebenaran, lib/pos/device-pairing.ts).
    const paired = await getPairedDevice(db, businessId);
    if (!paired) {
      redirect("/pos/setup");
    }
    const { outlet, device } = paired;

    const existing = await getOpenShiftForDevice(db, businessId, device.id);
    if (existing) {
      redirect(isShiftSellable(existing) ? "/pos" : "/pos/shift/close");
    }

    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-4">
        <div className="flex w-full max-w-sm flex-col gap-1">
          <h1 className="text-lg font-semibold">{strings.shift.openTitle}</h1>
          <p className="text-xs text-muted-foreground">
            {strings.pos.outletDeviceLabel
              .replace("{outlet}", outlet.name)
              .replace("{device}", device.name)}
          </p>
          <p className="text-sm text-muted-foreground">{strings.shift.openHint}</p>
        </div>
        <OpenShiftForm outletId={outlet.id} deviceId={device.id} cashEnabled={outlet.cashEnabled} />
      </div>
    );
  } finally {
    await closeDb();
  }
}
