import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { PosScreen } from "@/components/pos/pos-screen";
import { getPosCatalog } from "./get-pos-catalog";

export default async function PosPage() {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "pos.create_order"
  );

  let catalog;
  try {
    // Katalog di-fetch SEKALI di sini saat halaman dibuka -- interaksi di
    // klien (tap produk, filter kategori, cari, ganti tingkat harga) murni
    // di memori, tidak memicu query baru (kesepakatan T12).
    catalog = await getPosCatalog(db, businessId);
  } finally {
    await closeDb();
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
    />
  );
}
