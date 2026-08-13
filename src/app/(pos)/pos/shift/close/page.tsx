import { redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { devices, outlets } from "@/lib/db/schema";
import { getOpenShiftForDevice } from "@/lib/pos/shift";
import { CloseShiftForm } from "@/components/pos/shift/close-shift-form";
import { id as strings } from "@/lib/i18n/id";

export default async function CloseShiftPage() {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "shift.open_close"
  );

  try {
    // Resolusi outlet+device sama seperti open/page.tsx.
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

    const shift = await getOpenShiftForDevice(db, businessId, device.id);
    if (!shift) {
      redirect("/pos");
    }

    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-4">
        <div className="flex w-full max-w-sm flex-col gap-1">
          <h1 className="text-lg font-semibold">{strings.shift.closeTitle}</h1>
        </div>
        <CloseShiftForm
          shiftId={shift.id}
          employeeName={shift.employeeName}
          openedAt={shift.openedAt.toISOString()}
          openingCash={shift.openingCash}
          initialCountedCash={shift.countedCash}
          initialExpectedCash={shift.expectedCash}
          initialCashVariance={shift.cashVariance}
          tolerance={outlet.cashVarianceTolerance}
        />
      </div>
    );
  } finally {
    await closeDb();
  }
}
