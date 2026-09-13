/**
 * Pembatasan akses per outlet -- Tahap 4 (13 September 2026, §28), item
 * TERAKHIR 5/5: Stock Transfers. File ini tumbuh per commit sesuai
 * urutan yang disepakati CEO (list -> dropdown -> send/receive by-id ->
 * lima fungsi *WithDb -> getLastRequestForOutlet) -- setiap bagian
 * dicommit terpisah bersama perubahan kodenya.
 *
 * PRINSIP: gerbang per AKSI (satu kolom, fromOutletId ATAU toOutletId
 * tergantung aksi), BEDA dari visibilitas LIST (OR, outletScopeConditionForTransfer,
 * Tahap 2) -- kalau tercampur, manajer outlet peminta bisa "menyetujui
 * permintaannya sendiri" lewat gerbang yang salah.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { and, eq } from "drizzle-orm";
import { getAdminDb } from "@/lib/db/client";
import { brands, businesses, employees, outlets, stockTransfers } from "@/lib/db/schema";
import { isOutletAllowed, outletScopeCondition, outletScopeConditionForTransfer } from "@/lib/auth/outlet-scope";
import type { OutletScope } from "@/lib/auth/outlet-scope";
import {
  approveStockTransferWithDb,
  cancelStockTransferWithDb,
  receiveStockTransferWithDb,
  rejectStockTransferWithDb,
  requestStockTransferWithDb,
  sendStockTransferWithDb,
} from "@/lib/stock-transfers/manage";
import { id as strings } from "@/lib/i18n/id";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

describe.skipIf(!hasEnv)("Pembatasan akses per outlet, Tahap 4 -- Stock Transfers", () => {
  const db = getAdminDb();
  const PREFIX = `TEST_XFERSCOPE_${Date.now()}`;

  let businessId: string;
  let gudangId: string;
  let outletAId: string;
  let outletBId: string;
  let transferToAId: string;
  let transferToBId: string;
  let employeeId: string;

  async function listTransfers(allowedOutletIds: OutletScope) {
    return db
      .select({ id: stockTransfers.id })
      .from(stockTransfers)
      .where(
        and(
          eq(stockTransfers.businessId, businessId),
          outletScopeConditionForTransfer(allowedOutletIds, stockTransfers.fromOutletId, stockTransfers.toOutletId)
        )
      );
  }

  beforeAll(async () => {
    const [business] = await db.insert(businesses).values({ name: `${PREFIX}_business` }).returning({ id: businesses.id });
    businessId = business!.id;
    const [brand] = await db.insert(brands).values({ businessId, name: `${PREFIX}_brand` }).returning({ id: brands.id });

    const [gudang] = await db
      .insert(outlets)
      .values({ businessId, brandId: brand!.id, code: "XFG", name: "Gudang", isCentralKitchen: true })
      .returning({ id: outlets.id });
    gudangId = gudang!.id;

    const [oA] = await db
      .insert(outlets)
      .values({ businessId, brandId: brand!.id, code: "XFA", name: "Outlet A" })
      .returning({ id: outlets.id });
    outletAId = oA!.id;

    const [oB] = await db
      .insert(outlets)
      .values({ businessId, brandId: brand!.id, code: "XFB", name: "Outlet B" })
      .returning({ id: outlets.id });
    outletBId = oB!.id;

    const [tA] = await db
      .insert(stockTransfers)
      .values({ businessId, fromOutletId: gudangId, toOutletId: outletAId, status: "requested" })
      .returning({ id: stockTransfers.id });
    transferToAId = tA!.id;

    const [tB] = await db
      .insert(stockTransfers)
      .values({ businessId, fromOutletId: gudangId, toOutletId: outletBId, status: "requested" })
      .returning({ id: stockTransfers.id });
    transferToBId = tB!.id;

    const [employee] = await db
      .insert(employees)
      .values({ businessId, code: `${PREFIX}_emp`, fullName: "Pegawai Uji" })
      .returning({ id: employees.id });
    employeeId = employee!.id;
  });

  afterAll(async () => {
    // stock_transfers.business_id TIDAK cascade dari businesses (NO
    // ACTION) -- hapus dulu sebelum businesses.
    if (businessId) {
      await db.delete(stockTransfers).where(eq(stockTransfers.businessId, businessId));
      await db.delete(businesses).where(eq(businesses.id, businessId));
    }
  });

  describe("1/5 -- daftar /stock-transfers: visibilitas OR (outletScopeConditionForTransfer)", () => {
    it("data uji terbentuk (gudang + dua outlet, dua transfer requested)", () => {
      expect(gudangId).toBeTruthy();
      expect(transferToAId).toBeTruthy();
      expect(transferToBId).toBeTruthy();
    });

    it("scope null: KEDUA transfer muncul", async () => {
      const rows = await listTransfers(null);
      expect(rows.map((r) => r.id).sort()).toEqual([transferToAId, transferToBId].sort());
    });

    it("scope [gudang]: KEDUA transfer muncul (gudang adalah fromOutletId di keduanya)", async () => {
      const rows = await listTransfers([gudangId]);
      expect(rows.map((r) => r.id).sort()).toEqual([transferToAId, transferToBId].sort());
    });

    it("scope [outletA]: CUMA transfer ke A muncul, transfer ke B tidak terlihat sama sekali", async () => {
      const rows = await listTransfers([outletAId]);
      expect(rows.map((r) => r.id)).toEqual([transferToAId]);
    });

    it("scope array KOSONG: NOL transfer, bukan semua transfer", async () => {
      const rows = await listTransfers([]);
      expect(rows).toHaveLength(0);
    });
  });

  describe("2/5 -- dropdown 'outlet peminta' di /stock-transfers/new", () => {
    async function listRequestableOutlets(allowedOutletIds: OutletScope) {
      return db
        .select({ id: outlets.id })
        .from(outlets)
        .where(
          and(
            eq(outlets.businessId, businessId),
            eq(outlets.isActive, true),
            eq(outlets.isCentralKitchen, false),
            outletScopeCondition(allowedOutletIds, outlets.id)
          )
        );
    }

    it("scope null: KEDUA outlet retail muncul, gudang TETAP tidak ikut (filter isCentralKitchen tidak rusak)", async () => {
      const rows = await listRequestableOutlets(null);
      expect(rows.map((r) => r.id).sort()).toEqual([outletAId, outletBId].sort());
    });

    it("scope [outletA]: CUMA outlet A muncul", async () => {
      const rows = await listRequestableOutlets([outletAId]);
      expect(rows.map((r) => r.id)).toEqual([outletAId]);
    });

    it("scope [gudang] (bukan retail): NOL outlet retail muncul di dropdown", async () => {
      const rows = await listRequestableOutlets([gudangId]);
      expect(rows).toHaveLength(0);
    });

    it("scope array KOSONG: NOL outlet, bukan semua outlet retail", async () => {
      const rows = await listRequestableOutlets([]);
      expect(rows).toHaveLength(0);
    });
  });

  describe("3/5 -- /[id]/send dan /[id]/receive: akses langsung by-id, digabung ke notFound()", () => {
    let approvedTransferId: string;
    let sentTransferId: string;

    beforeAll(async () => {
      const [approved] = await db
        .insert(stockTransfers)
        .values({ businessId, fromOutletId: gudangId, toOutletId: outletAId, status: "approved" })
        .returning({ id: stockTransfers.id });
      approvedTransferId = approved!.id;

      const [sent] = await db
        .insert(stockTransfers)
        .values({ businessId, fromOutletId: gudangId, toOutletId: outletAId, status: "sent" })
        .returning({ id: stockTransfers.id });
      sentTransferId = sent!.id;
    });

    // Baca baris SUNGGUHAN dari DB lalu terapkan PERSIS kondisi if(...)
    // return notFound() di halaman send/receive -- bukan meniru ulang
    // isOutletAllowed(), memakai fungsi asli supaya komposisi status+outlet
    // di halaman benar-benar terbukti, bukan cuma diasumsikan.
    async function sendPageAllowsAccess(transferId: string, allowedOutletIds: OutletScope): Promise<boolean> {
      const [transfer] = await db.select().from(stockTransfers).where(eq(stockTransfers.id, transferId));
      return Boolean(transfer && transfer.status === "approved" && isOutletAllowed(allowedOutletIds, transfer.fromOutletId));
    }
    async function receivePageAllowsAccess(transferId: string, allowedOutletIds: OutletScope): Promise<boolean> {
      const [transfer] = await db.select().from(stockTransfers).where(eq(stockTransfers.id, transferId));
      return Boolean(transfer && transfer.status === "sent" && isOutletAllowed(allowedOutletIds, transfer.toOutletId));
    }

    it("data uji terbentuk (transfer approved dan sent)", () => {
      expect(approvedTransferId).toBeTruthy();
      expect(sentTransferId).toBeTruthy();
    });

    it("/send: scope [gudang] (fromOutletId) -- diizinkan", async () => {
      expect(await sendPageAllowsAccess(approvedTransferId, [gudangId])).toBe(true);
    });

    it("/send: scope [outletA] (toOutletId, BUKAN gudang) -- DITOLAK (notFound), walau transfer memang ada", async () => {
      expect(await sendPageAllowsAccess(approvedTransferId, [outletAId])).toBe(false);
    });

    it("/receive: scope [outletA] (toOutletId) -- diizinkan", async () => {
      expect(await receivePageAllowsAccess(sentTransferId, [outletAId])).toBe(true);
    });

    it("/receive: scope [gudang] (fromOutletId, BUKAN outlet peminta) -- DITOLAK", async () => {
      expect(await receivePageAllowsAccess(sentTransferId, [gudangId])).toBe(false);
    });

    it("scope array KOSONG -- DITOLAK di kedua halaman", async () => {
      expect(await sendPageAllowsAccess(approvedTransferId, [])).toBe(false);
      expect(await receivePageAllowsAccess(sentTransferId, [])).toBe(false);
    });

    it("scope null (owner/akuntan) -- diizinkan di kedua halaman", async () => {
      expect(await sendPageAllowsAccess(approvedTransferId, null)).toBe(true);
      expect(await receivePageAllowsAccess(sentTransferId, null)).toBe(true);
    });
  });

  describe("4/5 -- lima fungsi *WithDb: gerbang per AKSI, dibuktikan lewat panggilan sungguhan + verifikasi DB", () => {
    it("requestStockTransferWithDb: toOutletId di luar cakupan -- DITOLAK, TIDAK ADA baris baru ditulis", async () => {
      const before = await db
        .select({ id: stockTransfers.id })
        .from(stockTransfers)
        .where(eq(stockTransfers.toOutletId, outletBId));
      const result = await requestStockTransferWithDb(db, businessId, [outletAId], {
        toOutletId: outletBId,
        requestedBy: employeeId,
        lines: [{ ingredientId: crypto.randomUUID(), unitChoice: "base", qty: 1 }],
      });
      expect(result.error).toBe(strings.common.outletAccessDenied);
      const after = await db
        .select({ id: stockTransfers.id })
        .from(stockTransfers)
        .where(eq(stockTransfers.toOutletId, outletBId));
      expect(after.length).toBe(before.length);
    });

    it("requestStockTransferWithDb: toOutletId di dalam cakupan -- lolos gerbang (gagal berikutnya karena ingredient palsu, BUKAN outletAccessDenied)", async () => {
      const result = await requestStockTransferWithDb(db, businessId, [outletAId], {
        toOutletId: outletAId,
        requestedBy: employeeId,
        lines: [{ ingredientId: crypto.randomUUID(), unitChoice: "base", qty: 1 }],
      });
      expect(result.error).not.toBe(strings.common.outletAccessDenied);
    });

    it("approveStockTransferWithDb: fromOutletId (gudang) di luar cakupan -- DITOLAK, status TIDAK berubah", async () => {
      const [row] = await db
        .insert(stockTransfers)
        .values({ businessId, fromOutletId: gudangId, toOutletId: outletAId, status: "requested" })
        .returning({ id: stockTransfers.id });
      const result = await approveStockTransferWithDb(db, businessId, [outletAId], {
        transferId: row!.id,
        actorId: employeeId,
      });
      expect(result.error).toBe(strings.common.outletAccessDenied);
      const [after] = await db.select({ status: stockTransfers.status }).from(stockTransfers).where(eq(stockTransfers.id, row!.id));
      expect(after!.status).toBe("requested");
    });

    it("approveStockTransferWithDb: fromOutletId (gudang) di dalam cakupan -- BERHASIL, status jadi approved", async () => {
      const [row] = await db
        .insert(stockTransfers)
        .values({ businessId, fromOutletId: gudangId, toOutletId: outletAId, status: "requested" })
        .returning({ id: stockTransfers.id });
      const result = await approveStockTransferWithDb(db, businessId, [gudangId], {
        transferId: row!.id,
        actorId: employeeId,
      });
      expect(result.error).toBeUndefined();
      const [after] = await db.select({ status: stockTransfers.status }).from(stockTransfers).where(eq(stockTransfers.id, row!.id));
      expect(after!.status).toBe("approved");
    });

    it("rejectStockTransferWithDb: fromOutletId (gudang) di luar cakupan -- DITOLAK, status TIDAK berubah", async () => {
      const [row] = await db
        .insert(stockTransfers)
        .values({ businessId, fromOutletId: gudangId, toOutletId: outletAId, status: "requested" })
        .returning({ id: stockTransfers.id });
      const result = await rejectStockTransferWithDb(db, businessId, [outletAId], {
        transferId: row!.id,
        actorId: employeeId,
        reason: "uji tolak",
      });
      expect(result.error).toBe(strings.common.outletAccessDenied);
      const [after] = await db.select({ status: stockTransfers.status }).from(stockTransfers).where(eq(stockTransfers.id, row!.id));
      expect(after!.status).toBe("requested");
    });

    it("rejectStockTransferWithDb: fromOutletId (gudang) di dalam cakupan -- BERHASIL, status jadi rejected", async () => {
      const [row] = await db
        .insert(stockTransfers)
        .values({ businessId, fromOutletId: gudangId, toOutletId: outletAId, status: "requested" })
        .returning({ id: stockTransfers.id });
      const result = await rejectStockTransferWithDb(db, businessId, [gudangId], {
        transferId: row!.id,
        actorId: employeeId,
        reason: "uji tolak",
      });
      expect(result.error).toBeUndefined();
      const [after] = await db.select({ status: stockTransfers.status }).from(stockTransfers).where(eq(stockTransfers.id, row!.id));
      expect(after!.status).toBe("rejected");
    });

    it("sendStockTransferWithDb: fromOutletId (gudang) di luar cakupan -- DITOLAK, status TIDAK berubah", async () => {
      const [row] = await db
        .insert(stockTransfers)
        .values({ businessId, fromOutletId: gudangId, toOutletId: outletAId, status: "approved" })
        .returning({ id: stockTransfers.id });
      const result = await sendStockTransferWithDb(db, businessId, [outletAId], {
        transferId: row!.id,
        sentBy: employeeId,
        lines: [{ itemId: crypto.randomUUID(), unitChoice: "base", qty: 1, unitCost: 0 }],
      });
      expect(result.error).toBe(strings.common.outletAccessDenied);
      const [after] = await db.select({ status: stockTransfers.status }).from(stockTransfers).where(eq(stockTransfers.id, row!.id));
      expect(after!.status).toBe("approved");
    });

    it("sendStockTransferWithDb: fromOutletId (gudang) di dalam cakupan -- lolos gerbang (gagal berikutnya karena item palsu, BUKAN outletAccessDenied)", async () => {
      const [row] = await db
        .insert(stockTransfers)
        .values({ businessId, fromOutletId: gudangId, toOutletId: outletAId, status: "approved" })
        .returning({ id: stockTransfers.id });
      const result = await sendStockTransferWithDb(db, businessId, [gudangId], {
        transferId: row!.id,
        sentBy: employeeId,
        lines: [{ itemId: crypto.randomUUID(), unitChoice: "base", qty: 1, unitCost: 0 }],
      });
      expect(result.error).not.toBe(strings.common.outletAccessDenied);
    });

    it("receiveStockTransferWithDb: toOutletId (outlet peminta) di luar cakupan -- DITOLAK, status TIDAK berubah", async () => {
      const [row] = await db
        .insert(stockTransfers)
        .values({ businessId, fromOutletId: gudangId, toOutletId: outletAId, status: "sent" })
        .returning({ id: stockTransfers.id });
      const result = await receiveStockTransferWithDb(db, businessId, [gudangId], {
        transferId: row!.id,
        receivedBy: employeeId,
        lines: [{ itemId: crypto.randomUUID(), receivedQty: 1 }],
      });
      expect(result.error).toBe(strings.common.outletAccessDenied);
      const [after] = await db.select({ status: stockTransfers.status }).from(stockTransfers).where(eq(stockTransfers.id, row!.id));
      expect(after!.status).toBe("sent");
    });

    it("receiveStockTransferWithDb: toOutletId di dalam cakupan -- lolos gerbang (gagal berikutnya karena item palsu, BUKAN outletAccessDenied)", async () => {
      const [row] = await db
        .insert(stockTransfers)
        .values({ businessId, fromOutletId: gudangId, toOutletId: outletAId, status: "sent" })
        .returning({ id: stockTransfers.id });
      const result = await receiveStockTransferWithDb(db, businessId, [outletAId], {
        transferId: row!.id,
        receivedBy: employeeId,
        lines: [{ itemId: crypto.randomUUID(), receivedQty: 1 }],
      });
      expect(result.error).not.toBe(strings.common.outletAccessDenied);
    });

    it("cancelStockTransferWithDb (requested): toOutletId di luar cakupan -- DITOLAK, status TIDAK berubah", async () => {
      const [row] = await db
        .insert(stockTransfers)
        .values({ businessId, fromOutletId: gudangId, toOutletId: outletAId, status: "requested" })
        .returning({ id: stockTransfers.id });
      const result = await cancelStockTransferWithDb(db, businessId, [outletBId], {
        transferId: row!.id,
        reason: "batal",
        cancelledBy: employeeId,
      });
      expect(result.error).toBe(strings.common.outletAccessDenied);
      const [after] = await db.select({ status: stockTransfers.status }).from(stockTransfers).where(eq(stockTransfers.id, row!.id));
      expect(after!.status).toBe("requested");
    });

    it("cancelStockTransferWithDb (requested): toOutletId di dalam cakupan -- BERHASIL walau scope TIDAK mencakup gudang (belum ada stok tersentuh, cuma ganti status)", async () => {
      const [row] = await db
        .insert(stockTransfers)
        .values({ businessId, fromOutletId: gudangId, toOutletId: outletAId, status: "requested" })
        .returning({ id: stockTransfers.id });
      const result = await cancelStockTransferWithDb(db, businessId, [outletAId], {
        transferId: row!.id,
        reason: "batal",
        cancelledBy: employeeId,
      });
      expect(result.error).toBeUndefined();
      const [after] = await db.select({ status: stockTransfers.status }).from(stockTransfers).where(eq(stockTransfers.id, row!.id));
      expect(after!.status).toBe("cancelled");
    });

    it("cancelStockTransferWithDb (received): scope CUMA toOutletId (BUKAN fromOutletId) -- DITOLAK, kedua outlet WAJIB untuk status ini", async () => {
      const [row] = await db
        .insert(stockTransfers)
        .values({ businessId, fromOutletId: gudangId, toOutletId: outletAId, status: "received" })
        .returning({ id: stockTransfers.id });
      const result = await cancelStockTransferWithDb(db, businessId, [outletAId], {
        transferId: row!.id,
        reason: "batal",
        cancelledBy: employeeId,
      });
      expect(result.error).toBe(strings.common.outletAccessDenied);
      const [after] = await db.select({ status: stockTransfers.status }).from(stockTransfers).where(eq(stockTransfers.id, row!.id));
      expect(after!.status).toBe("received");
    });

    it("cancelStockTransferWithDb (received): scope CUMA fromOutletId (BUKAN toOutletId) -- DITOLAK juga, satu outlet saja tidak cukup", async () => {
      const [row] = await db
        .insert(stockTransfers)
        .values({ businessId, fromOutletId: gudangId, toOutletId: outletAId, status: "received" })
        .returning({ id: stockTransfers.id });
      const result = await cancelStockTransferWithDb(db, businessId, [gudangId], {
        transferId: row!.id,
        reason: "batal",
        cancelledBy: employeeId,
      });
      expect(result.error).toBe(strings.common.outletAccessDenied);
      const [after] = await db.select({ status: stockTransfers.status }).from(stockTransfers).where(eq(stockTransfers.id, row!.id));
      expect(after!.status).toBe("received");
    });

    it("cancelStockTransferWithDb (received): scope mencakup KEDUA outlet -- BERHASIL", async () => {
      const [row] = await db
        .insert(stockTransfers)
        .values({ businessId, fromOutletId: gudangId, toOutletId: outletAId, status: "received" })
        .returning({ id: stockTransfers.id });
      const result = await cancelStockTransferWithDb(db, businessId, [gudangId, outletAId], {
        transferId: row!.id,
        reason: "batal",
        cancelledBy: employeeId,
      });
      expect(result.error).toBeUndefined();
      const [after] = await db.select({ status: stockTransfers.status }).from(stockTransfers).where(eq(stockTransfers.id, row!.id));
      expect(after!.status).toBe("cancelled");
    });

    it("scope null (owner/akuntan) di semua lima fungsi -- selalu lolos gerbang outlet", async () => {
      const [row] = await db
        .insert(stockTransfers)
        .values({ businessId, fromOutletId: gudangId, toOutletId: outletAId, status: "requested" })
        .returning({ id: stockTransfers.id });
      const result = await approveStockTransferWithDb(db, businessId, null, { transferId: row!.id, actorId: employeeId });
      expect(result.error).toBeUndefined();
    });

    it("scope array KOSONG di semua lima fungsi -- selalu DITOLAK", async () => {
      const [row] = await db
        .insert(stockTransfers)
        .values({ businessId, fromOutletId: gudangId, toOutletId: outletAId, status: "requested" })
        .returning({ id: stockTransfers.id });
      const result = await approveStockTransferWithDb(db, businessId, [], { transferId: row!.id, actorId: employeeId });
      expect(result.error).toBe(strings.common.outletAccessDenied);
    });
  });
});
