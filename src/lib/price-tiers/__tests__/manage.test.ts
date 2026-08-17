/**
 * Audit kelengkapan master data -- hapus permanen tingkat harga TIDAK BISA
 * diurungkan, jadi butuh test sungguhan. Kondisi block kedua (tier sudah
 * dipakai transaksi) SENGAJA tidak diuji di sini -- mekanismenya (transaksi
 * + DeleteBlockedError + interpolasi {count}) persis sama dengan yang
 * sudah dibuktikan lewat fixture order sungguhan di
 * lib/modifiers/__tests__/manage.test.ts, jadi tidak menambah keyakinan
 * baru untuk menduplikasi fixture berat itu di sini.
 *
 * Lewat getUserDb() (via createUserDbFixture), BUKAN getAdminDb() -- lihat
 * komentar di lib/categories/__tests__/manage.test.ts untuk alasannya.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
import { eq } from "drizzle-orm";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { priceTiers, productPrices, products } from "@/lib/db/schema";
import { deletePriceTierWithDb } from "../manage";
import { createUserDbFixture, type UserDbFixture } from "@/lib/db/__tests__/helpers/user-db-fixture";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

describe.skipIf(!hasEnv)("price-tiers/manage — hapus permanen", () => {
  let fixture: UserDbFixture;

  beforeAll(async () => {
    fixture = await createUserDbFixture("TEST_PRICETIERS");
  });

  afterAll(async () => {
    if (fixture) await fixture.cleanup();
  });

  it("data uji benar-benar terbentuk sebelum diuji (bukan hijau karena kosong)", () => {
    expect(fixture.businessId).toBeTruthy();
  });

  it("tier TANPA harga produk apa pun -- berhasil dihapus", async () => {
    const { db, businessId } = fixture;
    const [tier] = await db
      .insert(priceTiers)
      .values({ businessId, code: "UNUSED", name: "unused" })
      .returning({ id: priceTiers.id });
    const tierId = tier!.id;

    const result = await deletePriceTierWithDb(db, businessId, { id: tierId });
    expect(result.success).toBeTruthy();
    expect(result.error).toBeUndefined();

    const [row] = await db.select().from(priceTiers).where(eq(priceTiers.id, tierId));
    expect(row).toBeUndefined();
  });

  it("tier dipakai di harga 4 produk -- DITOLAK, pesan menyebutkan jumlah yang benar, tier tetap ada", async () => {
    const { db, businessId } = fixture;
    const [tier] = await db
      .insert(priceTiers)
      .values({ businessId, code: "USED", name: "used" })
      .returning({ id: priceTiers.id });
    const tierId = tier!.id;

    for (let i = 0; i < 4; i++) {
      const [product] = await db
        .insert(products)
        .values({ businessId, name: `product_${i}` })
        .returning({ id: products.id });
      await db
        .insert(productPrices)
        .values({ productId: product!.id, priceTierId: tierId, price: "10000" });
    }

    const result = await deletePriceTierWithDb(db, businessId, { id: tierId });
    expect(result.error).toBeTruthy();
    expect(result.error).toContain("4 produk");
    expect(result.success).toBeUndefined();

    const [row] = await db.select().from(priceTiers).where(eq(priceTiers.id, tierId));
    expect(row).toBeTruthy();
  });
});
