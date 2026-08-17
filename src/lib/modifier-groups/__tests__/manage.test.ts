/**
 * Audit kelengkapan master data -- hapus permanen grup modifier TIDAK BISA
 * diurungkan, jadi butuh test sungguhan. Cek kondisi kedua (item modifier di
 * grup ini sudah pernah dipesan) SENGAJA tidak diuji di sini -- butuh
 * fixture order lengkap (shift+device+payment), sudah diuji jalur yang
 * sama persis di lib/modifiers/__tests__/manage.test.ts (satu-satunya
 * kondisi block di sana). Menduplikasi fixture berat itu di sini tidak
 * menambah keyakinan baru.
 *
 * Lewat getUserDb() (via createUserDbFixture), BUKAN getAdminDb() -- lihat
 * komentar di lib/categories/__tests__/manage.test.ts untuk alasannya.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
import { eq } from "drizzle-orm";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { modifierGroups, productModifierGroups, products } from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";
import { deleteModifierGroupWithDb } from "../manage";
import { createUserDbFixture, type UserDbFixture } from "@/lib/db/__tests__/helpers/user-db-fixture";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

describe.skipIf(!hasEnv)("modifier-groups/manage — hapus permanen", () => {
  let fixture: UserDbFixture;

  beforeAll(async () => {
    fixture = await createUserDbFixture("TEST_MODGROUPS");
  });

  afterAll(async () => {
    if (fixture) await fixture.cleanup();
  });

  it("data uji benar-benar terbentuk sebelum diuji (bukan hijau karena kosong)", () => {
    expect(fixture.businessId).toBeTruthy();
  });

  it("grup TANPA produk apa pun -- berhasil dihapus", async () => {
    const { db, businessId } = fixture;
    const [group] = await db
      .insert(modifierGroups)
      .values({ id: generateId(), businessId, name: "unused" })
      .returning({ id: modifierGroups.id });
    const groupId = group!.id;

    const result = await deleteModifierGroupWithDb(db, businessId, { id: groupId });
    expect(result.success).toBeTruthy();
    expect(result.error).toBeUndefined();

    const [row] = await db
      .select()
      .from(modifierGroups)
      .where(eq(modifierGroups.id, groupId));
    expect(row).toBeUndefined();
  });

  it("grup ditempel ke 2 produk -- DITOLAK, pesan menyebutkan jumlah yang benar, grup tetap ada", async () => {
    const { db, businessId } = fixture;
    const [group] = await db
      .insert(modifierGroups)
      .values({ id: generateId(), businessId, name: "used" })
      .returning({ id: modifierGroups.id });
    const groupId = group!.id;

    for (let i = 0; i < 2; i++) {
      const [product] = await db
        .insert(products)
        .values({ id: generateId(), businessId, name: `product_${i}` })
        .returning({ id: products.id });
      await db
        .insert(productModifierGroups)
        .values({ productId: product!.id, modifierGroupId: groupId });
    }

    const result = await deleteModifierGroupWithDb(db, businessId, { id: groupId });
    expect(result.error).toBeTruthy();
    expect(result.error).toContain("2 produk");
    expect(result.success).toBeUndefined();

    const [row] = await db
      .select()
      .from(modifierGroups)
      .where(eq(modifierGroups.id, groupId));
    expect(row).toBeTruthy();
  });
});
