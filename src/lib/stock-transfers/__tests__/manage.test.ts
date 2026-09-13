/**
 * T22 -- transfer stok dua sisi: requested -> approved -> sent ->
 * received, dengan rejected (dari requested) dan cancelled (dari
 * requested/approved/received, TIDAK dari sent). Lewat getUserDb() (via
 * createUserDbFixture), BUKAN getAdminDb() -- ini jalur yang sama seperti
 * dashboard sungguhan, termasuk trigger check_stock_transfer_transition,
 * check_transfer_item_immutable_core, dan RLS UPDATE yang WAJIB terbukti
 * benar-benar bekerja, bukan cuma "terlihat benar" dari pembacaan kode.
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
  stockTransferItems,
  stockTransfers,
} from "@/lib/db/schema";
import {
  approveStockTransferWithDb,
  cancelStockTransferWithDb,
  getLastRequestForOutlet,
  receiveStockTransferWithDb,
  rejectStockTransferWithDb,
  requestStockTransferWithDb,
  sendStockTransferWithDb,
} from "../manage";
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

  beforeAll(async () => {
    fixture = await createUserDbFixture("TEST_STOCKTRANSFERS");
    const { db, businessId } = fixture;

    const [brand] = await db.insert(brands).values({ businessId, name: "brand" }).returning({ id: brands.id });
    const brandId = brand!.id;

    const [ck] = await db
      .insert(outlets)
      .values({ businessId, brandId, code: "CK1", name: "Gudang", isCentralKitchen: true })
      .returning({ id: outlets.id });
    centralKitchenId = ck!.id;

    const [retail] = await db
      .insert(outlets)
      .values({ businessId, brandId, code: "R1", name: "Outlet Retail" })
      .returning({ id: outlets.id });
    retailOutletId = retail!.id;

    const [emp] = await db
      .insert(employees)
      .values({ businessId, code: "STF1", fullName: "Staf Gudang", role: "warehouse", pinHash: null })
      .returning({ id: employees.id });
    employeeId = emp!.id;
  });

  afterAll(async () => {
    if (fixture) {
      await fixture.cleanup();
    }
  });

  async function insertIngredient(name: string, purchaseFactor = "1") {
    const { db, businessId } = fixture;
    const [ing] = await db
      .insert(ingredients)
      .values({
        businessId,
        name,
        baseUnit: "pcs",
        purchaseUnit: purchaseFactor === "1" ? "pcs" : "dus",
        purchaseFactor,
      })
      .returning({ id: ingredients.id });
    return ing!.id;
  }

  it("data uji benar-benar terbentuk sebelum diuji (bukan hijau karena kosong)", () => {
    expect(fixture.businessId).toBeTruthy();
    expect(centralKitchenId).toBeTruthy();
    expect(retailOutletId).toBeTruthy();
    expect(employeeId).toBeTruthy();
  });

  it("gudang pusat belum diatur -- request DITOLAK dengan pesan jelas", async () => {
    const noWarehouseFixture = await createUserDbFixture("TEST_STOCKTRANSFERS_NOCK");
    try {
      const { db, businessId } = noWarehouseFixture;
      const [brand] = await db.insert(brands).values({ businessId, name: "brand" }).returning({ id: brands.id });
      const [retail] = await db
        .insert(outlets)
        .values({ businessId, brandId: brand!.id, code: "R1", name: "Outlet" })
        .returning({ id: outlets.id });
      const [emp] = await db
        .insert(employees)
        .values({ businessId, code: "STF", fullName: "Staf", role: "cashier", pinHash: null })
        .returning({ id: employees.id });
      const ingId = await (async () => {
        const [ing] = await db
          .insert(ingredients)
          .values({ businessId, name: "Bahan", baseUnit: "g", purchaseUnit: "kg", purchaseFactor: "1000" })
          .returning({ id: ingredients.id });
        return ing!.id;
      })();

      const result = await requestStockTransferWithDb(db, businessId, null, {
        toOutletId: retail!.id,
        requestedBy: emp!.id,
        lines: [{ ingredientId: ingId, unitChoice: "purchase", qty: 1 }],
      });
      expect(result.error).toBe(
        "Gudang pusat belum diatur -- outlet dengan status gudang pusat belum ada. Hubungi developer untuk mengaturnya."
      );
    } finally {
      await noWarehouseFixture.cleanup();
    }
  });

  it("siklus penuh: request -> approve -> send (sesuai permintaan) -> receive (sesuai kiriman) -- ledger gudang & outlet benar, TANPA transfer_loss", async () => {
    const { db, businessId } = fixture;
    const ingId = await insertIngredient("Cup 12oz Siklus Penuh", "12");

    const requested = await requestStockTransferWithDb(db, businessId, null, {
      toOutletId: retailOutletId,
      requestedBy: employeeId,
      lines: [{ ingredientId: ingId, unitChoice: "purchase", qty: 5 }], // 5 dus = 60 pcs
    });
    expect(requested.success).toBeTruthy();
    const transferId = requested.success!.transferId;

    const [afterRequest] = await db.select().from(stockTransfers).where(eq(stockTransfers.id, transferId));
    expect(afterRequest!.status).toBe("requested");
    expect(afterRequest!.requestedBy).toBe(employeeId);

    const approved = await approveStockTransferWithDb(db, businessId, null, { transferId, actorId: employeeId });
    expect(approved.success).toBeTruthy();
    const [afterApprove] = await db.select().from(stockTransfers).where(eq(stockTransfers.id, transferId));
    expect(afterApprove!.status).toBe("approved");
    expect(afterApprove!.approvedBy).toBe(employeeId);

    const [item] = await db
      .select()
      .from(stockTransferItems)
      .where(eq(stockTransferItems.transferId, transferId));

    const sent = await sendStockTransferWithDb(db, businessId, null, {
      transferId,
      sentBy: employeeId,
      lines: [{ itemId: item!.id, unitChoice: "purchase", qty: 5, unitCost: 24000 }], // sesuai permintaan
    });
    expect(sent.success).toBeTruthy();

    const [gudangLevel] = await db
      .select()
      .from(stockLevels)
      .where(and(eq(stockLevels.ingredientId, ingId), eq(stockLevels.outletId, centralKitchenId)));
    expect(Number(gudangLevel!.qtyOnHand)).toBe(-60); // belum ada barang masuk gudang (T22d belum dibangun) -- minus, sesuai desain

    const [outMovement] = await db
      .select()
      .from(stockMovements)
      .where(and(eq(stockMovements.refId, transferId), eq(stockMovements.movementType, "transfer_out")));
    expect(Number(outMovement!.qty)).toBe(-60);

    const received = await receiveStockTransferWithDb(db, businessId, null, {
      transferId,
      receivedBy: employeeId,
      lines: [{ itemId: item!.id, receivedQty: 5 }], // sesuai kiriman (satuan sama: dus)
    });
    expect(received.success).toBeTruthy();
    expect(received.discrepancies).toBeUndefined();

    const [transferFinal] = await db.select().from(stockTransfers).where(eq(stockTransfers.id, transferId));
    expect(transferFinal!.status).toBe("received");

    const [retailLevel] = await db
      .select()
      .from(stockLevels)
      .where(and(eq(stockLevels.ingredientId, ingId), eq(stockLevels.outletId, retailOutletId)));
    expect(Number(retailLevel!.qtyOnHand)).toBe(60);
    expect(Number(retailLevel!.avgCost)).toBe(2000); // 24000/12

    const lossMovements = await db
      .select()
      .from(stockMovements)
      .where(and(eq(stockMovements.refId, transferId), eq(stockMovements.movementType, "transfer_loss")));
    expect(lossMovements.length).toBe(0);
  });

  it("send beda dari requested TANPA alasan -- DITOLAK server", async () => {
    const { db, businessId } = fixture;
    const ingId = await insertIngredient("Bahan Send Tanpa Alasan");

    const requested = await requestStockTransferWithDb(db, businessId, null, {
      toOutletId: retailOutletId,
      requestedBy: employeeId,
      lines: [{ ingredientId: ingId, unitChoice: "base", qty: 20 }],
    });
    const transferId = requested.success!.transferId;
    await approveStockTransferWithDb(db, businessId, null, { transferId, actorId: employeeId });
    const [item] = await db.select().from(stockTransferItems).where(eq(stockTransferItems.transferId, transferId));

    const sent = await sendStockTransferWithDb(db, businessId, null, {
      transferId,
      sentBy: employeeId,
      lines: [{ itemId: item!.id, unitChoice: "base", qty: 15, unitCost: 1000 }], // beda dari 20, tanpa diffReason
    });
    expect(sent.error).toBeTruthy();
  });

  it("send beda dari requested DENGAN alasan -- berhasil, send_diff_reason tersimpan", async () => {
    const { db, businessId } = fixture;
    const ingId = await insertIngredient("Bahan Send Dengan Alasan");

    const requested = await requestStockTransferWithDb(db, businessId, null, {
      toOutletId: retailOutletId,
      requestedBy: employeeId,
      lines: [{ ingredientId: ingId, unitChoice: "base", qty: 20 }],
    });
    const transferId = requested.success!.transferId;
    await approveStockTransferWithDb(db, businessId, null, { transferId, actorId: employeeId });
    const [item] = await db.select().from(stockTransferItems).where(eq(stockTransferItems.transferId, transferId));

    const sent = await sendStockTransferWithDb(db, businessId, null, {
      transferId,
      sentBy: employeeId,
      lines: [
        {
          itemId: item!.id,
          unitChoice: "base",
          qty: 15,
          unitCost: 1000,
          diffReason: "Stok gudang cuma tersisa 15",
        },
      ],
    });
    expect(sent.success).toBeTruthy();

    const [itemAfter] = await db.select().from(stockTransferItems).where(eq(stockTransferItems.id, item!.id));
    expect(Number(itemAfter!.sentQty)).toBe(15);
    expect(itemAfter!.sendDiffReason).toBe("Stok gudang cuma tersisa 15");
  });

  it("receive beda dari sent TANPA alasan -- DITOLAK server", async () => {
    const { db, businessId } = fixture;
    const ingId = await insertIngredient("Bahan Receive Tanpa Alasan");
    const requested = await requestStockTransferWithDb(db, businessId, null, {
      toOutletId: retailOutletId,
      requestedBy: employeeId,
      lines: [{ ingredientId: ingId, unitChoice: "base", qty: 10 }],
    });
    const transferId = requested.success!.transferId;
    await approveStockTransferWithDb(db, businessId, null, { transferId, actorId: employeeId });
    const [item] = await db.select().from(stockTransferItems).where(eq(stockTransferItems.transferId, transferId));
    await sendStockTransferWithDb(db, businessId, null, {
      transferId,
      sentBy: employeeId,
      lines: [{ itemId: item!.id, unitChoice: "base", qty: 10, unitCost: 1000 }],
    });

    const received = await receiveStockTransferWithDb(db, businessId, null, {
      transferId,
      receivedBy: employeeId,
      lines: [{ itemId: item!.id, receivedQty: 7 }], // beda dari 10, tanpa alasan
    });
    expect(received.error).toBeTruthy();
  });

  it("receive beda dari sent DENGAN alasan -- transfer_loss tercatat TAPI TIDAK mengubah saldo lagi (sudah benar dari transfer_in)", async () => {
    const { db, businessId } = fixture;
    const ingId = await insertIngredient("Bahan Selisih Kirim Terima");
    const requested = await requestStockTransferWithDb(db, businessId, null, {
      toOutletId: retailOutletId,
      requestedBy: employeeId,
      lines: [{ ingredientId: ingId, unitChoice: "base", qty: 20 }],
    });
    const transferId = requested.success!.transferId;
    await approveStockTransferWithDb(db, businessId, null, { transferId, actorId: employeeId });
    const [item] = await db.select().from(stockTransferItems).where(eq(stockTransferItems.transferId, transferId));
    await sendStockTransferWithDb(db, businessId, null, {
      transferId,
      sentBy: employeeId,
      lines: [{ itemId: item!.id, unitChoice: "base", qty: 20, unitCost: 1000 }],
    });

    const received = await receiveStockTransferWithDb(db, businessId, null, {
      transferId,
      receivedBy: employeeId,
      lines: [{ itemId: item!.id, receivedQty: 15, diffReason: "3 pecah, 2 hilang di jalan" }],
    });
    expect(received.success).toBeTruthy();
    expect(received.discrepancies).toBeTruthy();
    expect(received.discrepancies!.length).toBe(1);
    expect(Number(received.discrepancies![0]!.lossValue)).toBe(5000); // 5 pcs x 1000

    const [retailLevel] = await db
      .select()
      .from(stockLevels)
      .where(and(eq(stockLevels.ingredientId, ingId), eq(stockLevels.outletId, retailOutletId)));
    expect(Number(retailLevel!.qtyOnHand)).toBe(15); // received_qty, BUKAN sent_qty

    const [inMovement] = await db
      .select()
      .from(stockMovements)
      .where(and(eq(stockMovements.refId, transferId), eq(stockMovements.movementType, "transfer_in")));
    const [lossMovement] = await db
      .select()
      .from(stockMovements)
      .where(and(eq(stockMovements.refId, transferId), eq(stockMovements.movementType, "transfer_loss")));
    expect(Number(lossMovement!.qty)).toBe(-5);
    expect(Number(lossMovement!.totalCost)).toBe(-5000);
    // balance_after transfer_loss SAMA PERSIS dengan transfer_in -- TIDAK
    // dikurangi lagi. Ini inti dari keputusan "transfer_loss cuma catatan
    // nilai, bukan koreksi saldo" (docs/04-CATATAN-TEKNIS.md).
    expect(lossMovement!.balanceAfter).toBe(inMovement!.balanceAfter);
  });

  it("reject: status requested -> rejected, alasan wajib, tidak bisa di-approve setelahnya", async () => {
    const { db, businessId } = fixture;
    const ingId = await insertIngredient("Bahan Ditolak");
    const requested = await requestStockTransferWithDb(db, businessId, null, {
      toOutletId: retailOutletId,
      requestedBy: employeeId,
      lines: [{ ingredientId: ingId, unitChoice: "base", qty: 5 }],
    });
    const transferId = requested.success!.transferId;

    const rejected = await rejectStockTransferWithDb(db, businessId, null, {
      transferId,
      actorId: employeeId,
      reason: "Tidak perlu, sudah dikirim outlet lain",
    });
    expect(rejected.success).toBeTruthy();

    const [row] = await db.select().from(stockTransfers).where(eq(stockTransfers.id, transferId));
    expect(row!.status).toBe("rejected");
    expect(row!.rejectedReason).toBe("Tidak perlu, sudah dikirim outlet lain");

    const approveAfterReject = await approveStockTransferWithDb(db, businessId, null, { transferId, actorId: employeeId });
    expect(approveAfterReject.error).toBeTruthy();
  });

  it("cancel dari requested/approved -- murni status, TIDAK ada movement ditulis", async () => {
    const { db, businessId } = fixture;
    const ingId = await insertIngredient("Bahan Cancel Awal");
    const requested = await requestStockTransferWithDb(db, businessId, null, {
      toOutletId: retailOutletId,
      requestedBy: employeeId,
      lines: [{ ingredientId: ingId, unitChoice: "base", qty: 5 }],
    });
    const transferId = requested.success!.transferId;

    const cancelled = await cancelStockTransferWithDb(db, businessId, null, {
      transferId,
      reason: "Salah minta bahan",
      cancelledBy: employeeId,
    });
    expect(cancelled.success).toBeTruthy();
    expect(cancelled.warnings).toBeUndefined();

    const movements = await db.select().from(stockMovements).where(eq(stockMovements.refId, transferId));
    expect(movements.length).toBe(0);
  });

  it("cancel TIDAK BISA dari status 'sent'", async () => {
    const { db, businessId } = fixture;
    const ingId = await insertIngredient("Bahan Cancel Dari Sent");
    const requested = await requestStockTransferWithDb(db, businessId, null, {
      toOutletId: retailOutletId,
      requestedBy: employeeId,
      lines: [{ ingredientId: ingId, unitChoice: "base", qty: 5 }],
    });
    const transferId = requested.success!.transferId;
    await approveStockTransferWithDb(db, businessId, null, { transferId, actorId: employeeId });
    const [item] = await db.select().from(stockTransferItems).where(eq(stockTransferItems.transferId, transferId));
    await sendStockTransferWithDb(db, businessId, null, {
      transferId,
      sentBy: employeeId,
      lines: [{ itemId: item!.id, unitChoice: "base", qty: 5, unitCost: 1000 }],
    });

    const cancelled = await cancelStockTransferWithDb(db, businessId, null, {
      transferId,
      reason: "Coba batalkan padahal sudah sent",
      cancelledBy: employeeId,
    });
    expect(cancelled.error).toBe("Transfer ini tidak bisa dibatalkan dari status saat ini");
  });

  it("cancel dari received -- reversal penuh di outlet, peringatan kalau saldo jadi minus", async () => {
    const { db, businessId } = fixture;
    const ingId = await insertIngredient("Bahan Cancel Dari Received");
    const requested = await requestStockTransferWithDb(db, businessId, null, {
      toOutletId: retailOutletId,
      requestedBy: employeeId,
      lines: [{ ingredientId: ingId, unitChoice: "base", qty: 10 }],
    });
    const transferId = requested.success!.transferId;
    await approveStockTransferWithDb(db, businessId, null, { transferId, actorId: employeeId });
    const [item] = await db.select().from(stockTransferItems).where(eq(stockTransferItems.transferId, transferId));
    await sendStockTransferWithDb(db, businessId, null, {
      transferId,
      sentBy: employeeId,
      lines: [{ itemId: item!.id, unitChoice: "base", qty: 10, unitCost: 2000 }],
    });
    await receiveStockTransferWithDb(db, businessId, null, {
      transferId,
      receivedBy: employeeId,
      lines: [{ itemId: item!.id, receivedQty: 10 }],
    });

    // Simulasi 8 pcs sudah terjual (T25 belum dibangun) -- sisa 2.
    await db
      .update(stockLevels)
      .set({ qtyOnHand: "2" })
      .where(and(eq(stockLevels.ingredientId, ingId), eq(stockLevels.outletId, retailOutletId)));

    const cancelled = await cancelStockTransferWithDb(db, businessId, null, {
      transferId,
      reason: "Ternyata rusak, batal terima",
      cancelledBy: employeeId,
    });
    expect(cancelled.success).toBeTruthy();
    expect(cancelled.warnings).toBeTruthy();
    expect(cancelled.warnings!.length).toBe(1);

    const [levelAfter] = await db
      .select()
      .from(stockLevels)
      .where(and(eq(stockLevels.ingredientId, ingId), eq(stockLevels.outletId, retailOutletId)));
    expect(Number(levelAfter!.qtyOnHand)).toBe(-8); // 2 - 10 (dibalik penuh)

    const second = await cancelStockTransferWithDb(db, businessId, null, {
      transferId,
      reason: "Coba batalkan lagi",
      cancelledBy: employeeId,
    });
    expect(second.error).toBe("Transfer ini tidak bisa dibatalkan dari status saat ini");
  });

  it("trigger check_stock_transfer_transition menolak transisi status yang tidak valid (requested -> received langsung)", async () => {
    const { db, businessId } = fixture;
    const ingId = await insertIngredient("Bahan Transisi Ilegal");
    const requested = await requestStockTransferWithDb(db, businessId, null, {
      toOutletId: retailOutletId,
      requestedBy: employeeId,
      lines: [{ ingredientId: ingId, unitChoice: "base", qty: 1 }],
    });
    const transferId = requested.success!.transferId;

    await expect(
      db
        .update(stockTransfers)
        .set({ status: "received", receivedBy: employeeId, receivedAt: new Date() })
        .where(and(eq(stockTransfers.id, transferId), eq(stockTransfers.businessId, businessId)))
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ message: expect.stringMatching(/[Tt]ransisi status/) }),
    });
  });

  it("trigger check_transfer_item_immutable_core menolak perubahan requested_qty setelah baris dibuat", async () => {
    const { db, businessId } = fixture;
    const ingId = await insertIngredient("Bahan Item Immutable");
    const requested = await requestStockTransferWithDb(db, businessId, null, {
      toOutletId: retailOutletId,
      requestedBy: employeeId,
      lines: [{ ingredientId: ingId, unitChoice: "base", qty: 1 }],
    });
    const [item] = await db
      .select()
      .from(stockTransferItems)
      .where(eq(stockTransferItems.transferId, requested.success!.transferId));

    await expect(
      db
        .update(stockTransferItems)
        .set({ requestedQty: "999" })
        .where(and(eq(stockTransferItems.id, item!.id), eq(stockTransferItems.businessId, businessId)))
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ message: expect.stringMatching(/tidak boleh diubah/) }),
    });
  });

  it("getLastRequestForOutlet mengembalikan baris dari request TERAKHIR outlet ini", async () => {
    const { db, businessId } = fixture;
    const ingId1 = await insertIngredient("Bahan Last Request A");
    const ingId2 = await insertIngredient("Bahan Last Request B");

    await requestStockTransferWithDb(db, businessId, null, {
      toOutletId: retailOutletId,
      requestedBy: employeeId,
      lines: [{ ingredientId: ingId1, unitChoice: "base", qty: 3 }],
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await requestStockTransferWithDb(db, businessId, null, {
      toOutletId: retailOutletId,
      requestedBy: employeeId,
      lines: [{ ingredientId: ingId2, unitChoice: "base", qty: 7 }],
    });

    const last = await getLastRequestForOutlet(db, businessId, null, retailOutletId);
    expect(last.length).toBe(1);
    expect(last[0]!.ingredientId).toBe(ingId2);
    expect(last[0]!.qty).toBe("7.0000");
  });
});
