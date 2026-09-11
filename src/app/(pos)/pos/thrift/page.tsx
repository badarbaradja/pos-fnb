import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { ThriftPosScreen } from "@/components/pos/thrift/thrift-pos-screen";
import { getThriftCatalog } from "./get-thrift-catalog";
import { getOpenShiftForDevice, isShiftSellable } from "@/lib/pos/shift";
import { getPairedDevice } from "@/lib/pos/device-pairing";

/**
 * app/(pos)/pos/thrift/page.tsx — TT06. Padanan app/(pos)/pos/page.tsx
 * untuk outlet thrifting (outlets.posMode='thrifting') -- gating shift dan
 * device-pairing SAMA PERSIS (reuse T15/T22e apa adanya), cuma katalog dan
 * layar kasirnya berbeda total (barcode-first, bukan grid produk).
 */
export default async function ThriftPosPage() {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "pos.create_order"
  );

  try {
    const paired = await getPairedDevice(db, businessId);
    if (!paired) {
      redirect("/pos/setup");
    }

    // Simetris dengan guard di pos/page.tsx -- device yang di-pairing ke
    // outlet F&B tidak boleh sampai ke layar ini (mis. URL diketik manual).
    if (paired.outlet.posMode === "fnb") {
      redirect("/pos");
    }

    const catalog = await getThriftCatalog(db, businessId, paired.outlet, paired.device);

    const shift = await getOpenShiftForDevice(db, businessId, catalog.device.id);
    if (!shift) {
      redirect("/pos/shift/open");
    }
    if (!isShiftSellable(shift)) {
      redirect("/pos/shift/close");
    }

    return (
      <ThriftPosScreen
        outlet={catalog.outlet}
        device={catalog.device}
        paymentMethods={catalog.paymentMethods}
        shift={{ id: shift.id, employeeName: shift.servedByName ?? shift.employeeName }}
      />
    );
  } finally {
    await closeDb();
  }
}
