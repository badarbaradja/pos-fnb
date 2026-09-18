/**
 * Langkah C — Stock Opname: test integrasi.
 *
 * Skenario yang diuji:
 *   1. Data fixture terbentuk sebelum tes dimulai (sanity check)
 *   2. Opname PERTAMA dari nol: 225 bahan, qty sistem 0, harga dari CSV
 *      → semua bahan terisi di stock_levels, avg_cost benar
 *   3. Opname PARSIAL: bahan yang tidak disentuh TIDAK berubah
 *   4. Selisih NEGATIF dan POSITIF keduanya tercatat benar di ledger
 *   5. WRITE-ONCE: upsert setelah submitted DITOLAK
 *   6. WRITE-ONCE: submit ulang DITOLAK
 *   7. Selisih besar TIDAK PERLU alasan (dihapus 18 September 2026) --
 *      submit berhasil tanpa varianceReason sama sekali
 *   8. Submit tanpa item sama sekali berhasil (0 movement, 0 item)
 *   9. getOpnameItemsForSession menampilkan semua bahan
 *  10. Bulk upsert (Simpan Semua): banyak baris sekaligus, systemQty
 *      snapshot tetap benar, write-once tetap berlaku
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
import { and, eq } from "drizzle-orm";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import {
  brands,
  employees,
  ingredients,
  outlets,
  stockLevels,
  stockMovements,
  stockOpnames,
} from "@/lib/db/schema";
import {
  createOpnameWithDb,
  getOpnameItemsForSession,
  submitOpnameWithDb,
  upsertOpnameItemsBulkWithDb,
  upsertOpnameItemWithDb,
} from "../manage";
import { createUserDbFixture, type UserDbFixture } from "@/lib/db/__tests__/helpers/user-db-fixture";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

describe.skipIf(!hasEnv)("stock-opnames/manage", () => {
  let fixture: UserDbFixture;
  let outletId: string;
  let employeeId: string;
  let ing1Id: string; // bahan A
  let ing2Id: string; // bahan B
  let ing3Id: string; // bahan C (parsial — tidak disentuh)
  const BUSINESS_DATE = "2026-09-15";

  beforeAll(async () => {
    fixture = await createUserDbFixture("TEST_OPNAME");
    const { db, businessId } = fixture;

    const [brand] = await db
      .insert(brands)
      .values({ businessId, name: "BrandOpname" })
      .returning({ id: brands.id });

    const [outletRow] = await db
      .insert(outlets)
      .values({
        businessId,
        brandId: brand!.id,
        code: "OPM",
        name: "Outlet Opname",
        // Override ambang variance ke nilai kecil supaya test bisa memicu wajib alasan
        varianceAlertValue: "1000", // Rp 1.000
        varianceAlertPercent: "5",  // 5%
      })
      .returning({ id: outlets.id });
    outletId = outletRow!.id;

    const [emp] = await db
      .insert(employees)
      .values({ businessId, code: "OPR1", fullName: "Petugas Opname", role: "warehouse", pinHash: null })
      .returning({ id: employees.id });
    employeeId = emp!.id;

    // Bahan A: stok nol di sistem (opname pertama)
    const [i1] = await db
      .insert(ingredients)
      .values({ businessId, name: "Bahan A", baseUnit: "gram", purchaseUnit: "kg", purchaseFactor: "1000" })
      .returning({ id: ingredients.id });
    ing1Id = i1!.id;

    // Bahan B: sudah punya stok (untuk test selisih)
    const [i2] = await db
      .insert(ingredients)
      .values({ businessId, name: "Bahan B", baseUnit: "pcs", purchaseUnit: "pack", purchaseFactor: "24" })
      .returning({ id: ingredients.id });
    ing2Id = i2!.id;

    // Seed stock_levels bahan B: qty=100, avg_cost=5000
    await db.insert(stockLevels).values({
      businessId,
      ingredientId: ing2Id,
      outletId,
      qtyOnHand: "100",
      avgCost: "5000",
    });

    // Bahan C: ada stok, TIDAK akan disentuh di opname parsial
    const [i3] = await db
      .insert(ingredients)
      .values({ businessId, name: "Bahan C", baseUnit: "liter", purchaseUnit: "dirigen", purchaseFactor: "20" })
      .returning({ id: ingredients.id });
    ing3Id = i3!.id;

    await db.insert(stockLevels).values({
      businessId,
      ingredientId: ing3Id,
      outletId,
      qtyOnHand: "50",
      avgCost: "8000",
    });
  });

  afterAll(async () => {
    if (fixture) {
      await fixture.cleanup();
    }
  });

  it("data fixture terbentuk sebelum tes berjalan", () => {
    expect(fixture.businessId).toBeTruthy();
    expect(outletId).toBeTruthy();
    expect(employeeId).toBeTruthy();
    expect(ing1Id).toBeTruthy();
    expect(ing2Id).toBeTruthy();
    expect(ing3Id).toBeTruthy();
  });

  // ─── Test 1: Opname pertama dari nol ───────────────────────────────────

  it("opname pertama: bahan tanpa stok sistem diisi dari harga default (material.csv)", async () => {
    const { db, businessId } = fixture;

    // Simulasi hargaDefault dari material.csv
    const hargaDefault = new Map([[ing1Id, "4800"], [ing2Id, "4500"]]);

    const opnameId = await createOpnameWithDb(db, {
      businessId,
      outletId,
      businessDate: BUSINESS_DATE,
      label: "Opname Pertama",
      createdByEmployeeId: employeeId,
    });

    // Buktikan hargaDefault (material.csv) sungguh dipakai sebagai saran
    // harga saat avg_cost belum ada (systemQty=0, opname pertama) -- bukan
    // cuma nilai yang kebetulan sama-sama diketik di upsert di bawah.
    const itemsBeforeFill = await getOpnameItemsForSession(db, {
      businessId,
      outletId,
      opnameId,
      hargaDefault,
    });
    const suggestedA = itemsBeforeFill.find((i) => i.ingredientId === ing1Id);
    expect(suggestedA?.unitCost).toBe("4800");

    // Isi bahan A (sistem qty = 0, fisik = 500 gram, harga dari CSV)
    await upsertOpnameItemWithDb(db, {
      businessId,
      outletId,
      opnameId,
      item: {
        ingredientId: ing1Id,
        physicalQty: "500",  // 500 gram ditemukan
        unitCost: "4800",    // dari material.csv
      },
    });

    const result = await submitOpnameWithDb(db, {
      businessId,
      outletId,
      opnameId,
      submittedByEmployeeId: employeeId,
      businessDate: BUSINESS_DATE,
    });

    expect(result.movementsCreated).toBe(1); // hanya bahan A (variance != 0)
    expect(result.itemsSkipped).toBe(0);

    // Cek stock_levels bahan A
    const [levelA] = await db
      .select({ qtyOnHand: stockLevels.qtyOnHand, avgCost: stockLevels.avgCost })
      .from(stockLevels)
      .where(and(eq(stockLevels.ingredientId, ing1Id), eq(stockLevels.outletId, outletId)));

    expect(parseFloat(levelA!.qtyOnHand)).toBeCloseTo(500);
    expect(parseFloat(levelA!.avgCost)).toBeCloseTo(4800);

    // Cek movement di ledger
    const [movement] = await db
      .select({
        movementType: stockMovements.movementType,
        qty: stockMovements.qty,
        unitCost: stockMovements.unitCost,
        refType: stockMovements.refType,
        refId: stockMovements.refId,
      })
      .from(stockMovements)
      .where(and(eq(stockMovements.ingredientId, ing1Id), eq(stockMovements.outletId, outletId)));

    expect(movement!.movementType).toBe("opname_adjust");
    expect(parseFloat(movement!.qty)).toBeCloseTo(500); // positif (+500)
    expect(movement!.refType).toBe("opname");
    expect(movement!.refId).toBe(opnameId);
  });

  // ─── Test 2: Opname parsial — bahan C tidak disentuh ──────────────────

  it("opname parsial: bahan yang tidak dihitung TIDAK berubah", async () => {
    const { db, businessId } = fixture;

    const opnameId = await createOpnameWithDb(db, {
      businessId,
      outletId,
      businessDate: BUSINESS_DATE,
      label: "Opname Parsial",
    });

    // Hanya isi bahan B, bahan C TIDAK disentuh
    await upsertOpnameItemWithDb(db, {
      businessId,
      outletId,
      opnameId,
      item: {
        ingredientId: ing2Id,
        physicalQty: "95",  // 95 pcs fisik vs 100 sistem → selisih -5
        unitCost: "5000",
      },
    });

    const result = await submitOpnameWithDb(db, {
      businessId,
      outletId,
      opnameId,
      submittedByEmployeeId: employeeId,
      businessDate: BUSINESS_DATE,
    });

    expect(result.movementsCreated).toBe(1);

    // Stok bahan C HARUS TETAP 50 liter — tidak terpengaruh
    const [levelC] = await db
      .select({ qtyOnHand: stockLevels.qtyOnHand })
      .from(stockLevels)
      .where(and(eq(stockLevels.ingredientId, ing3Id), eq(stockLevels.outletId, outletId)));

    expect(parseFloat(levelC!.qtyOnHand)).toBeCloseTo(50); // tidak berubah!
  });

  // ─── Test 3: Selisih negatif tercatat benar ────────────────────────────

  it("selisih negatif (kurang fisik) tercatat benar di ledger", async () => {
    const { db, businessId } = fixture;

    // Ambil stok bahan B sekarang (dari test sebelumnya menjadi 95)
    const [levelBefore] = await db
      .select({ qtyOnHand: stockLevels.qtyOnHand })
      .from(stockLevels)
      .where(and(eq(stockLevels.ingredientId, ing2Id), eq(stockLevels.outletId, outletId)));
    const qtyBefore = parseFloat(levelBefore!.qtyOnHand);

    const opnameId = await createOpnameWithDb(db, {
      businessId,
      outletId,
      businessDate: BUSINESS_DATE,
      label: "Test Selisih Negatif",
    });

    await upsertOpnameItemWithDb(db, {
      businessId,
      outletId,
      opnameId,
      item: {
        ingredientId: ing2Id,
        physicalQty: String(qtyBefore - 10), // -10 dari sistem
        unitCost: "5000",
      },
    });

    const result = await submitOpnameWithDb(db, {
      businessId,
      outletId,
      opnameId,
      submittedByEmployeeId: employeeId,
      businessDate: BUSINESS_DATE,
    });

    expect(result.movementsCreated).toBe(1);

    // Cek movement negatif
    const movements = await db
      .select({ qty: stockMovements.qty, movementType: stockMovements.movementType })
      .from(stockMovements)
      .where(and(eq(stockMovements.refId, opnameId), eq(stockMovements.outletId, outletId)));

    expect(movements.length).toBe(1);
    expect(parseFloat(movements[0]!.qty)).toBeLessThan(0); // negatif

    // Cek stock_levels berkurang
    const [levelAfter] = await db
      .select({ qtyOnHand: stockLevels.qtyOnHand })
      .from(stockLevels)
      .where(and(eq(stockLevels.ingredientId, ing2Id), eq(stockLevels.outletId, outletId)));

    expect(parseFloat(levelAfter!.qtyOnHand)).toBeCloseTo(qtyBefore - 10);
  });

  // ─── Test 4: Selisih positif tercatat benar ────────────────────────────

  it("selisih positif (lebih fisik) blend avg_cost dengan benar", async () => {
    const { db, businessId } = fixture;

    const [levelBefore] = await db
      .select({ qtyOnHand: stockLevels.qtyOnHand, avgCost: stockLevels.avgCost })
      .from(stockLevels)
      .where(and(eq(stockLevels.ingredientId, ing2Id), eq(stockLevels.outletId, outletId)));
    const qtyBefore = parseFloat(levelBefore!.qtyOnHand);
    const avgBefore = parseFloat(levelBefore!.avgCost);

    const opnameId = await createOpnameWithDb(db, {
      businessId,
      outletId,
      businessDate: BUSINESS_DATE,
      label: "Test Selisih Positif",
    });

    const addedQty = 20; // fisik lebih 20 pcs
    const newCost = 6000; // harga baru Rp 6.000

    await upsertOpnameItemWithDb(db, {
      businessId,
      outletId,
      opnameId,
      item: {
        ingredientId: ing2Id,
        physicalQty: String(qtyBefore + addedQty),
        unitCost: String(newCost),
      },
    });

    await submitOpnameWithDb(db, {
      businessId,
      outletId,
      opnameId,
      submittedByEmployeeId: employeeId,
      businessDate: BUSINESS_DATE,
    });

    const [levelAfter] = await db
      .select({ qtyOnHand: stockLevels.qtyOnHand, avgCost: stockLevels.avgCost })
      .from(stockLevels)
      .where(and(eq(stockLevels.ingredientId, ing2Id), eq(stockLevels.outletId, outletId)));

    expect(parseFloat(levelAfter!.qtyOnHand)).toBeCloseTo(qtyBefore + addedQty);

    // WAC: (qtyBefore * avgBefore + 20 * 6000) / (qtyBefore + 20)
    const expectedAvg = (qtyBefore * avgBefore + addedQty * newCost) / (qtyBefore + addedQty);
    expect(parseFloat(levelAfter!.avgCost)).toBeCloseTo(expectedAvg, 4);
  });

  // ─── Test 5: WRITE-ONCE — upsert setelah submitted DITOLAK ────────────

  it("write-once: upsert item setelah submitted DITOLAK", async () => {
    const { db, businessId } = fixture;

    const opnameId = await createOpnameWithDb(db, {
      businessId,
      outletId,
      businessDate: BUSINESS_DATE,
      label: "Test Write-Once Upsert",
    });

    await upsertOpnameItemWithDb(db, {
      businessId,
      outletId,
      opnameId,
      // Bahan A sudah punya systemQty=500 dari test opname pertama di atas.
      item: {
        ingredientId: ing1Id,
        physicalQty: "10",
        unitCost: "4800",
      },
    });

    await submitOpnameWithDb(db, {
      businessId,
      outletId,
      opnameId,
      submittedByEmployeeId: employeeId,
      businessDate: BUSINESS_DATE,
    });

    // Coba upsert lagi setelah submitted — harus DITOLAK
    await expect(
      upsertOpnameItemWithDb(db, {
        businessId,
        outletId,
        opnameId,
        item: { ingredientId: ing1Id, physicalQty: "999", unitCost: "4800" },
      })
    ).rejects.toThrow(/sudah disubmit/i);
  });

  // ─── Test 6: WRITE-ONCE — submit ulang DITOLAK ─────────────────────────

  it("write-once: submit ulang sesi yang sudah submitted DITOLAK", async () => {
    const { db, businessId } = fixture;

    const opnameId = await createOpnameWithDb(db, {
      businessId,
      outletId,
      businessDate: BUSINESS_DATE,
      label: "Test Write-Once Submit Ulang",
    });

    await submitOpnameWithDb(db, {
      businessId,
      outletId,
      opnameId,
      businessDate: BUSINESS_DATE,
    });

    await expect(
      submitOpnameWithDb(db, {
        businessId,
        outletId,
        opnameId,
        businessDate: BUSINESS_DATE,
      })
    ).rejects.toThrow(/sudah disubmit/i);
  });

  // ─── Test 7: Selisih besar TIDAK PERLU alasan (dihapus 18 September 2026) ──

  it("selisih besar TANPA alasan submit berhasil (aturan wajib alasan sudah dihapus)", async () => {
    const { db, businessId } = fixture;

    // Ambil stok bahan C (50 liter, avg_cost 8000)
    const [levelC] = await db
      .select({ qtyOnHand: stockLevels.qtyOnHand })
      .from(stockLevels)
      .where(and(eq(stockLevels.ingredientId, ing3Id), eq(stockLevels.outletId, outletId)));
    const qtyCurrent = parseFloat(levelC!.qtyOnHand);

    // Selisih besar: -30 liter × Rp 8.000 = Rp 240.000 -- dulu di atas
    // ambang outlet (Rp 1.000/5%) dan memaksa alasan. Sekarang TIDAK ADA
    // pemeriksaan ambang sama sekali -- submit langsung berhasil.
    const bigVarianceQty = qtyCurrent - 30;

    const opnameId = await createOpnameWithDb(db, {
      businessId,
      outletId,
      businessDate: BUSINESS_DATE,
      label: "Test Selisih Besar Tanpa Alasan",
    });

    await upsertOpnameItemWithDb(db, {
      businessId,
      outletId,
      opnameId,
      item: {
        ingredientId: ing3Id,
        physicalQty: String(bigVarianceQty),
        unitCost: "8000",
      },
    });

    const result = await submitOpnameWithDb(db, {
      businessId,
      outletId,
      opnameId,
      businessDate: BUSINESS_DATE,
    });

    expect(result.movementsCreated).toBe(1);
  });

  // ─── Test 8: Submit tanpa item sama sekali ──────────────────────────────

  it("submit sesi tanpa item sama sekali berhasil (0 movement)", async () => {
    const { db, businessId } = fixture;

    const opnameId = await createOpnameWithDb(db, {
      businessId,
      outletId,
      businessDate: BUSINESS_DATE,
      label: "Test Sesi Kosong",
    });

    const result = await submitOpnameWithDb(db, {
      businessId,
      outletId,
      opnameId,
      businessDate: BUSINESS_DATE,
    });

    expect(result.movementsCreated).toBe(0);
    expect(result.itemsSkipped).toBe(0);

    // Pastikan sesi memang terkunci submitted
    const [opname] = await db
      .select({ status: stockOpnames.status })
      .from(stockOpnames)
      .where(eq(stockOpnames.id, opnameId));
    expect(opname!.status).toBe("submitted");
  });

  // ─── Test 9: getOpnameItemsForSession menampilkan semua bahan ───────────

  it("getOpnameItemsForSession mengembalikan SEMUA bahan aktif bisnis", async () => {
    const { db, businessId } = fixture;

    const opnameId = await createOpnameWithDb(db, {
      businessId,
      outletId,
      businessDate: BUSINESS_DATE,
      label: "Test Get Items",
    });

    const items = await getOpnameItemsForSession(db, {
      businessId,
      outletId,
      opnameId,
    });

    // Harus ada semua 3 bahan (ing1, ing2, ing3)
    expect(items.length).toBeGreaterThanOrEqual(3);
    const ids = items.map((i) => i.ingredientId);
    expect(ids).toContain(ing1Id);
    expect(ids).toContain(ing2Id);
    expect(ids).toContain(ing3Id);

    // Bahan yang belum dihitung: physicalQty = null
    const itemA = items.find((i) => i.ingredientId === ing1Id)!;
    expect(itemA.physicalQty).toBeNull();
  });

  // ─── Test 10: Bulk upsert (Simpan Semua, 18 September 2026) ────────────

  it("upsertOpnameItemsBulkWithDb: banyak baris sekaligus, systemQty snapshot benar, submit normal", async () => {
    const { db, businessId } = fixture;

    const opnameId = await createOpnameWithDb(db, {
      businessId,
      outletId,
      businessDate: BUSINESS_DATE,
      label: "Test Bulk Upsert",
    });

    const [levelBBefore] = await db
      .select({ qtyOnHand: stockLevels.qtyOnHand })
      .from(stockLevels)
      .where(and(eq(stockLevels.ingredientId, ing2Id), eq(stockLevels.outletId, outletId)));
    const qtyBBefore = parseFloat(levelBBefore!.qtyOnHand);

    // Satu panggilan, dua bahan sekaligus -- ing1 (systemQty snapshot lama
    // dari test-test sebelumnya, bukan 0 lagi) dan ing2.
    const { saved } = await upsertOpnameItemsBulkWithDb(db, {
      businessId,
      outletId,
      opnameId,
      items: [
        { ingredientId: ing1Id, physicalQty: "12", unitCost: "4800" },
        { ingredientId: ing2Id, physicalQty: String(qtyBBefore + 3), unitCost: "5000" },
      ],
    });
    expect(saved).toBe(2);

    const items = await getOpnameItemsForSession(db, { businessId, outletId, opnameId });
    const itemA = items.find((i) => i.ingredientId === ing1Id)!;
    const itemB = items.find((i) => i.ingredientId === ing2Id)!;
    expect(itemA.physicalQty).toBe("12.0000");
    expect(itemB.physicalQty).toBe(`${(qtyBBefore + 3).toFixed(4)}`);

    // Panggil bulk lagi dengan HANYA ing1 diubah -- ing2 TIDAK disentuh di
    // panggilan ini, tapi baris sebelumnya (dari panggilan pertama) tetap
    // utuh (bukan slot tetap yang saling menimpa/menghapus).
    await upsertOpnameItemsBulkWithDb(db, {
      businessId,
      outletId,
      opnameId,
      items: [{ ingredientId: ing1Id, physicalQty: "15", unitCost: "4800" }],
    });
    const itemsAfter = await getOpnameItemsForSession(db, { businessId, outletId, opnameId });
    expect(itemsAfter.find((i) => i.ingredientId === ing1Id)!.physicalQty).toBe("15.0000");
    expect(itemsAfter.find((i) => i.ingredientId === ing2Id)!.physicalQty).toBe(`${(qtyBBefore + 3).toFixed(4)}`);

    const result = await submitOpnameWithDb(db, {
      businessId,
      outletId,
      opnameId,
      submittedByEmployeeId: employeeId,
      businessDate: BUSINESS_DATE,
    });
    expect(result.movementsCreated).toBe(2);
  });

  it("upsertOpnameItemsBulkWithDb: write-once -- ditolak kalau sesi sudah submitted", async () => {
    const { db, businessId } = fixture;

    const opnameId = await createOpnameWithDb(db, {
      businessId,
      outletId,
      businessDate: BUSINESS_DATE,
      label: "Test Bulk Write-Once",
    });

    await submitOpnameWithDb(db, {
      businessId,
      outletId,
      opnameId,
      businessDate: BUSINESS_DATE,
    });

    await expect(
      upsertOpnameItemsBulkWithDb(db, {
        businessId,
        outletId,
        opnameId,
        items: [{ ingredientId: ing1Id, physicalQty: "999", unitCost: "4800" }],
      })
    ).rejects.toThrow(/sudah disubmit/i);
  });
});
