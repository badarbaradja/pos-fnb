import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { eq, like } from "drizzle-orm";
import { getAdminDb } from "../../src/lib/db/client";
import { businesses, products, categories, priceTiers, ingredients, units } from "../../src/lib/db/schema";

async function main() {
  const db = getAdminDb();
  const allBusinesses = await db.select({ id: businesses.id, name: businesses.name }).from(businesses);
  console.log("=== Semua business di dev DB ===");
  for (const b of allBusinesses) console.log(` ${b.name} (${b.id})`);

  const [business] = await db.select().from(businesses).where(like(businesses.name, "%Demo Cafe%"));
  if (!business) throw new Error("Business '[DEV] Demo Cafe' tidak ditemukan");
  const businessId = business.id;

  console.log("=== Business ===", business.name, businessId);

  console.log("\n=== Price tiers ===");
  const tiers = await db.select().from(priceTiers).where(eq(priceTiers.businessId, businessId));
  for (const t of tiers) console.log(` ${t.code} (${t.name}) isDefault=${t.isDefault} isActive=${t.isActive} id=${t.id}`);

  console.log("\n=== Categories (fnb scope) ===");
  const cats = await db.select().from(categories).where(eq(categories.businessId, businessId));
  for (const c of cats) console.log(` ${c.name} scope=${c.scope} isActive=${c.isActive} id=${c.id}`);

  console.log("\n=== Existing products (all) ===");
  const prods = await db.select({ id: products.id, name: products.name, isActive: products.isActive, categoryId: products.categoryId }).from(products).where(eq(products.businessId, businessId));
  console.log(`  total: ${prods.length}`);
  for (const p of prods) console.log(`  [${p.isActive ? "aktif" : "nonaktif"}] ${p.name}`);

  console.log("\n=== Existing units ===");
  const us = await db.select().from(units).where(eq(units.businessId, businessId));
  for (const u of us) console.log(` code=${u.code} name=${u.name} baseUnit=${u.baseUnit} factor=${u.factor}`);

  console.log("\n=== Existing ingredients ===");
  const ings = await db.select().from(ingredients).where(eq(ingredients.businessId, businessId));
  console.log(`  total: ${ings.length}`);
  for (const i of ings.slice(0, 10)) console.log(` ${i.name} baseUnit=${i.baseUnit} purchaseUnit=${i.purchaseUnit} purchaseFactor=${i.purchaseFactor}`);
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
