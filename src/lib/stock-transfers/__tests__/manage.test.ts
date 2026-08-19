/**
 * T22 -- penerimaan barang dari gudang + pembatalan. Lewat getUserDb()
 * (via createUserDbFixture), BUKAN getAdminDb() -- lihat komentar di
 * lib/categories/__tests__/manage.test.ts untuk alasannya; ini jalur yang
 * sama seperti dashboard sungguhan, termasuk trigger check_transfer_*
 * dan RLS UPDATE stock_transfers_update yang WAJIB terbukti benar-benar
 * bekerja, bukan cuma "terlihat benar" dari pembacaan kode.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
import { and, eq } from "drizzle-orm";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import {
  employees,
  ingredients,
  outlets,
  stockLevels,
  stockMovements,
  stockTransferItems,
  stockTransfers,
  units,
} from "@/lib/db/schema";
import { cancelStockTransferWithDb, receiveStockTransferWithDb } from "../manage";
import { createUserDbFixture, type UserDbFixture } from "@/lib/db/__tests__/helpers/user-db-fixture";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

describe.skipIf(!hasEnv)("stock-transfers/manage", () => {
  let fixture: UserDbFixture;
  let centralKitchenId: string;
  let retailOutletId: string;
  let employeeId: string;
  let ingredientPcsId: string; // baseUnit pcs, purchaseUnit dus (factor 12)

  beforeAll(async () => {
    fixture = await createUserDbFixture("TEST_STOCKTRANSFERS");
    const { db, businessId } = fixture;

    const [ck] = await db
      .insert(outlets)
      .values({ businessId, code: "CK1", name: "Gudang", isCentralKitchen: true })
      .returning({ id: outlets.id });
    centralKitchenId = ck!.id;

    const [retail] = await db
      .insert(outlets)
      .values({ businessId, code: "R1", name: "Outlet Retail" })
      .returning({ id: outlets.id });
    retailOutletId = retail!.id;

    const [emp] = await db
      .insert(employees)
      .values({ businessId, code: "STF1", fullName: "Staf Gudang", role: "warehouse", pinHash: null })
      .returning({ id: employees.id });
    employeeId = emp!.id;

    await db.insert(units).values([
      { businessId, code: "pcs", name: "Pcs", baseUnit: "pcs", factor: "1" },
      { businessId, code: "dus", name: "Dus", baseUnit: "pcs", factor: "1" }, // factor units tidak dipakai T22 (pakai purchaseFactor ingredient)
    ]);

    const [ing] = await db
      .insert(ingredients)
      .values({
        businessId,
        name: "Cup 12oz",
        baseUnit: "pcs",
        purchaseUnit: "dus",
        purchaseFactor: "12",
      })
      .returning({ id: ingredients.id });
    ingredientPcsId = ing!.id;
  });

  afterAll(async () => {
    // fixture.cleanup() menemukan & menghapus tabel penghalang (stock_
    // movements, stock_transfers, stock_transfer_items, dkk, FK ON DELETE
    // NO ACTION ke businesses) secara otomatis lewat information_schema --
    // lihat lib/db/__tests__/helpers/user-db-fixture.ts.
    if (fixture) {
      await fixture.cleanup();
    }
  });

  it("data uji benar-benar terbentuk sebelum diuji (bukan hijau karena kosong)", () => {
    expect(fixture.businessId).toBeTruthy();
    expect(centralKitchenId).toBeTruthy();
    expect(retailOutletId).toBeTruthy();
    expect(employeeId).toBeTruthy();
    expect(ingredientPcsId).toBeTruthy();
  });

  it("penerimaan berhasil dengan satuan beli (dus) -- konversi ke base_unit benar, entered_* tersimpan mentah", async () => {
    const { db, businessId } = fixture;
    const result = await receiveStockTransferWithDb(db, businessId, {
      toOutletId: retailOutletId,
      number: "SJ-001",
      receivedBy: employeeId,
      lines: [
        { ingredientId: ingredientPcsId, enteredUnitChoice: "purchase", enteredQty: 5, enteredUnitCost: 24000 },
      ],
    });
    expect(result.success).toBeTruthy();
    expect(result.error).toBeUndefined();

    const [item] = await db
      .select()
      .from(stockTransferItems)
      .where(eq(stockTransferItems.transferId, result.success!.transferId));
    expect(item!.enteredUnit).toBe("dus");
    expect(item!.enteredQty).toBe("5.0000");
    expect(Number(item!.enteredUnitCost)).toBe(24000);
    expect(Number(item!.qty)).toBe(60); // 5 dus x 12 = 60 pcs
    expect(Number(item!.unitCost)).toBe(2000); // 24000/12 per pcs

    const [level] = await db
      .select()
      .from(stockLevels)
      .where(and(eq(stockLevels.ingredientId, ingredientPcsId), eq(stockLevels.outletId, retailOutletId)));
    expect(Number(level!.qtyOnHand)).toBe(60);
    expect(Number(level!.avgCost)).toBe(2000);

    const [movement] = await db
      .select()
      .from(stockMovements)
      .where(eq(stockMovements.refId, result.success!.transferId));
    expect(movement!.movementType).toBe("transfer_in");
    expect(Number(movement!.qty)).toBe(60);
    expect(Number(movement!.balanceAfter)).toBe(60);
  });

  it("penerimaan dengan satuan dasar (pcs langsung, bukan dus) -- factor 1, tidak dikonversi", async () => {
    const { db, businessId } = fixture;
    const result = await receiveStockTransferWithDb(db, businessId, {
      toOutletId: retailOutletId,
      number: "SJ-002",
      receivedBy: employeeId,
      lines: [
        { ingredientId: ingredientPcsId, enteredUnitChoice: "base", enteredQty: 5, enteredUnitCost: 2500 },
      ],
    });
    expect(result.success).toBeTruthy();

    const [item] = await db
      .select()
      .from(stockTransferItems)
      .where(eq(stockTransferItems.transferId, result.success!.transferId));
    expect(item!.enteredUnit).toBe("pcs");
    expect(Number(item!.qty)).toBe(5); // langsung, tidak dikali factor
    expect(Number(item!.unitCost)).toBe(2500);
  });

  it("gudang pusat belum diatur -- DITOLAK dengan pesan jelas", async () => {
    const noWarehouseFixture = await createUserDbFixture("TEST_STOCKTRANSFERS_NOCK");
    try {
      const { db, businessId } = noWarehouseFixture;
      const [retail] = await db
        .insert(outlets)
        .values({ businessId, code: "R1", name: "Outlet" })
        .returning({ id: outlets.id });
      const [emp] = await db
        .insert(employees)
        .values({ businessId, code: "STF", fullName: "Staf", role: "warehouse", pinHash: null })
        .returning({ id: employees.id });
      const [ing] = await db
        .insert(ingredients)
        .values({ businessId, name: "Bahan", baseUnit: "g", purchaseUnit: "kg", purchaseFactor: "1000" })
        .returning({ id: ingredients.id });

      const result = await receiveStockTransferWithDb(db, businessId, {
        toOutletId: retail!.id,
        number: "SJ-003",
        receivedBy: emp!.id,
        lines: [{ ingredientId: ing!.id, enteredUnitChoice: "purchase", enteredQty: 1, enteredUnitCost: 10000 }],
      });
      expect(result.error).toBe(
        "Gudang pusat belum diatur -- outlet dengan status gudang pusat belum ada. Hubungi developer untuk mengaturnya."
      );
    } finally {
      await noWarehouseFixture.cleanup();
    }
  });

  it("pembatalan: TANPA pemakaian di antaranya -- saldo & avg_cost kembali seperti sebelum penerimaan, movement transfer_cancel ditulis dengan qty penuh & unit_cost ASLI", async () => {
    const { db, businessId } = fixture;
    const received = await receiveStockTransferWithDb(db, businessId, {
      toOutletId: retailOutletId,
      number: "SJ-CANCEL-1",
      receivedBy: employeeId,
      lines: [
        { ingredientId: ingredientPcsId, enteredUnitChoice: "purchase", enteredQty: 2, enteredUnitCost: 24000 },
      ],
    });
    const transferId = received.success!.transferId;

    const [levelBefore] = await db
      .select()
      .from(stockLevels)
      .where(and(eq(stockLevels.ingredientId, ingredientPcsId), eq(stockLevels.outletId, retailOutletId)));
    const qtyBefore = Number(levelBefore!.qtyOnHand);

    const cancelResult = await cancelStockTransferWithDb(db, businessId, {
      transferId,
      reason: "Salah input jumlah dus",
      cancelledBy: employeeId,
    });
    expect(cancelResult.success).toBeTruthy();
    expect(cancelResult.warnings).toBeUndefined(); // tidak ada pemakaian, tidak boleh ada peringatan

    const [transferRow] = await db.select().from(stockTransfers).where(eq(stockTransfers.id, transferId));
    expect(transferRow!.status).toBe("cancelled");
    expect(transferRow!.cancelReason).toBe("Salah input jumlah dus");
    expect(transferRow!.cancelledBy).toBe(employeeId);
    expect(transferRow!.cancelledAt).toBeTruthy();

    const [levelAfter] = await db
      .select()
      .from(stockLevels)
      .where(and(eq(stockLevels.ingredientId, ingredientPcsId), eq(stockLevels.outletId, retailOutletId)));
    expect(Number(levelAfter!.qtyOnHand)).toBe(qtyBefore - 24); // 2 dus x 12 = 24 pcs dibalik penuh

    const [cancelMovement] = await db
      .select()
      .from(stockMovements)
      .where(and(eq(stockMovements.refId, transferId), eq(stockMovements.movementType, "transfer_cancel")));
    expect(Number(cancelMovement!.qty)).toBe(-24);
    expect(Number(cancelMovement!.unitCost)).toBe(2000); // unit_cost ASLI (24000/12), bukan avg_cost gabungan saat ini

    // Baris penerimaan ASLI tidak berubah sama sekali.
    const [originalItem] = await db
      .select()
      .from(stockTransferItems)
      .where(eq(stockTransferItems.transferId, transferId));
    expect(Number(originalItem!.qty)).toBe(24);
  });

  it("pembatalan setelah sebagian bahan terpakai -- saldo boleh minus, peringatan dikembalikan dengan ingredient & jumlah yang benar", async () => {
    const { db, businessId } = fixture;

    // Bahan KHUSUS untuk test ini, TIDAK dipakai test lain -- ingredientPcsId
    // dipakai bergantian di banyak test sebelumnya (menumpuk ~65pcs stok
    // sebelum test ini sempat jalan), jadi mensimulasikan "8 terjual" dari
    // 10 yang diterima TIDAK PERNAH benar-benar membuat saldo minus kalau
    // dihitung dari stok gabungan itu (2 dus + sisa lain jauh lebih besar
    // dari 10 yang mau dibalik). Test awal ini SALAH menyiapkan kondisi --
    // baru ketahuan lewat run sungguhan, bukan cuma asumsi. Bahan baru di
    // sini menjamin qtyLama benar-benar dimulai dari nol.
    const [freshIngredient] = await db
      .insert(ingredients)
      .values({ businessId, name: "Bahan Uji Saldo Minus", baseUnit: "pcs", purchaseUnit: "pcs", purchaseFactor: "1" })
      .returning({ id: ingredients.id });
    const freshIngredientId = freshIngredient!.id;

    const received = await receiveStockTransferWithDb(db, businessId, {
      toOutletId: retailOutletId,
      number: "SJ-CANCEL-2",
      receivedBy: employeeId,
      lines: [
        { ingredientId: freshIngredientId, enteredUnitChoice: "base", enteredQty: 10, enteredUnitCost: 2000 },
      ],
    });
    const transferId = received.success!.transferId;

    const [levelAfterReceive] = await db
      .select()
      .from(stockLevels)
      .where(and(eq(stockLevels.ingredientId, freshIngredientId), eq(stockLevels.outletId, retailOutletId)));
    expect(Number(levelAfterReceive!.qtyOnHand)).toBe(10); // bukti qtyLama benar-benar 10, bukan tercampur test lain

    // Simulasi 8 pcs sudah terjual (fitur penjualan bahan belum dibangun,
    // T25 -- tulis movement 'sale' + update stock_levels manual, sama
    // seperti yang nanti akan dilakukan payOrderWithDb). Sisa: 10-8=2.
    await db.insert(stockMovements).values({
      businessId,
      outletId: retailOutletId,
      ingredientId: freshIngredientId,
      movementType: "sale",
      qty: "-8",
      unitCost: levelAfterReceive!.avgCost,
      totalCost: (Number(levelAfterReceive!.avgCost) * -8).toFixed(2),
      balanceAfter: "2",
      avgCostAfter: levelAfterReceive!.avgCost,
      businessDate: "2026-08-17",
    });
    await db
      .update(stockLevels)
      .set({ qtyOnHand: "2" })
      .where(and(eq(stockLevels.ingredientId, freshIngredientId), eq(stockLevels.outletId, retailOutletId)));

    // Sisa 2, tapi pembatalan membalik PENUH 10 (bukan disesuaikan) -> 2-10=-8.
    const cancelResult = await cancelStockTransferWithDb(db, businessId, {
      transferId,
      reason: "Ternyata dus rusak, batal terima",
      cancelledBy: employeeId,
    });
    expect(cancelResult.success).toBeTruthy();
    expect(cancelResult.warnings).toBeTruthy();
    expect(cancelResult.warnings!.length).toBe(1);
    expect(cancelResult.warnings![0]!.ingredientId).toBe(freshIngredientId);
    expect(cancelResult.warnings![0]!.ingredientName).toBe("Bahan Uji Saldo Minus");
    expect(cancelResult.warnings![0]!.baseUnit).toBe("pcs");

    const [levelAfter] = await db
      .select()
      .from(stockLevels)
      .where(and(eq(stockLevels.ingredientId, freshIngredientId), eq(stockLevels.outletId, retailOutletId)));
    expect(Number(levelAfter!.qtyOnHand)).toBe(-8);
    expect(cancelResult.warnings![0]!.resultingQty).toBe(levelAfter!.qtyOnHand);

    const [auditRow] = await db
      .select()
      .from(stockMovements)
      .where(and(eq(stockMovements.refId, transferId), eq(stockMovements.movementType, "transfer_cancel")));
    expect(Number(auditRow!.qty)).toBe(-10); // qty PENUH dibalik, bukan disesuaikan dengan sisa 2
  });

  it("pembatalan ganda (sudah 'cancelled') -- DITOLAK, bukan diam-diam berhasil lagi", async () => {
    const { db, businessId } = fixture;
    const received = await receiveStockTransferWithDb(db, businessId, {
      toOutletId: retailOutletId,
      number: "SJ-CANCEL-3",
      receivedBy: employeeId,
      lines: [
        { ingredientId: ingredientPcsId, enteredUnitChoice: "base", enteredQty: 1, enteredUnitCost: 2000 },
      ],
    });
    const transferId = received.success!.transferId;

    const first = await cancelStockTransferWithDb(db, businessId, {
      transferId,
      reason: "Alasan pertama",
      cancelledBy: employeeId,
    });
    expect(first.success).toBeTruthy();

    const second = await cancelStockTransferWithDb(db, businessId, {
      transferId,
      reason: "Coba batalkan lagi",
      cancelledBy: employeeId,
    });
    expect(second.error).toBe("Penerimaan ini sudah dibatalkan atau tidak ditemukan");
  });

  it("kolom selain status/cancel_reason/cancelled_at/cancelled_by TIDAK BISA diubah lewat UPDATE (trigger check_stock_transfer_cancel_only)", async () => {
    const { db, businessId } = fixture;
    const received = await receiveStockTransferWithDb(db, businessId, {
      toOutletId: retailOutletId,
      number: "SJ-IMMUTABLE",
      receivedBy: employeeId,
      lines: [
        { ingredientId: ingredientPcsId, enteredUnitChoice: "base", enteredQty: 1, enteredUnitCost: 2000 },
      ],
    });
    const transferId = received.success!.transferId;

    await expect(
      db
        .update(stockTransfers)
        .set({ number: "DIUBAH-PAKSA" })
        .where(and(eq(stockTransfers.id, transferId), eq(stockTransfers.businessId, businessId)))
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        message: expect.stringMatching(/tidak bisa diubah setelah dibuat/),
      }),
    });
  });
});
