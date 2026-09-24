import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { outlets } from "@/lib/db/schema";
import { getOpenShiftForDevice, getShiftSalesSummary } from "@/lib/pos/shift";
import { getPairedDevice } from "@/lib/pos/device-pairing";
import {
  getFlaggedIngredientIds,
  getOrCreateShiftOpnameWithDb,
  getShiftOpnameItemsForSession,
  type ShiftOpnameItemRow,
} from "@/lib/stock-opnames/shift-opname";
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

    // Rencana Revisi 24 September 2026 §7 poin 4 -- opname stok akhir
    // DIGABUNG ke layar tutup shift yang sudah ada (bukan langkah
    // terpisah). "Kalau NOL bahan berflag, lewati sepenuhnya" -- cek
    // getFlaggedIngredientIds DULU, jangan panggil getOrCreateShiftOpname-
    // WithDb kalau kosong, supaya tidak ada baris stock_opnames dibuat
    // untuk bisnis yang belum menandai bahan apa pun.
    let closingOpname: {
      opnameId: string;
      items: ShiftOpnameItemRow[];
      isFirstShiftAtOutlet: boolean;
      varianceAlertValue: string;
      varianceAlertPercent: string;
    } | null = null;
    const flaggedIds = await getFlaggedIngredientIds(db, businessId, outlet.id);
    if (flaggedIds.length > 0) {
      const opname = await getOrCreateShiftOpnameWithDb(db, {
        businessId,
        outletId: outlet.id,
        shiftId: shift.id,
        jenis: "tutup",
        businessDate: shift.businessDate,
      });
      const { items, isFirstShiftAtOutlet } = await getShiftOpnameItemsForSession(db, {
        businessId,
        outletId: outlet.id,
        opnameId: opname.id,
        jenis: "tutup",
        shiftId: shift.id,
      });
      const [outletThreshold] = await db
        .select({
          varianceAlertValue: outlets.varianceAlertValue,
          varianceAlertPercent: outlets.varianceAlertPercent,
        })
        .from(outlets)
        .where(eq(outlets.id, outlet.id));
      closingOpname = {
        opnameId: opname.id,
        items,
        isFirstShiftAtOutlet,
        varianceAlertValue: outletThreshold?.varianceAlertValue ?? "0",
        varianceAlertPercent: outletThreshold?.varianceAlertPercent ?? "0",
      };
    }

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
            closingOpname={closingOpname}
            outletId={outlet.id}
            businessDate={shift.businessDate}
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
          closingOpname={closingOpname}
          outletId={outlet.id}
          businessDate={shift.businessDate}
        />
      </div>
    );
  } finally {
    await closeDb();
  }
}
