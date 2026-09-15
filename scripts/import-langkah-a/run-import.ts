import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { readFileSync } from "fs";
import { join } from "path";
import { and, eq, inArray, like } from "drizzle-orm";
import { getAdminDb } from "../../src/lib/db/client";
import {
  businesses,
  outlets,
  brands,
  priceTiers,
  categories,
  products,
  productPrices,
  productOutlets,
  modifierGroups,
  modifiers,
  units,
  ingredients,
  stockMovements,
  stockLevels,
} from "../../src/lib/db/schema";
import { generateId } from "../../src/lib/utils/id";

// ---- parsing (sama seperti dry-run-v2.ts) ----
function parseCsv<T extends Record<string, string>>(text: string): T[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const header = splitCsvLine(lines[0]!);
  const rows: T[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]!);
    const row: Record<string, string> = {};
    header.forEach((h, idx) => (row[h] = (cols[idx] ?? "").trim()));
    // Lihat catatan yang sama di analyze.ts -- semua kolom header selalu
    // terisi (string kosong kalau memang kosong), assert ke bentuk yang
    // sudah diverifikasi manual di pemanggil.
    rows.push(row as T);
  }
  return rows;
}
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

type MaterialRow = { id: string; name: string; harga_beli: string; satuan: string };
type ProdukRow = {
  id: string;
  name: string;
  category: string;
  resto: string;
  harga_jual: string;
  note: string;
};

const materials = parseCsv<MaterialRow>(readFileSync(join(__dirname, "material.csv"), "utf-8"));
const produk = parseCsv<ProdukRow>(readFileSync(join(__dirname, "produk.csv"), "utf-8"));

const UNIT_NORMALIZE: Record<string, string> = {
  porsi: "porsi",
  gr: "gram",
  gram: "gram",
  g: "gram",
  pcs: "pcs",
  ml: "ml",
  liter: "liter",
  kg: "kg",
  dirgen: "dirigen",
  dergen: "dirigen",
  botol: "botol",
  kotak: "kotak",
  bungkus: "bungkus",
  pack: "pack",
  pck: "pack",
  pak: "pack",
};
const UNIT_OVERRIDE_BY_ID: Record<string, string> = {
  "50": "porsi", "56": "gram", "86": "porsi", "185": "gram", "235": "gram",
  "242": "gram", "279": "pcs", "299": "porsi", "345": "porsi", "347": "porsi",
  "348": "porsi", "352": "botol", "353": "pcs", "358": "ml", "373": "pcs",
  "388": "gram", "430": "pcs", "458": "pcs", "497": "porsi",
};

const UNIT_CATALOG: { code: string; name: string }[] = [
  { code: "gram", name: "Gram" },
  { code: "kg", name: "Kilogram" },
  { code: "ml", name: "Mililiter" },
  { code: "liter", name: "Liter" },
  { code: "pcs", name: "Pcs" },
  { code: "pack", name: "Pack" },
  { code: "porsi", name: "Porsi" },
  { code: "dirigen", name: "Dirigen" },
  { code: "botol", name: "Botol" },
  { code: "kotak", name: "Kotak" },
  { code: "bungkus", name: "Bungkus" },
];

const TOPPING_TAMBAHAN_CATEGORIES = new Set(["Topping Extra", "Tambahan"]);
const RENAME: Record<string, string> = {
  "423": "Butterscotch Latte 1 Liter",
  "424": "Jasmine Honey Latte 1 Liter",
};
const SKIP_IDS = new Set(["461"]);
const GULA_IDS = new Set(["326", "327"]);

const OLD_DEMO_PRODUCT_NAMES = [
  "Cappuccino", "Cafe Latte", "Kopi Susu Gula Aren", "Matcha Latte", "Chocolate",
  "Taro Latte", "Thai Tea", "Lemon Tea", "Mie Goreng Jawa", "Ayam Geprek",
  "Nasi Ayam Teriyaki", "Spaghetti Aglio Olio", "Kentang Goreng", "Pisang Goreng",
  "Roti Bakar", "Tahu Crispy", "Onion Rings", "Cheese Cake", "Pudding Coklat",
  "Waffle", "Es Krim Vanilla", "Nasi Goreng Spesial", "Croissant", "Americano",
  "Espresso",
];

