import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { getOpenShiftForDevice, getShiftSalesSummary } from "@/lib/pos/shift";
import { getPairedDevice } from "@/lib/pos/device-pairing";
import { CloseShiftForm } from "@/components/pos/shift/close-shift-form";
import { CloseCashlessShiftForm } from "@/components/pos/shift/close-cashless-shift-form";
import { id as strings } from "@/lib/i18n/id";

export default async function CloseShiftPage() {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "shift.open_close"
  );

  try {
    // T22e -- lihat catatan di shift/open/page.tsx.
    const paired = await getPairedDevice(db, businessId);
    if (!paired) {
      redirect("/pos/setup");
    }
    const { outlet, device } = paired;

    const shift = await getOpenShiftForDevice(db, businessId, device.id);
    if (!shift) {
      redirect("/pos");
    }

    const deviceLabel = strings.pos.outletDeviceLabel
      .replace("{outlet}", outlet.name)
      .replace("{device}", device.name);

    if (!outlet.cashEnabled) {
      const summary = await getShiftSalesSummary(db, shift.id);
      return (
        <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-4">
          <div className="flex w-full max-w-sm flex-col gap-1">
            <h1 className="text-lg font-semibold">{strings.shift.closeTitle}</h1>
            <p className="text-xs text-muted-foreground">{deviceLabel}</p>
          </div>
          <CloseCashlessShiftForm
            shiftId={shift.id}
            employeeName={shift.employeeName}
            openedAt={shift.openedAt.toISOString()}
            summary={summary}
          />
        </div>
      );
    }

    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-4">
        <div className="flex w-full max-w-sm flex-col gap-1">
          <h1 className="text-lg font-semibold">{strings.shift.closeTitle}</h1>
          <p className="text-xs text-muted-foreground">{deviceLabel}</p>
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
