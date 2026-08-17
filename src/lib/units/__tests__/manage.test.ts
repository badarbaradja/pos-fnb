/**
 * T21 -- Audit kelengkapan master data (pola sama price-tiers/categories):
 * hapus permanen satuan TIDAK BISA diurungkan, jadi butuh test sungguhan.
 * Ditambah satu test kunci: `code` benar-benar tidak bisa berubah lewat
 * updateUnitWithDb walau field-nya diselundupkan di rawInput -- itu jaminan
 * inti dari docs/04-CATATAN-TEKNIS.md #15 (ingredients merujuk unit lewat
 * teks, bukan FK).
 *
 * Lewat getUserDb() (via createUserDbFixture), BUKAN getAdminDb() -- lihat
 * komentar di lib/categories/__tests__/manage.test.ts untuk alasannya.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
import { eq } from "drizzle-orm";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { ingredients, units } from "@/lib/db/schema";
import { createUnitWithDb, deleteUnitWithDb, updateUnitWithDb } from "../manage";
import { createUserDbFixture, type UserDbFixture } from "@/lib/db/__tests__/helpers/user-db-fixture";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

describe.skipIf(!hasEnv)("units/manage", () => {
  let fixture: UserDbFixture;

  beforeAll(async () => {
    fixture = await createUserDbFixture("TEST_UNITS");
  });

  afterAll(async () => {
    if (fixture) await fixture.cleanup();
  });

  it("data uji benar-benar terbentuk sebelum diuji (bukan hijau karena kosong)", () => {
    expect(fixture.businessId).toBeTruthy();
  });

  it("kode duplikat dalam satu bisnis DITOLAK dengan pesan jelas", async () => {
    const { db, businessId } = fixture;
    const first = await createUnitWithDb(db, businessId, {
      code: "kg",
      name: "Kilogram",
      baseUnit: "g",
      factor: 1000,
    });
    expect(first.success).toBeTruthy();

    const dup = await createUnitWithDb(db, businessId, {
      code: "kg",
      name: "Kilogram (dobel)",
      baseUnit: "g",
      factor: 1000,
    });
    expect(dup.error).toBe("Kode sudah dipakai satuan lain");
  });

  it("update mengubah nama/satuan dasar/faktor, TAPI code tidak bisa diubah walau diselundupkan di rawInput", async () => {
    const { db, businessId } = fixture;
    const created = await createUnitWithDb(db, businessId, {
      code: "L",
      name: "Liter",
      baseUnit: "ml",
      factor: 1000,
    });
    const unitId = created.success!.unitId;

    const updated = await updateUnitWithDb(db, businessId, {
      id: unitId,
      name: "Liter (diubah)",
      baseUnit: "ml",
      factor: 1000,
      code: "LITER_SELUNDUP", // rawInput sengaja menyelipkan code -- harus diabaikan
    });
    expect(updated.success).toBeTruthy();

    const [row] = await db.select().from(units).where(eq(units.id, unitId));
    expect(row!.name).toBe("Liter (diubah)");
    expect(row!.code).toBe("L"); // TIDAK berubah
  });

  it("satuan TANPA bahan apa pun yang memakainya -- berhasil dihapus", async () => {
    const { db, businessId } = fixture;
    const created = await createUnitWithDb(db, businessId, {
      code: "pack",
      name: "Pack",
      baseUnit: "pcs",
      factor: 1,
    });
    const unitId = created.success!.unitId;

    const result = await deleteUnitWithDb(db, businessId, { id: unitId });
    expect(result.success).toBeTruthy();
    expect(result.error).toBeUndefined();

    const [row] = await db.select().from(units).where(eq(units.id, unitId));
    expect(row).toBeUndefined();
  });

  it("satuan dipakai sebagai base_unit 2 bahan -- DITOLAK, pesan menyebutkan jumlah yang benar, satuan tetap ada", async () => {
    const { db, businessId } = fixture;
    const created = await createUnitWithDb(db, businessId, {
      code: "g",
      name: "Gram",
      baseUnit: "g",
      factor: 1,
    });
    const unitId = created.success!.unitId;

    for (let i = 0; i < 2; i++) {
      await db.insert(ingredients).values({
        businessId,
        name: `ingredient_${i}`,
        baseUnit: "g",
        purchaseUnit: "kg",
        purchaseFactor: "1000",
      });
    }

    const result = await deleteUnitWithDb(db, businessId, { id: unitId });
    expect(result.error).toBe("Satuan ini dipakai oleh 2 bahan, tidak bisa dihapus.");
    expect(result.success).toBeUndefined();

    const [row] = await db.select().from(units).where(eq(units.id, unitId));
    expect(row).toBeTruthy();
  });

  it("satuan dipakai sebagai purchase_unit 1 bahan -- DITOLAK juga (bukan cuma base_unit yang dicek)", async () => {
    const { db, businessId } = fixture;
    const created = await createUnitWithDb(db, businessId, {
      code: "dus",
      name: "Dus",
      baseUnit: "pcs",
      factor: 1,
    });
    const unitId = created.success!.unitId;

    await db.insert(ingredients).values({
      businessId,
      name: "ingredient_dus",
      baseUnit: "pcs",
      purchaseUnit: "dus",
      purchaseFactor: "24",
    });

    const result = await deleteUnitWithDb(db, businessId, { id: unitId });
    expect(result.error).toBe("Satuan ini dipakai oleh 1 bahan, tidak bisa dihapus.");

    const [row] = await db.select().from(units).where(eq(units.id, unitId));
    expect(row).toBeTruthy();
  });
});
