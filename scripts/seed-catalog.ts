import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { and, eq } from "drizzle-orm";
import { Decimal } from "decimal.js";
import { getAdminDb } from "../src/lib/db/client";
import {
  categories,
  priceTiers,
  modifierGroups,
  modifiers,
  products,
  productVariants,
  productPrices,
  productModifierGroups,
} from "../src/lib/db/schema";
import { generateId } from "../src/lib/utils/id";
import { roundTo } from "../src/lib/utils/money";
import { getDemoBusinessId } from "./seed-shared";

/**
 * scripts/seed-catalog.ts — T10: seed katalog satu cafe fiktif ke business
 * demo (dibuat lewat `npm run seed:demo`): 5 kategori, 4 tingkat harga, 3
 * grup modifier, dan 25 menu dengan varian + harga di semua tier.
 * Idempoten -- aman dijalankan ulang, tidak bikin baris duplikat.
 *
 * Bahan & resep SENGAJA tidak disertakan -- skema inventori belum ada
 * (Fase 2). Lihat T24b di docs/01-TASK-BOARD.md.
 *
 * Pakai getAdminDb() -- operasi sistem (seed), bukan atas nama satu user
 * lewat request, diizinkan CLAUDE.md §3.4.
 */

type Db = ReturnType<typeof getAdminDb>;

const CATEGORY_DATA = [
  { name: "Kopi", color: "#78350f", sortOrder: 0 },
  { name: "Non-Kopi", color: "#0ea5e9", sortOrder: 1 },
  { name: "Makanan Berat", color: "#dc2626", sortOrder: 2 },
  { name: "Snack", color: "#f59e0b", sortOrder: 3 },
  { name: "Dessert", color: "#db2777", sortOrder: 4 },
] as const;

const PRICE_TIER_DATA = [
  { code: "DINEIN", name: "Dine-in", channel: null, markupPercent: "0", isDefault: true },
  { code: "TAKEAWAY", name: "Takeaway", channel: null, markupPercent: "0", isDefault: false },
  { code: "GOFOOD", name: "GoFood", channel: "gofood", markupPercent: "25", isDefault: false },
  { code: "MEMBER", name: "Member", channel: null, markupPercent: "-5", isDefault: false },
] as const;

const MODIFIER_GROUP_DATA = [
  {
    name: "Suhu",
    minSelect: 1,
    maxSelect: 1,
    isRequired: true,
    modifiers: [
      { name: "Panas", price: "0" },
      { name: "Dingin", price: "0" },
    ],
  },
  {
    name: "Level Gula",
    minSelect: 0,
    maxSelect: 1,
    isRequired: false,
    modifiers: [
      { name: "Normal", price: "0" },
      { name: "Kurang Manis", price: "0" },
      { name: "Tanpa Gula", price: "0" },
    ],
  },
  {
    name: "Topping",
    minSelect: 0,
    maxSelect: 3,
    isRequired: false,
    modifiers: [
      { name: "Boba", price: "5000" },
      { name: "Extra Shot", price: "8000" },
      { name: "Whipped Cream", price: "6000" },
      { name: "Cheese Foam", price: "7000" },
    ],
  },
] as const;

// Grup modifier yang di-assign ke setiap produk minuman (Kopi + Non-Kopi).
const DRINK_MODIFIER_GROUPS = ["Suhu", "Level Gula", "Topping"] as const;

