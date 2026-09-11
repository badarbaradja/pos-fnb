import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { getPairedDevice } from "@/lib/pos/device-pairing";
import { getOpenShiftForDevice, isShiftSellable } from "@/lib/pos/shift";
import { getSalesSummary, getSalesByProduct } from "@/lib/db/queries/sales-report";
import {
  getStokStatusSummary,
  getBarangMenumpuk,
  getBarangMenumpukDays,
  getBagiHasilBulanIni,
} from "@/lib/pos/thrift-statistik";
import { businesses } from "@/lib/db/schema";
import { businessDate } from "@/lib/utils/business-date";
import { StatistikView } from "@/components/pos/thrift/statistik-view";

/**
 * app/(pos)/pos/thrift/statistik/page.tsx — "Halaman Statistik Ita" (11
 * September 2026, disetujui CEO). Gerbang SAMA PERSIS dengan "Tambah
 * Barang" di /pos/thrift (role EMPLOYEE pemilik shift, PIN -- bukan sesi
 * dashboard device) -- Ita tidak punya login dashboard pribadi, jadi
 * dashboard owner yang difilter TIDAK AKAN PERNAH dia lihat. Diakses
 * LANGSUNG dari kasir, ditegakkan ulang di sini juga (bukan cuma
 * disembunyikan tombolnya) -- pertahanan berlapis, sama prinsip semua
 * gerbang RBAC lain di proyek ini.
 */
export default async function ThriftStatistikPage() {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "pos.create_order");

  try {
    const paired = await getPairedDevice(db, businessId);
    if (!paired) {
      redirect("/pos/setup");
    }
    if (paired.outlet.posMode === "fnb") {
      redirect("/pos");
    }

    const shift = await getOpenShiftForDevice(db, businessId, paired.device.id);
    if (!shift) {
      redirect("/pos/shift/open");
    }
    if (!isShiftSellable(shift)) {
      redirect("/pos/shift/close");
    }
    if (shift.employeeRole !== "manager" && shift.employeeRole !== "owner") {
      // Akun tamu/cashier biasa -- tombol ini tidak pernah muncul untuk
      // mereka di /pos/thrift, dan mengetik URL-nya langsung juga
      // ditolak di sini, bukan cuma disembunyikan di UI.
      redirect("/pos/thrift");
    }

    const [business] = await db
      .select({ timezone: businesses.timezone })
      .from(businesses)
      .where(eq(businesses.id, businessId));
    const timezone = business?.timezone ?? "Asia/Jakarta";

    const today = businessDate(new Date(), timezone, paired.outlet.dayCutoffTime);
    const startOfMonth = `${today.slice(0, 7)}-01`;

    const outletId = paired.outlet.id;
    const todayFilter = { businessId, outletId, startDate: today, endDate: today };
    const monthFilter = { businessId, outletId, startDate: startOfMonth, endDate: today };

    const menumpukDays = await getBarangMenumpukDays(db, businessId, outletId);

    const [
      todaySummary,
      monthSummary,
      topItems,
      stokStatus,
      barangMenumpuk,
      bagiHasil,
    ] = await Promise.all([
      getSalesSummary(db, todayFilter),
      getSalesSummary(db, monthFilter),
      getSalesByProduct(db, monthFilter),
      getStokStatusSummary(db, businessId, outletId),
      getBarangMenumpuk(db, businessId, outletId, menumpukDays),
      getBagiHasilBulanIni(db, businessId, outletId, startOfMonth, today),
    ]);

    return (
      <StatistikView
        outletName={paired.outlet.name}
        shiftId={shift.id}
        todaySummary={todaySummary}
        monthSummary={monthSummary}
        topItems={topItems.slice(0, 5)}
        stokStatus={stokStatus}
        barangMenumpuk={barangMenumpuk}
        menumpukDays={menumpukDays}
        bagiHasil={bagiHasil}
      />
    );
  } finally {
    await closeDb();
  }
}
