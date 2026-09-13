/**
 * Pembatasan akses per outlet -- Tahap 3 (13 September 2026, §24), halaman
 * 5/6: Kartu Stok Bahan (`app/(dashboard)/ingredients/[id]/stock-card/page.tsx`).
 *
 * `ingredients` katalog BISNIS (tidak punya outletId), tapi
 * `stock_movements`-nya PER OUTLET -- satu bahan yang sama punya
 * pergerakan stok terpisah di tiap outlet. Halaman ini menampilkan
 * gabungan pergerakan lintas outlet untuk SATU bahan; Tahap 3 menyaring
 * baris mana yang ikut muncul lewat outletScopeCondition di
 * stock_movements.outlet_id.
 *
 * Dua movement dengan QTY BEDA di outlet berbeda untuk bahan yang SAMA
 * -- kalau salah menyaring, ketahuan dari qty yang salah muncul.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { and, eq } from "drizzle-orm";
import { getAdminDb } from "@/lib/db/client";
import { brands, businesses, ingredients, outlets, stockMovements } from "@/lib/db/schema";
import { outletScopeCondition } from "@/lib/auth/outlet-scope";
import type { OutletScope } from "@/lib/auth/outlet-scope";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

describe.skipIf(!hasEnv)("Pembatasan akses per outlet, Tahap 3 -- kartu stok bahan", () => {
  const db = getAdminDb();
  const PREFIX = `TEST_STOCKCARDSCOPE_${Date.now()}`;

  let businessId: string;
  let ingredientId: string;
  let outletAId: string;
  let outletBId: string;

  async function listMovements(allowedOutletIds: OutletScope) {
    return db
      .select({ id: stockMovements.id, qty: stockMovements.qty, outletId: stockMovements.outletId })
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.businessId, businessId),
          eq(stockMovements.ingredientId, ingredientId),
          outletScopeCondition(allowedOutletIds, stockMovements.outletId)
        )
      );
  }

  beforeAll(async () => {
    const [business] = await db.insert(businesses).values({ name: `${PREFIX}_business` }).returning({ id: businesses.id });
    businessId = business!.id;
    const [brand] = await db.insert(brands).values({ businessId, name: `${PREFIX}_brand` }).returning({ id: brands.id });

    const [oA] = await db
      .insert(outlets)
      .values({ businessId, brandId: brand!.id, code: "SCA", name: "Stock Card A" })
      .returning({ id: outlets.id });
    const [oB] = await db
      .insert(outlets)
      .values({ businessId, brandId: brand!.id, code: "SCB", name: "Stock Card B" })
      .returning({ id: outlets.id });
    outletAId = oA!.id;
    outletBId = oB!.id;

    const [ingredient] = await db
      .insert(ingredients)
      .values({
        businessId,
        name: `${PREFIX}_ingredient`,
        baseUnit: "g",
        purchaseUnit: "kg",
        purchaseFactor: "1000",
      })
      .returning({ id: ingredients.id });
    ingredientId = ingredient!.id;

    const baseMovement = {
      businessId,
      ingredientId,
      movementType: "initial" as const,
      unitCost: "5000",
      businessDate: "2026-08-16",
    };

    // Qty BEDA (10 vs 25) supaya tidak mungkin tertukar diam-diam.
    await db.insert(stockMovements).values({
      ...baseMovement,
      outletId: outletAId,
      qty: "10",
      totalCost: "50000",
      balanceAfter: "10",
      avgCostAfter: "5000",
    });
    await db.insert(stockMovements).values({
      ...baseMovement,
      outletId: outletBId,
      qty: "25",
      totalCost: "125000",
      balanceAfter: "25",
      avgCostAfter: "5000",
    });
  });

  afterAll(async () => {
    // stock_movements.business_id TIDAK cascade dari businesses (NO
    // ACTION) -- hapus dulu sebelum businesses.
    if (businessId) {
      await db.delete(stockMovements).where(eq(stockMovements.businessId, businessId));
      await db.delete(businesses).where(eq(businesses.id, businessId));
    }
  });

  it("data uji terbentuk (satu bahan, dua movement outlet berbeda, qty beda)", () => {
    expect(ingredientId).toBeTruthy();
    expect(outletAId).toBeTruthy();
    expect(outletBId).toBeTruthy();
  });

  it("scope null: KEDUA movement muncul (qty 10 dan 25)", async () => {
    const rows = await listMovements(null);
    expect(rows.map((r) => r.qty).sort()).toEqual(["10.0000", "25.0000"]);
  });

  it("scope [outletA]: CUMA movement outlet A (qty 10) muncul, movement outlet B tidak ada jejaknya", async () => {
    const rows = await listMovements([outletAId]);
    expect(rows.map((r) => r.qty)).toEqual(["10.0000"]);
  });

  it("scope array KOSONG: NOL movement, bukan semua movement", async () => {
    const rows = await listMovements([]);
    expect(rows).toHaveLength(0);
  });
});
