import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { businesses } from "@/lib/db/schema";
import { PosScreen } from "@/components/pos/pos-screen";
import { ShiftCutoverBar } from "@/components/pos/shift/shift-cutover-bar";
import { getPosCatalog } from "./get-pos-catalog";
import { checkShiftSellability, getOpenShiftForDevice } from "@/lib/pos/shift";
import { getPairedDevice } from "@/lib/pos/device-pairing";
import { nextCutoffInstant } from "@/lib/utils/business-date";

export default async function PosPage() {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "pos.create_order"
  );

  let catalog;
  try {
    // T22e -- outlet+device tablet ini WAJIB sudah ter-pairing, bukan
    // ditebak. Belum ter-pairing -> /pos/setup, bukan error.
    const paired = await getPairedDevice(db, businessId);
    if (!paired) {
      redirect("/pos/setup");
    }

    // TT06 -- outlet thrifting (posMode='thrifting') dilayani layar kasir
    // yang SAMA SEKALI berbeda (barcode-first, bukan grid produk). Device
    // yang di-pairing ke outlet thrifting TIDAK PERNAH melihat halaman ini.
    if (paired.outlet.posMode === "thrifting") {
      redirect("/pos/thrift");
    }

    // Katalog di-fetch SEKALI di sini saat halaman dibuka -- interaksi di
    // klien (tap produk, filter kategori, cari, ganti tingkat harga) murni
    // di memori, tidak memicu query baru (kesepakatan T12).
    catalog = await getPosCatalog(db, businessId, supabase, paired.outlet, paired.device);

    // Gate T15: layar kasir tidak boleh dipakai kalau belum ada shift
    // terbuka untuk device ini -- tanpa shift tidak ada rekonsiliasi kas.
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
    if (shiftIssue === "opname_required") {
      // Rencana Revisi 24 September 2026 §7 poin 4 -- ada bahan berflag
      // (hitungTiapShift) TAPI opname stok awal shift ini belum submitted.
      // Kasir tidak boleh transaksi dulu.
      redirect("/pos/shift/opname-buka");
    }
    if (shiftIssue === "closing_in_progress") {
      // counted_cash sudah terkunci (sedang proses tutup) -- tidak boleh
      // jualan lagi sampai proses tutup itu selesai.
      redirect("/pos/shift/close");
    }
    if (shiftIssue === "stale") {
      // businessDate shift sudah bukan hari ini (§14 prasyarat shift, 13
      // September 2026) -- shift lama tertinggal terbuka, TIDAK boleh
      // menyerap transaksi baru. Arahkan ke layar buka shift yang sama,
      // halaman itu sendiri yang menampilkan pesan jelasnya.
      redirect("/pos/shift/open");
    }

    const cutoffInstant = nextCutoffInstant(
      new Date(),
      business?.timezone ?? "Asia/Jakarta",
      paired.outlet.dayCutoffTime
    );

    return (
      <>
        <ShiftCutoverBar
          shiftId={shift.id}
          cashEnabled={paired.outlet.cashEnabled}
          nextCutoffInstant={cutoffInstant.toISOString()}
          warningMinutes={paired.outlet.shiftWarningMinutes}
        />
        <PosScreen
          outlet={catalog.outlet}
          device={catalog.device}
          paymentMethods={catalog.paymentMethods}
          priceTiers={catalog.priceTiers}
          defaultPriceTierId={catalog.defaultPriceTierId}
          categories={catalog.categories}
          products={catalog.products}
          shift={{ id: shift.id, employeeName: shift.employeeName }}
        />
      </>
    );
  } finally {
    await closeDb();
  }
}
