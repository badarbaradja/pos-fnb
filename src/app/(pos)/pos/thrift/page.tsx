import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { ThriftPosScreen } from "@/components/pos/thrift/thrift-pos-screen";
import { getThriftCatalog } from "./get-thrift-catalog";
import { checkShiftSellability, getOpenShiftForDevice } from "@/lib/pos/shift";
import { getPairedDevice } from "@/lib/pos/device-pairing";
import { businesses, categories, pemilik } from "@/lib/db/schema";

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

    const [business] = await db
      .select({ timezone: businesses.timezone })
      .from(businesses)
      .where(eq(businesses.id, businessId));
    const shiftIssue = checkShiftSellability(
      shift,
      business?.timezone ?? "Asia/Jakarta",
      paired.outlet.dayCutoffTime
    );
    if (shiftIssue === "closing_in_progress") {
      redirect("/pos/shift/close");
    }
    if (shiftIssue === "stale") {
      // Shift lama tertinggal terbuka (§14 prasyarat shift, 13 September
      // 2026) -- arahkan ke layar buka shift yang sama, halamannya sendiri
      // yang menampilkan pesan jelas kenapa.
      redirect("/pos/shift/open");
    }

    // "Ita super kasir" (11 September 2026) -- tombol tambah barang cuma
    // ditampilkan kalau shift ini dibuka EMPLOYEE manager/owner (PIN),
    // bukan akun tamu/cashier biasa. Kategori+pemilik thrifting diambil
    // di sini juga, HANYA kalau tombolnya akan ditampilkan -- percuma
    // dua query tambahan untuk shift kasir biasa yang tidak akan
    // memakainya sama sekali.
    const canAddBarang = shift.employeeRole === "manager" || shift.employeeRole === "owner";
    let categoryOptions: { id: string; name: string }[] = [];
    let pemilikOptions: { id: string; nama: string }[] = [];
    if (canAddBarang) {
      [categoryOptions, pemilikOptions] = await Promise.all([
        db
          .select({ id: categories.id, name: categories.name })
          .from(categories)
          .where(
            and(
              eq(categories.businessId, businessId),
              eq(categories.scope, "thrifting"),
              eq(categories.isActive, true)
            )
          ),
        db
          .select({ id: pemilik.id, nama: pemilik.nama })
          .from(pemilik)
          .where(and(eq(pemilik.businessId, businessId), eq(pemilik.isActive, true))),
      ]);
    }

    return (
      <ThriftPosScreen
        outlet={catalog.outlet}
        device={catalog.device}
        paymentMethods={catalog.paymentMethods}
        shift={{ id: shift.id, employeeName: shift.servedByName ?? shift.employeeName }}
        canAddBarang={canAddBarang}
        categories={categoryOptions}
        pemilikList={pemilikOptions}
      />
    );
  } finally {
    await closeDb();
  }
}
