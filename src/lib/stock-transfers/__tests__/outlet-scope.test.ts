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
import { brands, businesses, outlets, stockTransfers } from "@/lib/db/schema";
import { outletScopeConditionForTransfer } from "@/lib/auth/outlet-scope";
import type { OutletScope } from "@/lib/auth/outlet-scope";

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
});
