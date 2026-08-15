import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";

const PROD_ENV_PATH = resolve(process.cwd(), ".env.production.local");
if (!existsSync(PROD_ENV_PATH)) {
  throw new Error(
    "seed-indokopi-catalog.ts: .env.production.local tidak ditemukan di root project.\n" +
      "Script ini WAJIB jalan dengan kredensial produksi eksplisit -- tidak ada fallback ke database dev."
  );
}
loadEnv({ path: PROD_ENV_PATH, quiet: true });

import { and, eq } from "drizzle-orm";
import { getAdminDb } from "../src/lib/db/client";
import {
  businesses,
  categories,
  priceTiers,
  modifierGroups,
  modifiers,
  products,
  productPrices,
  productModifierGroups,
} from "../src/lib/db/schema";
import { generateId } from "../src/lib/utils/id";
import { assertValidDatabaseUrl } from "../src/lib/db/validate-database-url";

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  throw new Error(
    "seed-indokopi-catalog.ts: DATABASE_URL kosong di .env.production.local."
  );
}
try {
  assertValidDatabaseUrl(databaseUrl);
} catch (err) {
  throw new Error(`seed-indokopi-catalog.ts: ${(err as Error).message}`);
}

/**
 * scripts/seed-indokopi-catalog.ts -- katalog nyata Indokopi (bukan data
 * demo), ditranskrip dari poster menu fisik. Ditujukan ke database produksi
 * (dibuat via `npm run bootstrap:production` lebih dulu -- business
 * "Indokopi" harus sudah ada). Idempoten -- aman dijalankan ulang.
 *
 * Keputusan yang dikonfirmasi manual sebelum data ini ditulis (bukan
 * tebakan): "Nasi Bento Chicken Roll" = Rp 30.000 (tidak ada di poster,
 * dikonfirmasi user). Item "Badak" (Rp 26K, di panel Topping Extra) SENGAJA
 * DILEWATI -- namanya tidak jelas di poster dan user memilih untuk
 * menambahkannya manual nanti lewat dashboard setelah dikonfirmasi ulang.
 * Topping (Keju/Telur/Sosis/Mozarella/Saus) jadi modifier group, bukan
 * produk berdiri sendiri. Aqua Botol/Susu Oat Milk/Cream Cheese jadi produk
 * retail berdiri sendiri (kategori "Lainnya") karena itu barang yang dijual
 * langsung, bukan tambahan ke pesanan lain. Satu price tier flat "Reguler"
 * -- poster tidak punya beda harga per channel seperti data demo.
 *
 * Pakai getAdminDb() -- operasi sistem (seed), bukan atas nama satu user
 * lewat request, diizinkan CLAUDE.md §3.4.
 */

type Db = ReturnType<typeof getAdminDb>;

const INDOKOPI_BUSINESS_NAME = "Indokopi";

async function getIndokopiBusinessId(db: Db): Promise<string> {
  const [business] = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(eq(businesses.name, INDOKOPI_BUSINESS_NAME));
  if (!business) {
    throw new Error(
      `Business "${INDOKOPI_BUSINESS_NAME}" belum ada. Jalankan dulu: npm run bootstrap:production`
    );
  }
  return business.id;
}

const CATEGORY_DATA = [
  { name: "Kopi Reguler", color: "#78350f", sortOrder: 0 },
  { name: "Signature Berry", color: "#db2777", sortOrder: 1 },
  { name: "Aeropress Series", color: "#0f172a", sortOrder: 2 },
  { name: "Non Kopi", color: "#65a30d", sortOrder: 3 },
  { name: "Mocktail", color: "#0ea5e9", sortOrder: 4 },
  { name: "Tea Series", color: "#0d9488", sortOrder: 5 },
  { name: "Makanan", color: "#dc2626", sortOrder: 6 },
  { name: "Snack", color: "#d97706", sortOrder: 7 },
  { name: "Sweet", color: "#c026d3", sortOrder: 8 },
  { name: "Lainnya", color: "#64748b", sortOrder: 9 },
] as const;

// Poster cuma satu daftar harga flat -- tidak ada beda dine-in/takeaway/
// GoFood seperti data demo, jadi cuma satu tier, markup 0%.
const PRICE_TIER_DATA = [
  { code: "REGULER", name: "Reguler", channel: "dine_in", markupPercent: "0", isDefault: true },
] as const;

