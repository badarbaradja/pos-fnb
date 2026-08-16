/**
 * Audit kelengkapan master data -- hapus permanen kategori TIDAK BISA
 * diurungkan, satu-satunya operasi begitu di seluruh sistem, jadi butuh
 * test sungguhan (bukan cuma dipercaya dari pembacaan kode), sama seperti
 * lib/employees/__tests__/manage.test.ts (T15b) dan
 * lib/devices/__tests__/manage.test.ts (T15c).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
import { eq } from "drizzle-orm";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { getAdminDb } from "@/lib/db/client";
import { businesses, categories, products } from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";
import { deleteCategoryWithDb } from "../manage";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

describe.skipIf(!hasEnv)("categories/manage — hapus permanen", () => {
  const db = getAdminDb();
  const PREFIX = `TEST_CATEGORIES_${Date.now()}`;

  let businessId: string;

  beforeAll(async () => {
    const [business] = await db
      .insert(businesses)
      .values({ name: `${PREFIX}_business` })
      .returning({ id: businesses.id });
    businessId = business!.id;
  });

  afterAll(async () => {
    if (businessId) {
      await db.delete(businesses).where(eq(businesses.id, businessId));
    }
  });

  it("data uji benar-benar terbentuk sebelum diuji (bukan hijau karena kosong)", () => {
    expect(businessId).toBeTruthy();
  });

  it("kategori TANPA produk apa pun -- berhasil dihapus", async () => {
    const [category] = await db
      .insert(categories)
      .values({ id: generateId(), businessId, name: `${PREFIX}_unused` })
      .returning({ id: categories.id });
    const categoryId = category!.id;

    const result = await deleteCategoryWithDb(db, businessId, { id: categoryId });
    expect(result.success).toBeTruthy();
    expect(result.error).toBeUndefined();

    const [row] = await db.select().from(categories).where(eq(categories.id, categoryId));
    expect(row).toBeUndefined();
  });

  it("kategori dipakai 3 produk -- DITOLAK, pesan menyebutkan jumlah yang benar, kategori tetap ada", async () => {
    const [category] = await db
      .insert(categories)
      .values({ id: generateId(), businessId, name: `${PREFIX}_used` })
      .returning({ id: categories.id });
    const categoryId = category!.id;

    for (let i = 0; i < 3; i++) {
      await db.insert(products).values({
        id: generateId(),
        businessId,
        categoryId,
        name: `${PREFIX}_product_${i}`,
      });
    }

    const result = await deleteCategoryWithDb(db, businessId, { id: categoryId });
    expect(result.error).toBeTruthy();
    expect(result.error).toContain("3 produk");
    expect(result.success).toBeUndefined();

    const [row] = await db.select().from(categories).where(eq(categories.id, categoryId));
    expect(row).toBeTruthy(); // tetap ada, tidak ikut terhapus sebagian
  });

  it("kategori punya subkategori -- DITOLAK, kategori induk tetap ada", async () => {
    const [parent] = await db
      .insert(categories)
      .values({ id: generateId(), businessId, name: `${PREFIX}_parent` })
      .returning({ id: categories.id });
    const parentId = parent!.id;

    await db
      .insert(categories)
      .values({ id: generateId(), businessId, name: `${PREFIX}_child`, parentId });

    const result = await deleteCategoryWithDb(db, businessId, { id: parentId });
    expect(result.error).toBeTruthy();
    expect(result.error).toContain("1 subkategori");
    expect(result.success).toBeUndefined();

    const [row] = await db.select().from(categories).where(eq(categories.id, parentId));
    expect(row).toBeTruthy();
  });
});
