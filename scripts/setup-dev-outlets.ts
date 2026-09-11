import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { and, eq, ne } from "drizzle-orm";
import { getAdminDb } from "../src/lib/db/client";
import { businesses, brands, outlets, devices } from "../src/lib/db/schema";

/**
 * scripts/setup-dev-outlets.ts — instruksi CEO 11 September 2026: database
 * dev sebelumnya cuma berisi outlet demo generik ("Outlet Indosteak
 * Cempaka" tanpa "Putih", dst) yang TIDAK mewakili nama outlet produksi
 * sungguhan -- pengujian jadi tidak representatif, dan bug yang cuma
 * muncul karena nama outlet bisa lolos sampai produksi.
 *
 * Skrip ini HANYA mendaftarkan NAMA dan STRUKTUR outlet produksi ke dev
 * (business, brand, outlet, satu device dipindah supaya tetap bisa
 * dipakai) -- SENGAJA TIDAK membawa transaksi, karyawan sungguhan, atau
 * harga produk produksi apa pun (instruksi eksplisit CEO). Nilai
 * pajak/service charge/dst di outlet baru memakai DEFAULT skema, BUKAN
 * disalin dari angka produksi -- skrip ini tidak pernah membaca data
 * finansial produksi sama sekali, cuma nama dan pengelompokan brand.
 *
 * Business diberi awalan "[DEV] " (kalau belum) supaya kelihatan jelas
 * di tab browser mana dev mana bukan.
 *
 * Idempoten: aman dijalankan ulang, upsert by name.
 */

const PRODUCTION_OUTLETS: { name: string; code: string; brandName: string }[] = [
  { name: "Indosteak Cempaka Putih", code: "ISCP", brandName: "Indosteak" },
  { name: "Indosteak Pekansari", code: "ISPK", brandName: "Indosteak" },
  { name: "Indokopi Jatinegara", code: "IKJT", brandName: "Indokopi" },
  { name: "Indokopi Lite Kemayoran", code: "IKLK", brandName: "Indokopi" },
];

// Data demo generik LAMA (bukan cermin produksi) -- dinonaktifkan, BUKAN
// dihapus (device/shift/order lama mungkin masih merujuk ke sini; ikut
// prinsip master data CLAUDE.md 3.2, nonaktifkan bukan hapus).
const OLD_DEMO_OUTLET_CODES = ["DEMO1", "DEMO2", "DEMO3", "DEMO"];

async function main() {
  const db = getAdminDb();

  const [business] = await db.select().from(businesses);
  if (!business) throw new Error("Tidak ada business di database dev");
  const businessId = business.id;

  if (!business.name.startsWith("[DEV]")) {
    await db
      .update(businesses)
      .set({ name: `[DEV] ${business.name}` })
      .where(eq(businesses.id, businessId));
    console.log(`[business] diberi penanda: [DEV] ${business.name}`);
  } else {
    console.log(`[business] sudah bertanda: ${business.name}`);
  }

  for (const spec of PRODUCTION_OUTLETS) {
    let [brand] = await db
      .select()
      .from(brands)
      .where(and(eq(brands.businessId, businessId), eq(brands.name, spec.brandName)));
    if (!brand) {
      const [inserted] = await db
        .insert(brands)
        .values({ businessId, name: spec.brandName })
        .returning();
      brand = inserted;
      console.log(`[brands] dibuat: ${spec.brandName}`);
    }

    const [existingOutlet] = await db
      .select()
      .from(outlets)
      .where(and(eq(outlets.businessId, businessId), eq(outlets.name, spec.name)));
    if (existingOutlet) {
      console.log(`[outlets] sudah ada: ${spec.name} (${existingOutlet.code})`);
      continue;
    }
    const [created] = await db
      .insert(outlets)
      .values({
        businessId,
        brandId: brand!.id,
        code: spec.code,
        name: spec.name,
        posMode: "fnb",
      })
      .returning();
    console.log(`[outlets] dibuat: ${spec.name} (${created!.code}) -- brand ${spec.brandName}, posMode fnb`);
  }

  // Pindahkan device "Kasir 1" (satu-satunya device F&B yang ada) ke
  // outlet "Indosteak Pekansari" yang baru -- supaya tetap ada SATU jalur
  // kasir F&B yang bisa dipakai end-to-end, bukan cuma outlet kosong
  // tanpa device.
  const [pekansari] = await db
    .select()
    .from(outlets)
    .where(and(eq(outlets.businessId, businessId), eq(outlets.name, "Indosteak Pekansari")));
  if (pekansari) {
    const moved = await db
      .update(devices)
      .set({ outletId: pekansari.id })
      .where(
        and(
          eq(devices.businessId, businessId),
          eq(devices.serialNumber, "KASIR1"),
          ne(devices.outletId, pekansari.id)
        )
      )
      .returning({ id: devices.id });
    if (moved.length > 0) {
      console.log(`[devices] "Kasir 1" dipindah ke outlet Indosteak Pekansari`);
    } else {
      console.log(`[devices] "Kasir 1" sudah di outlet Indosteak Pekansari`);
    }
  }

  for (const code of OLD_DEMO_OUTLET_CODES) {
    const updated = await db
      .update(outlets)
      .set({ isActive: false })
      .where(and(eq(outlets.businessId, businessId), eq(outlets.code, code), eq(outlets.isActive, true)))
      .returning({ name: outlets.name });
    if (updated.length > 0) {
      console.log(`[outlets] dinonaktifkan (data demo generik lama): ${updated[0]!.name} (${code})`);
    }
  }

  console.log("\n=== Outlet aktif sekarang ===");
  const active = await db
    .select({ name: outlets.name, code: outlets.code, posMode: outlets.posMode })
    .from(outlets)
    .where(and(eq(outlets.businessId, businessId), eq(outlets.isActive, true)));
  for (const row of active) {
    console.log(`  ${row.name} (${row.code}, ${row.posMode})`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
