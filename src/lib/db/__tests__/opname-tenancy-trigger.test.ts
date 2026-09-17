/**
 * Langkah C (16 September 2026) — Trigger check_opname_business_id /
 * check_opname_item_business_id (migration 0038) harus benar-benar
 * menolak baris stock_opnames/stock_opname_items yang memasangkan
 * outlet_id/opname_id/ingredient_id dari business_id yang tidak konsisten
 * -- pola verifikasi PERSIS sama dengan inventory-tenancy-trigger.test.ts
 * (T21, migration 0017) dan recipe-tenancy-trigger.test.ts (B1, migration
 * 0037), bukan cuma "terpasang" tapi tidak pernah terbukti berjalan.
 *
 * Sengaja lewat getAdminDb() (BYPASSRLS), BUKAN getUserDb() -- membuktikan
 * trigger menahan baris lintas-bisnis bahkan saat RLS dilewati sepenuhnya
 * (CLAUDE.md §3.4).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
import { eq } from "drizzle-orm";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { getAdminDb } from "@/lib/db/client";
import { brands, businesses, ingredients, outlets, stockOpnameItems, stockOpnames } from "@/lib/db/schema";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

describe.skipIf(!hasEnv)(
  "stock_opnames/stock_opname_items — trigger check_opname_business_id / check_opname_item_business_id",
  () => {
    const db = getAdminDb();
    const PREFIX = `TEST_OPNAMETRIGGER_${Date.now()}`;

    let businessAId: string;
    let businessBId: string;
    let outletAId: string;
    let outletBId: string;
    let ingredientAId: string;
    let ingredientBId: string;
    let opnameAId: string;

    beforeAll(async () => {
      const [businessA] = await db
        .insert(businesses)
        .values({ name: `${PREFIX}_business_A` })
        .returning({ id: businesses.id });
      businessAId = businessA!.id;

      const [businessB] = await db
        .insert(businesses)
        .values({ name: `${PREFIX}_business_B` })
        .returning({ id: businesses.id });
      businessBId = businessB!.id;

      const [brandA] = await db
        .insert(brands)
        .values({ businessId: businessAId, name: `${PREFIX}_brand_A` })
        .returning({ id: brands.id });
      const [outletA] = await db
        .insert(outlets)
        .values({ businessId: businessAId, brandId: brandA!.id, code: "OA1", name: `${PREFIX}_outlet_A` })
        .returning({ id: outlets.id });
      outletAId = outletA!.id;

      const [brandB] = await db
        .insert(brands)
        .values({ businessId: businessBId, name: `${PREFIX}_brand_B` })
        .returning({ id: brands.id });
      const [outletB] = await db
        .insert(outlets)
        .values({ businessId: businessBId, brandId: brandB!.id, code: "OB1", name: `${PREFIX}_outlet_B` })
        .returning({ id: outlets.id });
      outletBId = outletB!.id;

      const [ingredientA] = await db
        .insert(ingredients)
        .values({
          businessId: businessAId,
          name: `${PREFIX}_ingredient_A`,
          baseUnit: "g",
          purchaseUnit: "kg",
          purchaseFactor: "1000",
        })
        .returning({ id: ingredients.id });
      ingredientAId = ingredientA!.id;

      const [ingredientB] = await db
        .insert(ingredients)
        .values({
          businessId: businessBId,
          name: `${PREFIX}_ingredient_B`,
          baseUnit: "g",
          purchaseUnit: "kg",
          purchaseFactor: "1000",
        })
        .returning({ id: ingredients.id });
      ingredientBId = ingredientB!.id;

      const [opnameA] = await db
        .insert(stockOpnames)
        .values({ businessId: businessAId, outletId: outletAId, businessDate: "2026-09-16" })
        .returning({ id: stockOpnames.id });
      opnameAId = opnameA!.id;
    });

    afterAll(async () => {
      if (businessAId) await db.delete(businesses).where(eq(businesses.id, businessAId));
      if (businessBId) await db.delete(businesses).where(eq(businesses.id, businessBId));
    });

    it("data uji benar-benar terbentuk sebelum diuji (bukan hijau karena kosong)", () => {
      expect(businessAId).toBeTruthy();
      expect(outletAId).toBeTruthy();
      expect(ingredientAId).toBeTruthy();
      expect(opnameAId).toBeTruthy();
    });

    describe("stock_opnames", () => {
      it("outlet_id bisnis B, business_id = A -- DITOLAK", async () => {
        await expect(
          db.insert(stockOpnames).values({
            businessId: businessAId,
            outletId: outletBId,
            businessDate: "2026-09-16",
          })
        ).rejects.toMatchObject({
          cause: expect.objectContaining({
            message: expect.stringMatching(/tidak cocok dengan business_id outlet/),
          }),
        });
      });

      it("outlet_id dan business_id konsisten (bisnis A) -- BERHASIL", async () => {
        const [row] = await db
          .insert(stockOpnames)
          .values({ businessId: businessAId, outletId: outletAId, businessDate: "2026-09-16" })
          .returning({ id: stockOpnames.id });
        expect(row).toBeTruthy();
      });
    });

    describe("stock_opname_items", () => {
      it("ingredient_id bisnis B, business_id = A (opname_id bisnis A valid) -- DITOLAK", async () => {
        await expect(
          db.insert(stockOpnameItems).values({
            opnameId: opnameAId,
            businessId: businessAId,
            ingredientId: ingredientBId,
            systemQty: "0",
            unitCost: "0",
          })
        ).rejects.toMatchObject({
          cause: expect.objectContaining({
            message: expect.stringMatching(/tidak cocok dengan business_id bahan/),
          }),
        });
      });

      it("business_id tidak cocok dengan opname (opname bisnis A, business_id = B) -- DITOLAK", async () => {
        await expect(
          db.insert(stockOpnameItems).values({
            opnameId: opnameAId,
            businessId: businessBId,
            ingredientId: ingredientBId,
            systemQty: "0",
            unitCost: "0",
          })
        ).rejects.toMatchObject({
          cause: expect.objectContaining({
            message: expect.stringMatching(/tidak cocok dengan business_id opname/),
          }),
        });
      });

      it("opname, ingredient, dan business_id semua konsisten (bisnis A) -- BERHASIL", async () => {
        const [row] = await db
          .insert(stockOpnameItems)
          .values({
            opnameId: opnameAId,
            businessId: businessAId,
            ingredientId: ingredientAId,
            systemQty: "0",
            unitCost: "0",
          })
          .returning({ id: stockOpnameItems.id });
        expect(row).toBeTruthy();
      });
    });
  }
);