const MODIFIER_GROUP_DATA = [
  {
    name: "Cold Foam",
    minSelect: 0,
    maxSelect: 1,
    isRequired: false,
    modifiers: [{ name: "Cold Foam Vanilla", price: "3000" }],
  },
  {
    name: "Topping Extra",
    minSelect: 0,
    maxSelect: 7,
    isRequired: false,
    modifiers: [
      { name: "Keju", price: "5000" },
      { name: "Telur", price: "8000" },
      { name: "Sosis", price: "8000" },
      { name: "Mozarella", price: "10000" },
      { name: "Saus BBQ", price: "8000" },
      { name: "Saus Lada Hitam", price: "8000" },
      { name: "Saus Keju", price: "8000" },
    ],
  },
] as const;

const PRODUCT_DATA: {
  category: (typeof CATEGORY_DATA)[number]["name"];
  modifierGroups: (typeof MODIFIER_GROUP_DATA)[number]["name"][];
  productType?: "simple";
  items: { name: string; basePrice: number }[];
}[] = [
  {
    category: "Kopi Reguler",
    modifierGroups: [],
    items: [
      { name: "Americano", basePrice: 18000 },
      { name: "Cafe Latte", basePrice: 23000 },
      { name: "Kopi Aren Tua", basePrice: 24000 },
      { name: "Jasmine Honey Latte", basePrice: 25000 },
      { name: "Kopi Rempah Pagi", basePrice: 25000 },
      { name: "Kopi Kelapa Asap", basePrice: 25000 },
      { name: "Butterscotch Coffee", basePrice: 28000 },
      { name: "Salted Caramel Latte", basePrice: 28000 },
      { name: "Lemonade Espresso", basePrice: 27000 },
      { name: "Pistachio Cream Coffee", basePrice: 28000 },
      { name: "Avocado Coffee", basePrice: 28000 },
      { name: "Kopi Klepon", basePrice: 28000 },
      { name: "Kopi Coklat Crunchy", basePrice: 28000 },
    ],
  },
  {
    category: "Signature Berry",
    modifierGroups: ["Cold Foam"],
    items: [
      { name: "Berry Cloud Latte", basePrice: 32000 },
      { name: "Berry Kopi Aren", basePrice: 28000 },
      { name: "Berry Lemonade Espresso", basePrice: 30000 },
      { name: "Berry Sea Salt", basePrice: 33000 },
      { name: "Berry Coconut Cream", basePrice: 34000 },
      { name: "Berry Mocha", basePrice: 35000 },
      { name: "Berry Pistachio", basePrice: 34000 },
      { name: "Berry Butterscotch", basePrice: 36000 },
      { name: "Berry Americano Tonic", basePrice: 32000 },
      { name: "Berry Americano", basePrice: 25000 },
      { name: "Hot Berry Latte", basePrice: 27000 },
    ],
  },
  {
    category: "Aeropress Series",
    modifierGroups: [],
    items: [
      { name: "Kopi Santai Pantai", basePrice: 25000 },
      { name: "Kopi Hijau Tenang", basePrice: 25000 },
      { name: "Kopi Fresh Healing", basePrice: 23000 },
    ],
  },
  {
    category: "Non Kopi",
    modifierGroups: [],
    items: [
      { name: "Milk Thai Tea", basePrice: 25000 },
      { name: "Matcha Latte Ceremonial", basePrice: 30000 },
      { name: "Matcha Gula Aren", basePrice: 30000 },
      { name: "Matcha Strawberry", basePrice: 32000 },
      { name: "Matcha Blueberry", basePrice: 32000 },
    ],
  },
  {
    category: "Mocktail",
    modifierGroups: [],
    items: [
      { name: "Sunset Bestie", basePrice: 25000 },
      { name: "Blue Ocean", basePrice: 25000 },
      { name: "Strawberry Sparkling", basePrice: 25000 },
    ],
  },
  {
    category: "Tea Series",
    modifierGroups: [],
    items: [
      { name: "Es Teh", basePrice: 8000 },
      { name: "Thai Green Tea", basePrice: 15000 },
      { name: "Es Lemon Tea", basePrice: 23000 },
      { name: "Es Lychee Tea", basePrice: 25000 },
      { name: "Milk Green Thai Tea", basePrice: 28000 },
    ],
  },
  {
    category: "Makanan",
    modifierGroups: ["Topping Extra"],
    items: [
      { name: "Indomie Rebus Telur", basePrice: 18000 },
      { name: "Indomie Goreng Telur", basePrice: 18000 },
      { name: "Mie Tek Tek Sambel Kopi", basePrice: 24000 },
      { name: "Ramen Chicken", basePrice: 38000 },
      { name: "Pad Thai Goreng Bestie", basePrice: 25000 },
      { name: "Nasi Goreng Sambel Kopi", basePrice: 25000 },
      { name: "Nasi Ceplok Kecap", basePrice: 13000 },
    ],
  },
  {
    category: "Snack",
    modifierGroups: ["Topping Extra"],
    items: [
      { name: "Gyoza 5 Pcs", basePrice: 25000 },
      { name: "Dimsum Rempah 3 Pcs", basePrice: 25000 },
      { name: "Kentang Goreng", basePrice: 17000 },
      { name: "Mix Platter", basePrice: 38000 },
    ],
  },
  {
    category: "Sweet",
    modifierGroups: [],
    items: [
      { name: "Pisang Bakar Keju", basePrice: 18000 },
      { name: "Pisang Bakar Cokelat", basePrice: 18000 },
      { name: "Roti Bakar Keju", basePrice: 18000 },
      { name: "Roti Bakar Coklat", basePrice: 18000 },
      { name: "Singkong Goreng", basePrice: 18000 },
      { name: "Donat 2 Pcs", basePrice: 18000 },
      { name: "Telur 1/2 Matang 2 Butir", basePrice: 23000 },
      { name: "Coklat Bestie (2 pcs)", basePrice: 15000 },
      { name: "Nasi Bento Chicken Roll", basePrice: 30000 }, // dikonfirmasi manual, tidak ada di poster
    ],
  },
  {
    category: "Lainnya",
    modifierGroups: [],
    productType: "simple", // dijual utuh, bukan resep -- sesuai contoh di schema.ts (botol Aqua)
    items: [
      { name: "Aqua Botol", basePrice: 10000 },
      { name: "Susu Oat Milk", basePrice: 6000 },
      { name: "Cream Cheese", basePrice: 5000 },
    ],
  },
];

