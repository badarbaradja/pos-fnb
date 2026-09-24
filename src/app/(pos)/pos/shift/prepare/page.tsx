import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { getOpenShiftForDevice } from "@/lib/pos/shift";
import { getPairedDevice } from "@/lib/pos/device-pairing";
import { PrepareReportForm } from "@/components/pos/shift/prepare-report-form";

/**
 * Rencana Revisi 24 September 2026 -- gerbang laporan Prepare, dicapai
 * lewat redirect dari /pos atau /pos/shift/open ketika
 * checkShiftSellability() (lib/pos/shift.ts) mengembalikan
 * 'prepare_required'. Unconditional untuk SEMUA shift (tidak bergantung
 * bahan berflag seperti opname) -- kalau diakses langsung padahal
 * laporan sudah lengkap (mis. reload tab lama setelah submit dari tab
 * lain), lempar balik ke /pos.
 */
export default async function PrepareReportPage() {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "shift.open_close");

  try {
    const paired = await getPairedDevice(db, businessId);
    if (!paired) {
      redirect("/pos/setup");
    }
    const { device } = paired;

    const shift = await getOpenShiftForDevice(db, businessId, device.id);
    if (!shift) {
      redirect("/pos/shift/open");
    }
    if (shift.openingOpnameStatus === "pending") {
      redirect("/pos/shift/opname-buka");
    }
    if (shift.prepareCompleted) {
      redirect("/pos");
    }

    return (
      <div className="flex min-h-dvh flex-col items-center gap-4 p-4">
        <PrepareReportForm shiftId={shift.id} />
      </div>
    );
  } finally {
    await closeDb();
  }
}
