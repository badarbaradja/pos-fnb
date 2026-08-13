import { redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { devices, outlets } from "@/lib/db/schema";
import { getOpenShiftForDevice, isShiftSellable } from "@/lib/pos/shift";
import { OpenShiftForm } from "@/components/pos/shift/open-shift-form";
import { id as strings } from "@/lib/i18n/id";

export default async function OpenShiftPage() {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "shift.open_close"
  );

  try {
    // Resolusi outlet+device sama seperti get-pos-catalog.ts (asumsi
    // single-outlet/single-device untuk MVP) -- halaman ini dibuka SEBELUM
    // ada shift, jadi tidak bisa pakai getPosCatalog (butuh shift aktif
    // secara implisit lewat alur normal /pos).
    const [outlet] = await db
      .select()
      .from(outlets)
      .where(and(eq(outlets.businessId, businessId), eq(outlets.isActive, true)))
      .orderBy(asc(outlets.createdAt));
    if (!outlet) {
      throw new Error("Belum ada outlet aktif untuk bisnis ini.");
    }
    const [device] = await db
      .select()
      .from(devices)
      .where(and(eq(devices.outletId, outlet.id), eq(devices.isActive, true)))
      .orderBy(asc(devices.serialNumber));
    if (!device) {
      throw new Error("Belum ada device aktif untuk outlet ini.");
    }

    const existing = await getOpenShiftForDevice(db, businessId, device.id);
    if (existing) {
      redirect(isShiftSellable(existing) ? "/pos" : "/pos/shift/close");
    }

    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-4">
        <div className="flex w-full max-w-sm flex-col gap-1">
          <h1 className="text-lg font-semibold">{strings.shift.openTitle}</h1>
          <p className="text-sm text-muted-foreground">{strings.shift.openHint}</p>
        </div>
        <OpenShiftForm outletId={outlet.id} deviceId={device.id} cashEnabled={outlet.cashEnabled} />
      </div>
    );
  } finally {
    await closeDb();
  }
}