async function upsertCategory(
  db: Db,
  businessId: string,
  data: { name: string; color: string; sortOrder: number }
): Promise<string> {
  const [existing] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.businessId, businessId), eq(categories.name, data.name)));
  if (existing) {
    return existing.id;
  }
  const id = generateId();
  await db.insert(categories).values({ id, businessId, ...data });
  return id;
}

async function upsertPriceTier(
  db: Db,
  businessId: string,
  data: {
    code: string;
    name: string;
    channel: string | null;
    markupPercent: string;
    isDefault: boolean;
  }
): Promise<{ id: string; markupPercent: string | null }> {
  const [row] = await db
    .insert(priceTiers)
    .values({ id: generateId(), businessId, ...data })
    .onConflictDoUpdate({
      target: [priceTiers.businessId, priceTiers.code],
      set: {
        name: data.name,
        channel: data.channel,
        markupPercent: data.markupPercent,
        isDefault: data.isDefault,
      },
    })
    .returning({ id: priceTiers.id, markupPercent: priceTiers.markupPercent });
  if (!row) {
    throw new Error(`Gagal upsert price tier ${data.code}`);
  }
  return row;
}

async function upsertModifierGroup(
  db: Db,
  businessId: string,
  data: { name: string; minSelect: number; maxSelect: number; isRequired: boolean }
): Promise<string> {
  const [existing] = await db
    .select({ id: modifierGroups.id })
    .from(modifierGroups)
    .where(
      and(eq(modifierGroups.businessId, businessId), eq(modifierGroups.name, data.name))
    );
  if (existing) {
    return existing.id;
  }
  const id = generateId();
  await db.insert(modifierGroups).values({ id, businessId, ...data });
  return id;
}

