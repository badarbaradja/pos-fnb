/**
 * Langkah B1 (15 September 2026) — Trigger check_recipe_business_id /
 * check_recipe_item_business_id (migration 0037) harus benar-benar menolak
 * baris recipes/recipe_items yang memasangkan product_id/variant_id/
 * output_ingredient_id/ingredient_id dari business_id yang tidak konsisten
 * -- pola verifikasi PERSIS sama dengan inventory-tenancy-trigger.test.ts
 * (T21, migration 0017), bukan cuma "terpasang" tapi tidak pernah terbukti
 * berjalan.
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
import {
  brands,
  businesses,
  ingredients,
  products,
  productVariants,
  recipeItems,
  recipes,
} from "@/lib/db/schema";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

describe.skipIf(!hasEnv)(
  "recipes/recipe_items — trigger check_recipe_business_id / check_recipe_item_business_id",
  () => {
    const db = getAdminDb();
    const PREFIX = `TEST_RECIPETRIGGER_${Date.now()}`;

    let businessAId: string;
    let businessBId: string;
    let productAId: string;
    let productBId: string;
    let variantAId: string;
    let ingredientAId: string;
    let ingredientBId: string;
    let recipeAId: string;

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

      const [productA] = await db
        .insert(products)
        .values({ businessId: businessAId, brandId: brandA!.id, name: `${PREFIX}_product_A` })
        .returning({ id: products.id });
      productAId = productA!.id;

      const [brandB] = await db
        .insert(brands)
        .values({ businessId: businessBId, name: `${PREFIX}_brand_B` })
        .returning({ id: brands.id });

      const [productB] = await db
        .insert(products)
        .values({ businessId: businessBId, brandId: brandB!.id, name: `${PREFIX}_product_B` })
        .returning({ id: products.id });
      productBId = productB!.id;

      const [variantA] = await db
        .insert(productVariants)
        .values({ productId: productAId, name: `${PREFIX}_variant_A` })
        .returning({ id: productVariants.id });
      variantAId = variantA!.id;

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

      const [recipeA] = await db
        .insert(recipes)
        .values({ businessId: businessAId, productId: productAId })
        .returning({ id: recipes.id });
      recipeAId = recipeA!.id;
    });

    afterAll(async () => {
      if (businessAId) await db.delete(businesses).where(eq(businesses.id, businessAId));
      if (businessBId) await db.delete(businesses).where(eq(businesses.id, businessBId));
    });

    it("data uji benar-benar terbentuk sebelum diuji (bukan hijau karena kosong)", () => {
      expect(businessAId).toBeTruthy();
      expect(productAId).toBeTruthy();
      expect(variantAId).toBeTruthy();
      expect(ingredientAId).toBeTruthy();
      expect(recipeAId).toBeTruthy();
    });

    describe("recipes", () => {
      it("product_id bisnis B, business_id = A -- DITOLAK", async () => {
        await expect(
          db.insert(recipes).values({ businessId: businessAId, productId: productBId })
        ).rejects.toMatchObject({
          cause: expect.objectContaining({
            message: expect.stringMatching(/tidak cocok dengan business_id produk/),
          }),
        });
      });

      it("variant_id bisnis B (lewat product_id bisnis A yang valid), business_id = A -- DITOLAK", async () => {
        const [variantB] = await db
          .insert(productVariants)
          .values({ productId: productBId, name: `${PREFIX}_variant_B` })
          .returning({ id: productVariants.id });

        await expect(
          db.insert(recipes).values({
            businessId: businessAId,
            productId: productAId,
            variantId: variantB!.id,
          })
        ).rejects.toMatchObject({
          cause: expect.objectContaining({
            message: expect.stringMatching(/tidak cocok dengan business_id varian/),
          }),
        });
      });

      it("output_ingredient_id bisnis B, business_id = A -- DITOLAK", async () => {
        await expect(
          db.insert(recipes).values({ businessId: businessAId, outputIngredientId: ingredientBId })
        ).rejects.toMatchObject({
          cause: expect.objectContaining({
            message: expect.stringMatching(/tidak cocok dengan business_id bahan output/),
          }),
        });
      });

      it("product_id dan business_id konsisten (bisnis A) -- BERHASIL", async () => {
        const [row] = await db
          .insert(recipes)
          .values({ businessId: businessAId, productId: productAId, variantId: variantAId })
          .returning({ id: recipes.id });
        expect(row).toBeTruthy();
      });
    });

    describe("recipe_items", () => {
      it("recipe_id bisnis A, ingredient_id bisnis B, business_id = A -- DITOLAK", async () => {
        await expect(
          db.insert(recipeItems).values({
            recipeId: recipeAId,
            businessId: businessAId,
            ingredientId: ingredientBId,
            qty: "10",
          })
        ).rejects.toMatchObject({
          cause: expect.objectContaining({
            message: expect.stringMatching(/tidak cocok dengan business_id bahan/),
          }),
        });
      });

      it("business_id tidak cocok dengan recipe (recipe bisnis A, business_id = B) -- DITOLAK", async () => {
        await expect(
          db.insert(recipeItems).values({
            recipeId: recipeAId,
            businessId: businessBId,
            ingredientId: ingredientBId,
            qty: "10",
          })
        ).rejects.toMatchObject({
          cause: expect.objectContaining({
            message: expect.stringMatching(/tidak cocok dengan business_id resep/),
          }),
        });
      });

      it("recipe, ingredient, dan business_id semua konsisten (bisnis A) -- BERHASIL", async () => {
        const [row] = await db
          .insert(recipeItems)
          .values({
            recipeId: recipeAId,
            businessId: businessAId,
            ingredientId: ingredientAId,
            qty: "10",
          })
          .returning({ id: recipeItems.id });
        expect(row).toBeTruthy();
      });
    });
  }
);
