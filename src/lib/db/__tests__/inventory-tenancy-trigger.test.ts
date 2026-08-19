/**
 * T21 — Trigger check_ingredient_outlet_business_id (migration 0017) harus
 * benar-benar menolak baris stock_levels/stock_movements yang memasangkan
 * ingredient_id/outlet_id dari business_id yang tidak konsisten -- bukan
 * cuma "terpasang" tapi tidak pernah terbukti berjalan.
 *
 * Sengaja lewat getAdminDb() (BYPASSRLS), BUKAN getUserDb() -- ini
 * membuktikan trigger menahan baris lintas-bisnis bahkan saat RLS
 * dilewati sepenuhnya, skenario yang paling perlu dijamin karena RLS saja
 * tidak melindungi jalur admin/system (CLAUDE.md §3.4).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
import { eq, inArray } from "drizzle-orm";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { getAdminDb } from "@/lib/db/client";
import {
  brands,
  businesses,
  ingredients,
  outlets,
  stockLevels,
  stockMovements,
} from "@/lib/db/schema";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

describe.skipIf(!hasEnv)(
  "stock_levels/stock_movements — trigger check_ingredient_outlet_business_id",
  () => {
    const db = getAdminDb(); // lihat komentar file: sengaja BYPASSRLS untuk membuktikan trigger, bukan RLS, yang menahan
    const PREFIX = `TEST_INVTRIGGER_${Date.now()}`;

    let businessAId: string;
    let businessBId: string;
    let brandAId: string;
    let brandBId: string;
    let outletAId: string;
    let ingredientAId: string;

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
      brandAId = brandA!.id;

      const [brandB] = await db
        .insert(brands)
        .values({ businessId: businessBId, name: `${PREFIX}_brand_B` })
        .returning({ id: brands.id });
      brandBId = brandB!.id;

      const [outletA] = await db
        .insert(outlets)
        .values({ businessId: businessAId, brandId: brandAId, code: "A1", name: `${PREFIX}_outlet_A` })
        .returning({ id: outlets.id });
      outletAId = outletA!.id;

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
    });

    afterAll(async () => {
      // stock_movements FK ke businesses/outlets/ingredients pakai ON DELETE
      // NO ACTION (append-only, migration 0017) -- harus dihapus manual
      // dulu sebelum businesses bisa dihapus. outlets/ingredients/
      // stock_levels ikut cascade lewat penghapusan businesses.
      if (businessAId || businessBId) {
        await db
          .delete(stockMovements)
          .where(inArray(stockMovements.businessId, [businessAId, businessBId].filter(Boolean)));
      }
      if (businessAId) await db.delete(businesses).where(eq(businesses.id, businessAId));
      if (businessBId) await db.delete(businesses).where(eq(businesses.id, businessBId));
    });

    it("data uji benar-benar terbentuk sebelum diuji (bukan hijau karena kosong)", () => {
      expect(businessAId).toBeTruthy();
      expect(businessBId).toBeTruthy();
      expect(outletAId).toBeTruthy();
      expect(ingredientAId).toBeTruthy();
    });

    describe("stock_levels", () => {
      it("ingredient bisnis A + outlet bisnis B (business_id = A, cocok ingredient tapi bukan outlet) -- DITOLAK", async () => {
        const [outletB] = await db
          .insert(outlets)
          .values({ businessId: businessBId, brandId: brandBId, code: "B1", name: `${PREFIX}_outlet_B_sl1` })
          .returning({ id: outlets.id });

        await expect(
          db.insert(stockLevels).values({
            businessId: businessAId,
            ingredientId: ingredientAId,
            outletId: outletB!.id,
          })
        ).rejects.toMatchObject({
          cause: expect.objectContaining({
            message: expect.stringMatching(/tidak cocok dengan business_id outlet/),
          }),
        });
      });

      it("business_id tidak cocok dengan ingredient MAUPUN outlet (keduanya bisnis A, business_id = B) -- DITOLAK", async () => {
        await expect(
          db.insert(stockLevels).values({
            businessId: businessBId,
            ingredientId: ingredientAId,
            outletId: outletAId,
          })
        ).rejects.toMatchObject({
          cause: expect.objectContaining({
            message: expect.stringMatching(/tidak cocok dengan business_id bahan/),
          }),
        });
      });

      it("ingredient, outlet, dan business_id semua konsisten (bisnis A) -- BERHASIL", async () => {
        await db.insert(stockLevels).values({
          businessId: businessAId,
          ingredientId: ingredientAId,
          outletId: outletAId,
        });

        const [row] = await db
          .select()
          .from(stockLevels)
          .where(eq(stockLevels.ingredientId, ingredientAId));
        expect(row).toBeTruthy();
        expect(row!.outletId).toBe(outletAId);
      });
    });

    describe("stock_movements", () => {
      const baseMovement = {
        movementType: "initial" as const,
        qty: "10",
        unitCost: "5000",
        totalCost: "50000",
        balanceAfter: "10",
        avgCostAfter: "5000",
        businessDate: "2026-08-16",
      };

      it("ingredient bisnis A + outlet bisnis B (business_id = A, cocok ingredient tapi bukan outlet) -- DITOLAK", async () => {
        const [outletB] = await db
          .insert(outlets)
          .values({ businessId: businessBId, brandId: brandBId, code: "B2", name: `${PREFIX}_outlet_B_sm1` })
          .returning({ id: outlets.id });

        await expect(
          db.insert(stockMovements).values({
            ...baseMovement,
            businessId: businessAId,
            ingredientId: ingredientAId,
            outletId: outletB!.id,
          })
        ).rejects.toMatchObject({
          cause: expect.objectContaining({
            message: expect.stringMatching(/tidak cocok dengan business_id outlet/),
          }),
        });
      });

      it("business_id tidak cocok dengan ingredient MAUPUN outlet (keduanya bisnis A, business_id = B) -- DITOLAK", async () => {
        await expect(
          db.insert(stockMovements).values({
            ...baseMovement,
            businessId: businessBId,
            ingredientId: ingredientAId,
            outletId: outletAId,
          })
        ).rejects.toMatchObject({
          cause: expect.objectContaining({
            message: expect.stringMatching(/tidak cocok dengan business_id bahan/),
          }),
        });
      });

      it("ingredient, outlet, dan business_id semua konsisten (bisnis A) -- BERHASIL", async () => {
        const [row] = await db
          .insert(stockMovements)
          .values({
            ...baseMovement,
            businessId: businessAId,
            ingredientId: ingredientAId,
            outletId: outletAId,
          })
          .returning({ id: stockMovements.id });

        expect(row).toBeTruthy();
      });
    });
  }
);
