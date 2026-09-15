import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { and, eq, like } from "drizzle-orm";
import { getAdminDb } from "../../src/lib/db/client";
import { businesses, outlets, products, productOutlets } from "../../src/lib/db/schema";

async function main() {
  const db = getAdminDb();
  const [business] = await db.select().from(businesses).where(like(businesses.name, "%Demo Cafe%"));
  if (!business) throw new Error("business not found");

  const outletRows = await db
    .select({ id: outlets.id, code: outlets.code, name: outlets.name })
    .from(outlets)
    .where(and(eq(outlets.businessId, business.id), eq(outlets.isActive, true)));

  const allProducts = await db
    .select({ id: products.id, name: products.name })
    .from(products)
    .where(and(eq(products.businessId, business.id), eq(products.isActive, true)));
  const totalActive = allProducts.length;

  const restrictionRows = await db.select().from(productOutlets);
  const restrictedIds = new Set(restrictionRows.map((r) => r.productId));

  for (const outlet of outletRows) {
    const allowedForThis = new Set(
      restrictionRows.filter((r) => r.outletId === outlet.id).map((r) => r.productId)
    );
    const visible = allProducts.filter((p) => !restrictedIds.has(p.id) || allowedForThis.has(p.id));
    console.log(`${outlet.name} (${outlet.code}): ${visible.length} produk terlihat dari total ${totalActive} aktif`);
  }

  // Contoh silang: pastikan produk Indokopi TIDAK muncul di outlet Indosteak
  const indokopiOnly = allProducts.find((p) => p.name === "Americano" || p.name.includes("Kopi Aren Tua"));
  console.log("\nContoh cek nama (Kopi Aren Tua muncul >1x karena beda outlet, ini yang diharapkan):");
  const kopiArenRows = allProducts.filter((p) => p.name.includes("Kopi Aren Tua"));
  console.log(`  jumlah baris "Kopi Aren Tua" (semua resto): ${kopiArenRows.length}`);
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