async function main() {
  const db = getAdminDb();
  const [business] = await db.select().from(businesses).where(like(businesses.name, "%Demo Cafe%"));
  if (!business) throw new Error("Business '[DEV] Demo Cafe' tidak ditemukan");
  const businessId = business.id;

  const outletRows = await db
    .select({ id: outlets.id, code: outlets.code })
    .from(outlets)
    .where(and(eq(outlets.businessId, businessId), inArray(outlets.code, ["ISCP", "ISPK", "IKJT", "IKLK"])));
  if (outletRows.length !== 4) throw new Error(`Diharapkan 4 outlet, ditemukan ${outletRows.length}`);
  const outletIdByCode = new Map(outletRows.map((o) => [o.code, o.id]));
  const RESTO_TO_OUTLET_IDS: Record<string, string[]> = {
    Indosteak: [outletIdByCode.get("ISCP")!, outletIdByCode.get("ISPK")!],
    Indokopi: [outletIdByCode.get("IKJT")!],
    "Indokopi Lite": [outletIdByCode.get("IKLK")!],
  };

  const [dineinTier] = await db
    .select()
    .from(priceTiers)
    .where(and(eq(priceTiers.businessId, businessId), eq(priceTiers.code, "DINEIN")));
  if (!dineinTier) throw new Error("Price tier DINEIN tidak ditemukan");

  let brandRows = await db.select().from(brands).where(eq(brands.businessId, businessId));
  const brandIdByName = new Map(brandRows.map((b) => [b.name, b.id]));
  const RESTO_TO_BRAND: Record<string, string> = {
    Indosteak: "Indosteak",
    Indokopi: "Indokopi",
    "Indokopi Lite": "Indokopi",
  };
  for (const brandName of new Set(Object.values(RESTO_TO_BRAND))) {
    if (!brandIdByName.has(brandName)) throw new Error(`Brand "${brandName}" tidak ditemukan`);
  }

  // Guard: pastikan ingredient "Es Batu" lama masih benar-benar 0 pemakaian
  // sebelum dihapus -- dicek ULANG di sini (bukan cuma percaya hasil skrip
  // pengecekan sebelumnya), supaya tidak ada celah TOCTOU kalau ada proses
  // lain menulis di antaranya.
  const legacyEsBatu = await db
    .select({ id: ingredients.id })
    .from(ingredients)
    .where(and(eq(ingredients.businessId, businessId), eq(ingredients.name, "Es Batu")));

  // PENTING: id produk demo lama diambil SEBELUM produk baru dibuat, dan
  // dinonaktifkan lewat ID ini -- BUKAN lewat nama setelah impor -- karena
  // beberapa produk baru (Americano, Kentang Goreng, Lemon Tea, Thai Tea)
  // punya nama yang SAMA PERSIS dengan produk demo lama. Nonaktifkan
  // berdasarkan nama setelah insert akan ikut mematikan produk baru yang
  // baru saja dibuat.
  const oldDemoProductIds = (
    await db
      .select({ id: products.id })
      .from(products)
      .where(
        and(
          eq(products.businessId, businessId),
          inArray(products.name, OLD_DEMO_PRODUCT_NAMES),
          eq(products.isActive, true)
        )
      )
  ).map((p) => p.id);
  if (oldDemoProductIds.length !== 25) {
    throw new Error(
      `Diharapkan 25 produk demo lama, ditemukan ${oldDemoProductIds.length}. Berhenti, jangan lanjut.`
    );
  }

  const summary = {
    unitsDeleted: 0,
    unitsCreated: 0,
    ingredientsCreated: 0,
    modifierGroupsCreated: 0,
    modifiersCreated: 0,
    categoriesCreated: 0,
    categoriesReused: 0,
    productsCreated: 0,
    productPricesCreated: 0,
    productOutletsCreated: 0,
    oldDemoProductsDeactivated: 0,
  };

  await db.transaction(async (tx) => {
    // ---- 0. Bersihkan sampah units lama ----
    for (const ing of legacyEsBatu) {
      const [movCount] = await tx.select().from(stockMovements).where(eq(stockMovements.ingredientId, ing.id));
      const [lvlCount] = await tx.select().from(stockLevels).where(eq(stockLevels.ingredientId, ing.id));
      if (movCount || lvlCount) {
        throw new Error(`Ingredient "Es Batu" lama (${ing.id}) ternyata sudah dipakai -- BERHENTI, jangan hapus.`);
      }
      await tx.delete(ingredients).where(eq(ingredients.id, ing.id));
    }
    const deletedUnits = await tx
      .delete(units)
      .where(and(eq(units.businessId, businessId), inArray(units.code, ["kg", "pcs"])))
      .returning({ id: units.id });
    summary.unitsDeleted = deletedUnits.length;

    // ---- 1. Katalog units bersih ----
    for (const u of UNIT_CATALOG) {
      await tx.insert(units).values({
        id: generateId(),
        businessId,
        code: u.code,
        name: u.name,
        baseUnit: u.code,
        factor: "1",
      });
      summary.unitsCreated++;
    }

    // ---- 2. Ingredients dari material.csv ----
    for (const row of materials) {
      const unit = UNIT_OVERRIDE_BY_ID[row.id] ?? UNIT_NORMALIZE[row.satuan.replace(/\xa0/g, " ").trim().toLowerCase()];
      if (!unit) throw new Error(`Satuan tidak terselesaikan untuk material id=${row.id} (${row.name})`);
      await tx.insert(ingredients).values({
        id: generateId(),
        businessId,
        code: null,
        name: row.name,
        category: null,
        baseUnit: unit,
        purchaseUnit: unit,
        purchaseFactor: "1",
      });
      summary.ingredientsCreated++;
    }

    // ---- 3. Split produk vs modifier ----
    const modifierRows: typeof produk = [];
    const productRows: typeof produk = [];
    for (const row of produk) {
      if (SKIP_IDS.has(row.id)) continue;
      if (TOPPING_TAMBAHAN_CATEGORIES.has(row.category)) {
        modifierRows.push(row);
        continue;
      }
      const renamed = RENAME[row.id];
      productRows.push(renamed ? { ...row, name: renamed } : row);
    }

    // ---- 4. Modifier groups ----
    async function insertModifierGroup(name: string, rows: typeof produk, forceZeroPrice: boolean) {
      if (rows.length === 0) return;
      const groupId = generateId();
      await tx.insert(modifierGroups).values({
        id: groupId,
        businessId,
        name,
        minSelect: 0,
        maxSelect: rows.length,
        isRequired: false,
      });
      summary.modifierGroupsCreated++;
      for (const [idx, row] of rows.entries()) {
        await tx.insert(modifiers).values({
          id: generateId(),
          modifierGroupId: groupId,
          name: row.name,
          price: forceZeroPrice ? "0" : row.harga_jual,
          sortOrder: idx,
        });
        summary.modifiersCreated++;
      }
    }

    const indokopiTopping = modifierRows.filter((r) => r.category === "Topping Extra" && !GULA_IDS.has(r.id));
    const gula = modifierRows.filter((r) => GULA_IDS.has(r.id));
    const tambahanIndosteak = modifierRows.filter((r) => r.category === "Tambahan" && r.resto === "Indosteak");
    const tambahanIndokopi = modifierRows.filter((r) => r.category === "Tambahan" && r.resto === "Indokopi");
    const tambahanIndokopiLite = modifierRows.filter((r) => r.category === "Tambahan" && r.resto === "Indokopi Lite");

    await insertModifierGroup("Topping Extra - Indokopi", indokopiTopping, false);
    await insertModifierGroup("Level Gula - Indokopi", gula, true);
    await insertModifierGroup("Tambahan - Indosteak", tambahanIndosteak, false);
    await insertModifierGroup("Tambahan - Indokopi", tambahanIndokopi, false);
    await insertModifierGroup("Tambahan - Indokopi Lite", tambahanIndokopiLite, false);

    // ---- 5. Kategori (reuse exact-match, buat baru selainnya) ----
    const existingCats = await tx
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(and(eq(categories.businessId, businessId), eq(categories.scope, "fnb")));
    const categoryIdByName = new Map(existingCats.map((c) => [c.name, c.id]));

    const distinctCategoryNames = [...new Set(productRows.map((r) => r.category))];
    for (const name of distinctCategoryNames) {
      if (categoryIdByName.has(name)) {
        summary.categoriesReused++;
        continue;
      }
      const id = generateId();
      await tx.insert(categories).values({ id, businessId, name, scope: "fnb" });
      categoryIdByName.set(name, id);
      summary.categoriesCreated++;
    }

    // ---- 6. Products + productPrices(DINEIN) + productOutlets ----
    for (const row of productRows) {
      const productId = generateId();
      const brandId = brandIdByName.get(RESTO_TO_BRAND[row.resto]!)!;
      const categoryId = categoryIdByName.get(row.category)!;

      await tx.insert(products).values({
        id: productId,
        businessId,
        categoryId,
        brandId,
        name: row.name,
        productType: "recipe",
      });
      summary.productsCreated++;

      await tx.insert(productPrices).values({
        id: generateId(),
        productId,
        variantId: null,
        priceTierId: dineinTier.id,
        outletId: null,
        price: row.harga_jual,
        validFrom: null,
        validTo: null,
      });
      summary.productPricesCreated++;

      const outletIds = RESTO_TO_OUTLET_IDS[row.resto];
      if (!outletIds) throw new Error(`Resto tidak dikenal: "${row.resto}" (produk id ${row.id})`);
      for (const outletId of outletIds) {
        await tx.insert(productOutlets).values({ productId, outletId });
        summary.productOutletsCreated++;
      }
    }

    // ---- 7. Nonaktifkan 25 produk demo lama (berdasarkan ID yang diambil
    // SEBELUM produk baru dibuat -- lihat komentar oldDemoProductIds) ----
    const deactivated = await tx
      .update(products)
      .set({ isActive: false })
      .where(and(eq(products.businessId, businessId), inArray(products.id, oldDemoProductIds)))
      .returning({ id: products.id, name: products.name });
    summary.oldDemoProductsDeactivated = deactivated.length;
  });

  console.log("=== IMPOR SELESAI ===");
  console.log(summary);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
