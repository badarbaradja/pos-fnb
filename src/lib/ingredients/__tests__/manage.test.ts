/**
 * T21 commit 2/2 -- audit kelengkapan master data (pola sama units/
 * price-tiers): hapus permanen bahan TIDAK BISA diurungkan. Ditambah dua
 * jaminan spesifik ingredients: (1) base_unit/purchase_unit ditolak di
 * server kalau bukan kode units yang benar-benar terdaftar (bukan cuma
 * dropdown UI yang bisa dilewati), (2) base_unit HANYA terkunci setelah
 * ada stock_movement -- longgar sebelum itu, terkunci sesudahnya (beda
 * dari units.code yang terkunci permanen sejak awal).
 *
 * Lewat getUserDb() (via createUserDbFixture), BUKAN getAdminDb() -- ini
 * persis kasus yang GAGAL terbukti sebelumnya: deleteIngredientWithDb lolos
 * test lewat getAdminDb() padahal ingredients sempat tidak punya policy RLS
 * DELETE sama sekali (docs/04-CATATAN-TEKNIS.md #15), baru ketahuan lewat
 * verifikasi UI manual. Test ini sekarang lewat jalur yang sama seperti
 * dashboard sungguhan.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
import { eq } from "drizzle-orm";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { outlets, ingredients, stockLevels, stockMovements, units } from "@/lib/db/schema";
import {
  createIngredientWithDb,
  deleteIngredientWithDb,
  updateIngredientWithDb,
} from "../manage";
import { createUserDbFixture, type UserDbFixture } from "@/lib/db/__tests__/helpers/user-db-fixture";
import { getAdminDb } from "@/lib/db/client";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

describe.skipIf(!hasEnv)("ingredients/manage", () => {
  let fixture: UserDbFixture;
  let outletId: string;

  beforeAll(async () => {
    fixture = await createUserDbFixture("TEST_INGREDIENTS");
    const { db, businessId } = fixture;

    const [outlet] = await db
      .insert(outlets)
      .values({ businessId, code: "T1", name: "outlet" })
      .returning({ id: outlets.id });
    outletId = outlet!.id;

    await db.insert(units).values([
      { businessId, code: "g", name: "Gram", baseUnit: "g", factor: "1" },
      { businessId, code: "kg", name: "Kilogram", baseUnit: "g", factor: "1000" },
      { businessId, code: "ml", name: "Mililiter", baseUnit: "ml", factor: "1" },
    ]);
  });

  afterAll(async () => {
    // stock_movements FK ke businesses ON DELETE NO ACTION (append-only,
    // migration 0017) -- harus dihapus manual dulu sebelum fixture.cleanup()
    // menghapus businesses. stock_levels/ingredients/outlets/units ikut
    // cascade.
    //
    // SENGAJA pakai getAdminDb() di sini, bukan fixture.db -- stock_movements
    // memang TIDAK PUNYA policy RLS DELETE (append-only, CLAUDE.md §3.2),
    // jadi lewat fixture.db (getUserDb) baris ini diam-diam tidak terhapus
    // (0 baris, tanpa error), dan businesses gagal dihapus karena FK. Ini
    // pembersihan data test, operasi sistem, bukan atas nama user (CLAUDE.md
    // §3.4) -- beda dari deleteIngredientWithDb yang justru SEHARUSNYA lewat
    // RLS karena itu yang sedang diuji.
    if (fixture) {
      await getAdminDb()
        .delete(stockMovements)
        .where(eq(stockMovements.businessId, fixture.businessId));
      await fixture.cleanup();
    }
  });

  it("data uji benar-benar terbentuk sebelum diuji (bukan hijau karena kosong)", () => {
    expect(fixture.businessId).toBeTruthy();
    expect(outletId).toBeTruthy();
  });

  it("base_unit yang bukan kode units terdaftar DITOLAK di server", async () => {
    const { db, businessId } = fixture;
    const result = await createIngredientWithDb(db, businessId, {
      name: "Bahan Salah Satuan",
      baseUnit: "kilogram_ngasal",
      purchaseUnit: "kg",
      purchaseFactor: 1000,
    });
    expect(result.error).toBe("Satuan dasar 'kilogram_ngasal' tidak terdaftar di halaman Satuan");
    expect(result.success).toBeUndefined();
  });

  it("purchase_unit yang bukan kode units terdaftar DITOLAK di server", async () => {
    const { db, businessId } = fixture;
    const result = await createIngredientWithDb(db, businessId, {
      name: "Bahan Salah Satuan Beli",
      baseUnit: "g",
      purchaseUnit: "dus_ngasal",
      purchaseFactor: 24,
    });
    expect(result.error).toBe("Satuan beli 'dus_ngasal' tidak terdaftar di halaman Satuan");
  });

  it("kode duplikat DITOLAK dengan pesan jelas", async () => {
    const { db, businessId } = fixture;
    const first = await createIngredientWithDb(db, businessId, {
      code: "SUSU-UHT",
      name: "Susu UHT",
      baseUnit: "ml",
      purchaseUnit: "ml",
      purchaseFactor: 1,
    });
    expect(first.success).toBeTruthy();

    const dup = await createIngredientWithDb(db, businessId, {
      code: "SUSU-UHT",
      name: "Susu UHT (dobel)",
      baseUnit: "ml",
      purchaseUnit: "ml",
      purchaseFactor: 1,
    });
    expect(dup.error).toBe("Kode sudah dipakai bahan lain");
  });

  it("bahan dibuat dengan satuan valid -- berhasil, purchase_factor tersimpan benar", async () => {
    const { db, businessId } = fixture;
    const result = await createIngredientWithDb(db, businessId, {
      name: "Biji Kopi Arabika",
      category: "Bahan Kering",
      baseUnit: "g",
      purchaseUnit: "kg",
      purchaseFactor: 1000,
    });
    expect(result.success).toBeTruthy();

    const [row] = await db
      .select()
      .from(ingredients)
      .where(eq(ingredients.id, result.success!.ingredientId));
    expect(row!.baseUnit).toBe("g");
    expect(row!.purchaseUnit).toBe("kg");
    expect(Number(row!.purchaseFactor)).toBe(1000);
    expect(Number(row!.yieldPercent)).toBe(100); // default
  });

  it("update: nama/kategori/purchase_unit/purchase_factor bisa diubah bebas SELAMA belum ada stock_movement", async () => {
    const { db, businessId } = fixture;
    const created = await createIngredientWithDb(db, businessId, {
      name: "Gula Pasir",
      baseUnit: "g",
      purchaseUnit: "kg",
      purchaseFactor: 1000,
    });
    const ingredientId = created.success!.ingredientId;

    const updated = await updateIngredientWithDb(db, businessId, {
      id: ingredientId,
      name: "Gula Pasir Lokal",
      category: "Bahan Kering",
      baseUnit: "g", // sama, tidak diubah
      purchaseUnit: "g", // diubah dari kg ke g
      purchaseFactor: 1,
      yieldPercent: 100,
    });
    expect(updated.success).toBeTruthy();

    const [row] = await db.select().from(ingredients).where(eq(ingredients.id, ingredientId));
    expect(row!.name).toBe("Gula Pasir Lokal");
    expect(row!.purchaseUnit).toBe("g");
  });

  it("update: base_unit BOLEH diubah kalau belum ada stock_movement", async () => {
    const { db, businessId } = fixture;
    const created = await createIngredientWithDb(db, businessId, {
      name: "Sirup Vanilla",
      baseUnit: "g",
      purchaseUnit: "kg",
      purchaseFactor: 1000,
    });
    const ingredientId = created.success!.ingredientId;

    const updated = await updateIngredientWithDb(db, businessId, {
      id: ingredientId,
      name: "Sirup Vanilla",
      baseUnit: "ml", // diubah dari g ke ml -- boleh, belum ada movement
      purchaseUnit: "ml",
      purchaseFactor: 1,
      yieldPercent: 100,
    });
    expect(updated.success).toBeTruthy();

    const [row] = await db.select().from(ingredients).where(eq(ingredients.id, ingredientId));
    expect(row!.baseUnit).toBe("ml");
  });

  it("update: base_unit DITOLAK begitu bahan punya stock_movement, field lain tetap bisa diubah", async () => {
    const { db, businessId } = fixture;
    const created = await createIngredientWithDb(db, businessId, {
      name: "Bubuk Cokelat",
      baseUnit: "g",
      purchaseUnit: "kg",
      purchaseFactor: 1000,
    });
    const ingredientId = created.success!.ingredientId;

    await db.insert(stockMovements).values({
      businessId,
      outletId,
      ingredientId,
      movementType: "initial",
      qty: "500",
      unitCost: "100",
      totalCost: "50000",
      balanceAfter: "500",
      avgCostAfter: "100",
      businessDate: "2026-08-16",
    });

    const blockedUpdate = await updateIngredientWithDb(db, businessId, {
      id: ingredientId,
      name: "Bubuk Cokelat",
      baseUnit: "ml", // coba ubah -- harus ditolak
      purchaseUnit: "kg",
      purchaseFactor: 1000,
      yieldPercent: 100,
    });
    expect(blockedUpdate.error).toBe(
      "Bahan ini sudah punya 1 riwayat pergerakan stok, satuan dasar tidak bisa diubah lagi."
    );

    const [rowAfterBlock] = await db
      .select()
      .from(ingredients)
      .where(eq(ingredients.id, ingredientId));
    expect(rowAfterBlock!.baseUnit).toBe("g"); // tidak berubah

    // field lain (bukan base_unit) tetap bisa diubah
    const allowedUpdate = await updateIngredientWithDb(db, businessId, {
      id: ingredientId,
      name: "Bubuk Cokelat Premium",
      baseUnit: "g", // sama seperti semula
      purchaseUnit: "g", // ini boleh berubah
      purchaseFactor: 1,
      yieldPercent: 100,
    });
    expect(allowedUpdate.success).toBeTruthy();

    const [rowAfterAllowed] = await db
      .select()
      .from(ingredients)
      .where(eq(ingredients.id, ingredientId));
    expect(rowAfterAllowed!.name).toBe("Bubuk Cokelat Premium");
    expect(rowAfterAllowed!.purchaseUnit).toBe("g");
  });

  it("bahan TANPA riwayat apa pun -- berhasil dihapus", async () => {
    const { db, businessId } = fixture;
    const created = await createIngredientWithDb(db, businessId, {
      name: "Bahan Belum Dipakai",
      baseUnit: "g",
      purchaseUnit: "kg",
      purchaseFactor: 1000,
    });
    const ingredientId = created.success!.ingredientId;

    const result = await deleteIngredientWithDb(db, businessId, { id: ingredientId });
    expect(result.success).toBeTruthy();

    const [row] = await db.select().from(ingredients).where(eq(ingredients.id, ingredientId));
    expect(row).toBeUndefined();
  });

  it("bahan dengan 1 stock_movement -- DITOLAK, pesan menyebutkan jumlah, bahan tetap ada", async () => {
    const { db, businessId } = fixture;
    const created = await createIngredientWithDb(db, businessId, {
      name: "Bahan Dengan Movement",
      baseUnit: "g",
      purchaseUnit: "kg",
      purchaseFactor: 1000,
    });
    const ingredientId = created.success!.ingredientId;

    await db.insert(stockMovements).values({
      businessId,
      outletId,
      ingredientId,
      movementType: "initial",
      qty: "10",
      unitCost: "5000",
      totalCost: "50000",
      balanceAfter: "10",
      avgCostAfter: "5000",
      businessDate: "2026-08-16",
    });

    const result = await deleteIngredientWithDb(db, businessId, { id: ingredientId });
    expect(result.error).toBe(
      "Bahan ini sudah punya 1 riwayat pergerakan stok, tidak bisa dihapus. Nonaktifkan saja."
    );

    const [row] = await db.select().from(ingredients).where(eq(ingredients.id, ingredientId));
    expect(row).toBeTruthy();
  });

  it("bahan dengan baris stock_levels (tanpa movement) -- DITOLAK juga", async () => {
    const { db, businessId } = fixture;
    const created = await createIngredientWithDb(db, businessId, {
      name: "Bahan Dengan Stock Level",
      baseUnit: "g",
      purchaseUnit: "kg",
      purchaseFactor: 1000,
    });
    const ingredientId = created.success!.ingredientId;

    await db.insert(stockLevels).values({ businessId, ingredientId, outletId });

    const result = await deleteIngredientWithDb(db, businessId, { id: ingredientId });
    expect(result.error).toBe(
      "Bahan ini sudah punya catatan stok di outlet, tidak bisa dihapus. Nonaktifkan saja."
    );

    const [row] = await db.select().from(ingredients).where(eq(ingredients.id, ingredientId));
    expect(row).toBeTruthy();
  });
});
