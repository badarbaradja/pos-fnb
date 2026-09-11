import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { PosScreen } from "@/components/pos/pos-screen";
import { getPosCatalog } from "./get-pos-catalog";
import { getOpenShiftForDevice, isShiftSellable } from "@/lib/pos/shift";
import { getPairedDevice } from "@/lib/pos/device-pairing";

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
    if (!isShiftSellable(shift)) {
      // counted_cash sudah terkunci (sedang proses tutup) -- tidak boleh
      // jualan lagi sampai proses tutup itu selesai.
      redirect("/pos/shift/close");
    }

    return (
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
    );
  } finally {
    await closeDb();
  }
}