const PRODUCT_DATA: {
  category: (typeof CATEGORY_DATA)[number]["name"];
  isDrink: boolean;
  items: { name: string; basePrice: number }[];
}[] = [
  {
    category: "Kopi",
    isDrink: true,
    items: [
      { name: "Espresso", basePrice: 18000 },
      { name: "Americano", basePrice: 20000 },
      { name: "Cappuccino", basePrice: 25000 },
      { name: "Cafe Latte", basePrice: 27000 },
      { name: "Kopi Susu Gula Aren", basePrice: 22000 },
    ],
  },
  {
    category: "Non-Kopi",
    isDrink: true,
    items: [
      { name: "Matcha Latte", basePrice: 28000 },
      { name: "Chocolate", basePrice: 26000 },
      { name: "Taro Latte", basePrice: 27000 },
      { name: "Thai Tea", basePrice: 23000 },
      { name: "Lemon Tea", basePrice: 18000 },
    ],
  },
  {
    category: "Makanan Berat",
    isDrink: false,
    items: [
      { name: "Nasi Goreng Spesial", basePrice: 32000 },
      { name: "Mie Goreng Jawa", basePrice: 30000 },
      { name: "Ayam Geprek", basePrice: 28000 },
      { name: "Nasi Ayam Teriyaki", basePrice: 33000 },
      { name: "Spaghetti Aglio Olio", basePrice: 35000 },
    ],
  },
  {
    category: "Snack",
    isDrink: false,
    items: [
      { name: "Kentang Goreng", basePrice: 20000 },
      { name: "Pisang Goreng", basePrice: 18000 },
      { name: "Roti Bakar", basePrice: 19000 },
      { name: "Tahu Crispy", basePrice: 17000 },
      { name: "Onion Rings", basePrice: 21000 },
    ],
  },
  {
    category: "Dessert",
    isDrink: false,
    items: [
      { name: "Croissant", basePrice: 22000 },
      { name: "Cheese Cake", basePrice: 30000 },
      { name: "Pudding Coklat", basePrice: 18000 },
      { name: "Waffle", basePrice: 25000 },
      { name: "Es Krim Vanilla", basePrice: 15000 },
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
  data: { name: string; sortOrder: number }
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
  });
  return id;
}

async function upsertVariant(
  db: Db,
  productId: string,
  data: { name: string; priceDelta: string; isDefault: boolean; isActive: boolean }
): Promise<void> {
  const [existing] = await db
    .select({ id: productVariants.id })
    .from(productVariants)
    .where(
      and(eq(productVariants.productId, productId), eq(productVariants.name, data.name))
    );
  if (existing) {
    return;
  }
  await db.insert(productVariants).values({ id: generateId(), productId, ...data });
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
  const businessId = await getDemoBusinessId(db);

  const categoryIds = new Map<string, string>();
  for (const cat of CATEGORY_DATA) {
    const id = await upsertCategory(db, businessId, cat);
    categoryIds.set(cat.name, id);
  }
  console.log(`[categories] ${categoryIds.size} kategori`);

  const tiers: { id: string; code: string; markupPercent: string | null }[] = [];
  for (const tier of PRICE_TIER_DATA) {
    const { id, markupPercent } = await upsertPriceTier(db, businessId, tier);
    tiers.push({ id, code: tier.code, markupPercent });
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
      });
      productCount++;

      if (group.isDrink) {
        await upsertVariant(db, productId, {
          name: "Regular",
          priceDelta: "0",
          isDefault: true,
          isActive: true,
        });
        await upsertVariant(db, productId, {
          name: "Large",
          priceDelta: "5000",
          isDefault: false,
          isActive: true,
        });
        for (const groupName of DRINK_MODIFIER_GROUPS) {
          const groupId = modifierGroupIds.get(groupName);
          if (!groupId) {
            throw new Error(`Grup modifier "${groupName}" tidak ditemukan`);
          }
          await assignModifierGroup(db, productId, groupId);
        }
      }

      // Harga per tier diturunkan dari harga dine-in + markup tier (mis.
      // GoFood 25%) supaya angkanya konsisten dengan markupPercent yang
      // tersimpan, bukan angka acak per tier.
      const base = new Decimal(item.basePrice);
      for (const tier of tiers) {
        const markup = new Decimal(tier.markupPercent ?? "0");
        const price = roundTo(base.times(markup.dividedBy(100).plus(1)), 500, "nearest");
        await upsertProductPrice(db, productId, tier.id, price.toFixed(2));
      }
    }
  }
  console.log(`[products] ${productCount} produk (varian + harga semua tier)`);

  console.log("Selesai.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