async function upsertModifier(
  db: Db,
  modifierGroupId: string,
  data: { name: string; price: string; sortOrder: number }
): Promise<void> {
  const [existing] = await db
    .select({ id: modifiers.id })
    .from(modifiers)
    .where(
      and(eq(modifiers.modifierGroupId, modifierGroupId), eq(modifiers.name, data.name))
    );
  if (existing) {
    return;
  }
  await db.insert(modifiers).values({ id: generateId(), modifierGroupId, ...data });
}

async function upsertProduct(
  db: Db,
  businessId: string,
  categoryId: string,
  data: { name: string; sortOrder: number; productType?: "simple" }
): Promise<string> {
  const [existing] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.businessId, businessId), eq(products.name, data.name)));
  if (existing) {
    return existing.id;
  }
  const id = generateId();
  await db.insert(products).values({
    id,
    businessId,
    categoryId,
    name: data.name,
    sortOrder: data.sortOrder,
    ...(data.productType ? { productType: data.productType } : {}),
  });
  return id;
}

async function upsertProductPrice(
  db: Db,
  productId: string,
  priceTierId: string,
  price: string
): Promise<void> {
  await db
    .insert(productPrices)
    .values({
      id: generateId(),
      productId,
      variantId: null,
      priceTierId,
      outletId: null,
      price,
      validFrom: null,
      validTo: null,
    })
    .onConflictDoUpdate({
      target: [
        productPrices.productId,
        productPrices.variantId,
        productPrices.priceTierId,
        productPrices.outletId,
        productPrices.validFrom,
      ],
      set: { price },
    });
}

async function assignModifierGroup(
  db: Db,
  productId: string,
  modifierGroupId: string
): Promise<void> {
  await db
    .insert(productModifierGroups)
    .values({ productId, modifierGroupId })
    .onConflictDoNothing();
}

async function main() {
  const db = getAdminDb(); // seed data -- operasi sistem, bukan atas nama satu user via request (CLAUDE.md §3.4)
  const businessId = await getIndokopiBusinessId(db);

  const categoryIds = new Map<string, string>();
  for (const cat of CATEGORY_DATA) {
    const id = await upsertCategory(db, businessId, cat);
    categoryIds.set(cat.name, id);
  }
  console.log(`[categories] ${categoryIds.size} kategori`);

  const tiers: { id: string; code: string }[] = [];
  for (const tier of PRICE_TIER_DATA) {
    const { id } = await upsertPriceTier(db, businessId, tier);
    tiers.push({ id, code: tier.code });
  }
  console.log(`[price_tiers] ${tiers.length} tingkat harga`);

  const modifierGroupIds = new Map<string, string>();
  let modifierCount = 0;
  for (const group of MODIFIER_GROUP_DATA) {
    const groupId = await upsertModifierGroup(db, businessId, {
      name: group.name,
      minSelect: group.minSelect,
      maxSelect: group.maxSelect,
      isRequired: group.isRequired,
    });
    modifierGroupIds.set(group.name, groupId);
    for (const [index, mod] of group.modifiers.entries()) {
      await upsertModifier(db, groupId, {
        name: mod.name,
        price: mod.price,
        sortOrder: index,
      });
      modifierCount++;
    }
  }
  console.log(
    `[modifier_groups] ${modifierGroupIds.size} grup, ${modifierCount} item modifier`
  );

  let productCount = 0;
  let sortOrder = 0;
  for (const group of PRODUCT_DATA) {
    const categoryId = categoryIds.get(group.category);
    if (!categoryId) {
      throw new Error(`Kategori "${group.category}" tidak ditemukan`);
    }

    for (const item of group.items) {
      const productId = await upsertProduct(db, businessId, categoryId, {
        name: item.name,
        sortOrder: sortOrder++,
        productType: group.productType,
      });
      productCount++;

      for (const groupName of group.modifierGroups) {
        const modifierGroupId = modifierGroupIds.get(groupName);
        if (!modifierGroupId) {
          throw new Error(`Grup modifier "${groupName}" tidak ditemukan`);
        }
        await assignModifierGroup(db, productId, modifierGroupId);
      }

      for (const tier of tiers) {
        await upsertProductPrice(db, productId, tier.id, item.basePrice.toFixed(2));
      }
    }
  }
  console.log(`[products] ${productCount} produk (harga tier "Reguler")`);

  console.log("\nSelesai. Katalog Indokopi siap dipakai di /pos.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
