import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { outlets } from "@/lib/db/schema";
import { getOpenShiftForDevice } from "@/lib/pos/shift";
import { getPairedDevice } from "@/lib/pos/device-pairing";
import {
  getOrCreateShiftOpnameWithDb,
  getShiftOpnameItemsForSession,
} from "@/lib/stock-opnames/shift-opname";
import { ShiftOpnameForm } from "@/components/pos/shift/shift-opname-form";

/**
 * Rencana Revisi 24 September 2026 §7 poin 4 -- gerbang opname stok awal.
 * Hanya dicapai lewat redirect dari /pos atau /pos/shift/open ketika
 * checkShiftSellability() (lib/pos/shift.ts) mengembalikan
 * 'opname_required' -- shift sudah terbuka TAPI ada bahan berflag yang
 * belum dihitung. Kalau diakses langsung padahal status bukan 'pending'
 * (mis. sudah disubmit dari tab lain, atau nol bahan berflag), lempar
 * balik ke /pos -- halaman ini TIDAK PERNAH jadi jalan buntu sendiri.
 */
export default async function OpnameBukaPage() {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "shift.open_close");

  try {
    const paired = await getPairedDevice(db, businessId);
    if (!paired) {
      redirect("/pos/setup");
    }
    const { outlet, device } = paired;

    const shift = await getOpenShiftForDevice(db, businessId, device.id);
    if (!shift) {
      redirect("/pos/shift/open");
    }
    if (shift.openingOpnameStatus !== "pending") {
      redirect("/pos");
    }

    const opname = await getOrCreateShiftOpnameWithDb(db, {
      businessId,
      outletId: outlet.id,
      shiftId: shift.id,
      jenis: "buka",
      businessDate: shift.businessDate,
    });
    const { items, isFirstShiftAtOutlet } = await getShiftOpnameItemsForSession(db, {
      businessId,
      outletId: outlet.id,
      opnameId: opname.id,
      jenis: "buka",
      shiftId: shift.id,
    });

    // Jaga-jaga: kalau di antara gate checkShiftSellability dan render ini
    // semua bahan berflag sempat di-unflag, tidak ada apa pun untuk
    // dihitung -- jangan mengunci kasir di sini.
    if (items.length === 0) {
      redirect("/pos");
    }

    const [outletThreshold] = await db
      .select({
        varianceAlertValue: outlets.varianceAlertValue,
        varianceAlertPercent: outlets.varianceAlertPercent,
      })
      .from(outlets)
      .where(eq(outlets.id, outlet.id));

    return (
      <div className="flex min-h-dvh flex-col items-center gap-4 p-4">
        <ShiftOpnameForm
          jenis="buka"
          opnameId={opname.id}
          outletId={outlet.id}
          businessDate={shift.businessDate}
          items={items}
          isFirstShiftAtOutlet={isFirstShiftAtOutlet}
          varianceAlertValue={outletThreshold?.varianceAlertValue ?? "0"}
          varianceAlertPercent={outletThreshold?.varianceAlertPercent ?? "0"}
        />
      </div>
    );
  } finally {
    await closeDb();
  }
}
