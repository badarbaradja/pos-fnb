/**
 * B3-B5 (17 September 2026) -- potong stok saat bayar, konsumsi bahan
 * modifier, dan jaminan snapshot HPP. File TERPISAH dari
 * pay-order-fnb-integration.test.ts (yang harus tetap hijau tanpa
 * diubah) -- lihat docs/RENCANA-PEMBANGUNAN-KASIR-THRIFTING.md §37-38.
 *
 * Skenario wajib (instruksi CEO):
 *  1. Dua produk beda memakai bahan SAMA dalam satu order -- movement
 *     kedua melihat saldo hasil movement pertama, bukan snapshot awal.
 *  2. Stok tidak cukup -- transaksi TETAP SUKSES, stockWarnings terisi,
 *     saldo minus tercatat benar di ledger.
 *  3. HPP (order_items.unit_cogs) TIDAK berubah walau resep diedit
 *     setelah transaksi tersimpan (snapshot, bukan live join).
 *  4. Modifier dengan ingredient_id+ingredient_qty ikut memotong stok,
 *     skala mengikuti qty baris.
 *  5. Produk tanpa resep aktif -- tidak ada movement, unit_cogs tetap "0".
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
import { and, eq } from "drizzle-orm";
import { Decimal } from "decimal.js";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { getAdminDb } from "@/lib/db/client";
import {
  brands,
  businesses,
  devices,
  employees,
  ingredients,
  modifierGroups,
  modifiers,
  orderItemModifiers,
  orderItems,
  orders,
  outlets,
  paymentMethods,
  priceTiers,
  productPrices,
  products,
  recipeItems,
  recipes,
  shifts,
  stockLevels,
  stockMovements,
} from "@/lib/db/schema";
import { hashPin } from "@/lib/auth/pin";
import { generateId } from "@/lib/utils/id";
import { openShiftWithDb } from "@/lib/pos/shift";
import { submitPrepareReportWithDb } from "@/lib/pos/shift-report";
import { payOrderWithDb } from "@/lib/pos/pay-order";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

const PIN = "445566";

describe.skipIf(!hasEnv)("B3-B5 -- potong stok saat bayar, modifier, snapshot HPP", () => {
  const db = getAdminDb();
  const PREFIX = `TEST_STOCKDEDUCT_${Date.now()}`;

  let businessId: string;
  let outletId: string;
  let priceTierId: string;
  let cashMethodId: string;

  async function openFreshShift(label: string) {
    const pinHash = await hashPin(PIN);
    await db
      .insert(employees)
      .values({ businessId, outletId, code: `${PREFIX}_${label}`, fullName: `Kasir ${label}`, role: "cashier", pinHash });
    const [device] = await db
      .insert(devices)
      .values({ businessId, outletId, serialNumber: `${PREFIX}-${label}`, name: `Kasir ${label}` })
      .returning({ id: devices.id });
    const shiftResult = await openShiftWithDb(db, businessId, {
      id: generateId(),
      outletId,
      deviceId: device!.id,
      employeeCode: `${PREFIX}_${label}`,
      pin: PIN,
      openingCash: "0",
    });
    expect(shiftResult.success).toBeTruthy();
    // Rencana Revisi 24 September 2026 -- laporan Prepare sekarang gerbang
    // WAJIB (checkShiftSellability -> 'prepare_required') untuk SETIAP
    // shift -- tidak relevan dengan yang diuji file ini, diisi otomatis.
    await submitPrepareReportWithDb(db, businessId, {
      shiftId: shiftResult.success!.shiftId,
      photo: { photoPath: "test/prepare.jpg" },
      hasEvent: false,
    });
    return device!.id;
  }

  async function getStock(ingredientId: string): Promise<{ qty: Decimal; avgCost: Decimal } | null> {
    const [level] = await db
      .select({ qtyOnHand: stockLevels.qtyOnHand, avgCost: stockLevels.avgCost })
      .from(stockLevels)
      .where(and(eq(stockLevels.ingredientId, ingredientId), eq(stockLevels.outletId, outletId)));
    return level ? { qty: new Decimal(level.qtyOnHand), avgCost: new Decimal(level.avgCost) } : null;
  }

  beforeAll(async () => {
    const [business] = await db.insert(businesses).values({ name: `${PREFIX}_business` }).returning({ id: businesses.id });
    businessId = business!.id;

    const [brand] = await db.insert(brands).values({ businessId, name: `${PREFIX}_brand` }).returning({ id: brands.id });

    const [outlet] = await db
      .insert(outlets)
      .values({ businessId, brandId: brand!.id, code: "SDED", name: "Outlet Uji Potong Stok", cashEnabled: true })
      .returning({ id: outlets.id });
    outletId = outlet!.id;

    const [tier] = await db
      .insert(priceTiers)
      .values({ businessId, code: "DINEIN", name: "Dine-in", isDefault: true })
      .returning({ id: priceTiers.id });
    priceTierId = tier!.id;

    const [cash] = await db
      .insert(paymentMethods)
      .values({ businessId, code: "CASH", name: "Tunai", type: "cash", isCashDrawer: true })
      .returning({ id: paymentMethods.id });
    cashMethodId = cash!.id;
  });

  afterAll(async () => {
    if (businessId) {
      // stock_movements.business_id -- NO ACTION (append-only ledger, sama
      // pola stock-transfers/stock-opnames test), harus dihapus manual
      // sebelum businesses.
      await db.delete(stockMovements).where(eq(stockMovements.businessId, businessId));
      await db.delete(orders).where(eq(orders.businessId, businessId));
      await db.delete(shifts).where(eq(shifts.businessId, businessId));
      await db.delete(businesses).where(eq(businesses.id, businessId));
    }
  });

  it("data uji terbentuk", () => {
    expect(businessId).toBeTruthy();
    expect(outletId).toBeTruthy();
    expect(priceTierId).toBeTruthy();
    expect(cashMethodId).toBeTruthy();
  });

  describe("1. Dua produk beda memakai bahan yang SAMA dalam satu order", () => {
    it("movement kedua melihat saldo hasil movement pertama, bukan snapshot awal", async () => {
      const devId = await openFreshShift("SHARED");

      const [ingredient] = await db
        .insert(ingredients)
        .values({ businessId, name: `${PREFIX}_susu`, baseUnit: "ml", purchaseUnit: "liter", purchaseFactor: "1000" })
        .returning({ id: ingredients.id });
      const ingredientId = ingredient!.id;
      await db.insert(stockLevels).values({ businessId, ingredientId, outletId, qtyOnHand: "1000", avgCost: "10" });

      // Dua produk BEDA, resep sama-sama pakai ingredientId di atas.
      const [productA] = await db
        .insert(products)
        .values({ businessId, name: `${PREFIX}_produk_A`, isTaxable: false })
        .returning({ id: products.id });
      await db.insert(productPrices).values({ productId: productA!.id, priceTierId, price: "15000" });
      const [recipeA] = await db.insert(recipes).values({ businessId, productId: productA!.id }).returning({ id: recipes.id });
      await db.insert(recipeItems).values({ recipeId: recipeA!.id, businessId, ingredientId, qty: "100" });

      const [productB] = await db
        .insert(products)
        .values({ businessId, name: `${PREFIX}_produk_B`, isTaxable: false })
        .returning({ id: products.id });
      await db.insert(productPrices).values({ productId: productB!.id, priceTierId, price: "18000" });
      const [recipeB] = await db.insert(recipes).values({ businessId, productId: productB!.id }).returning({ id: recipes.id });
      await db.insert(recipeItems).values({ recipeId: recipeB!.id, businessId, ingredientId, qty: "150" });

      const orderId = generateId();
      const lineAId = generateId();
      const lineBId = generateId();
      const result = await payOrderWithDb(db, businessId, {
        orderId,
        outletId,
        deviceId: devId,
        priceTierId,
        lines: [
          { id: lineAId, productId: productA!.id, variantId: null, modifierIds: [], qty: "1", itemDiscount: "0", note: "" },
          { id: lineBId, productId: productB!.id, variantId: null, modifierIds: [], qty: "1", itemDiscount: "0", note: "" },
        ],
        discountType: "none",
        orderDiscountAmount: "0",
        orderDiscountPercentInput: "0",
        payments: [{ id: generateId(), paymentMethodId: cashMethodId, amount: "999999", reference: "" }],
      });
      expect(result.error).toBeUndefined();

      // Total terpotong 100 (A) + 150 (B) = 250 dari 1000 -> 750.
      const finalStock = await getStock(ingredientId);
      expect(finalStock!.qty.toString()).toBe("750");

      const movementRows = await db
        .select({ qty: stockMovements.qty, balanceAfter: stockMovements.balanceAfter })
        .from(stockMovements)
        .where(and(eq(stockMovements.ingredientId, ingredientId), eq(stockMovements.refId, orderId)))
        .orderBy(stockMovements.createdAt);
      expect(movementRows).toHaveLength(2);
      // Movement PERTAMA (baris A): 1000 - 100 = 900.
      expect(new Decimal(movementRows[0]!.qty).toString()).toBe("-100");
      expect(new Decimal(movementRows[0]!.balanceAfter).toString()).toBe("900");
      // Movement KEDUA (baris B) HARUS melihat saldo 900 (hasil movement
      // pertama), BUKAN snapshot 1000 sebelum transaksi -- 900 - 150 = 750.
      expect(new Decimal(movementRows[1]!.qty).toString()).toBe("-150");
      expect(new Decimal(movementRows[1]!.balanceAfter).toString()).toBe("750");
    });
  });

  describe("2. Stok tidak cukup", () => {
    it("transaksi TETAP SUKSES, stockWarnings terisi, saldo minus tercatat benar", async () => {
      const devId = await openFreshShift("SHORT");

      const [ingredient] = await db
        .insert(ingredients)
        .values({ businessId, name: `${PREFIX}_kopi_kurang`, baseUnit: "gram", purchaseUnit: "kg", purchaseFactor: "1000" })
        .returning({ id: ingredients.id });
      const ingredientId = ingredient!.id;
      // Cuma 5 gram tersisa, resep butuh 20 gram -> pasti minus.
      await db.insert(stockLevels).values({ businessId, ingredientId, outletId, qtyOnHand: "5", avgCost: "500" });

      const [product] = await db
        .insert(products)
        .values({ businessId, name: `${PREFIX}_produk_kurang`, isTaxable: false })
        .returning({ id: products.id });
      await db.insert(productPrices).values({ productId: product!.id, priceTierId, price: "20000" });
      const [recipe] = await db.insert(recipes).values({ businessId, productId: product!.id }).returning({ id: recipes.id });
      await db.insert(recipeItems).values({ recipeId: recipe!.id, businessId, ingredientId, qty: "20" });

      const orderId = generateId();
      const lineId = generateId();
      const result = await payOrderWithDb(db, businessId, {
        orderId,
        outletId,
        deviceId: devId,
        priceTierId,
        lines: [{ id: lineId, productId: product!.id, variantId: null, modifierIds: [], qty: "1", itemDiscount: "0", note: "" }],
        discountType: "none",
        orderDiscountAmount: "0",
        orderDiscountPercentInput: "0",
        payments: [{ id: generateId(), paymentMethodId: cashMethodId, amount: "999999", reference: "" }],
      });

      // Transaksi TETAP SUKSES walau stok tidak cukup.
      expect(result.error).toBeUndefined();
      expect(result.success).toBeTruthy();
      expect(result.success!.stockWarnings).toBeTruthy();
      expect(result.success!.stockWarnings).toHaveLength(1);
      expect(result.success!.stockWarnings![0]!.ingredientId).toBe(ingredientId);
      expect(new Decimal(result.success!.stockWarnings![0]!.resultingQty).toString()).toBe("-15");

      const finalStock = await getStock(ingredientId);
      expect(finalStock!.qty.toString()).toBe("-15");
      // avg_cost TIDAK berubah oleh sale walau saldo jadi negatif.
      expect(finalStock!.avgCost.toString()).toBe("500");
    });
  });

  describe("3. Snapshot HPP", () => {
    it("unit_cogs tersimpan TIDAK berubah walau resep diedit sesudahnya", async () => {
      const devId = await openFreshShift("SNAP");

      const [ingredient] = await db
        .insert(ingredients)
        .values({ businessId, name: `${PREFIX}_bahan_snapshot`, baseUnit: "gram", purchaseUnit: "kg", purchaseFactor: "1000" })
        .returning({ id: ingredients.id });
      const ingredientId = ingredient!.id;
      await db.insert(stockLevels).values({ businessId, ingredientId, outletId, qtyOnHand: "1000", avgCost: "100" });

      const [product] = await db
        .insert(products)
        .values({ businessId, name: `${PREFIX}_produk_snapshot`, isTaxable: false })
        .returning({ id: products.id });
      await db.insert(productPrices).values({ productId: product!.id, priceTierId, price: "20000" });
      const [recipe] = await db.insert(recipes).values({ businessId, productId: product!.id }).returning({ id: recipes.id });
      // 10 gram x avg_cost 100 = HPP 1000 per unit SAAT transaksi ini.
      await db.insert(recipeItems).values({ recipeId: recipe!.id, businessId, ingredientId, qty: "10" });

      const orderId = generateId();
      const lineId = generateId();
      const result = await payOrderWithDb(db, businessId, {
        orderId,
        outletId,
        deviceId: devId,
        priceTierId,
        lines: [{ id: lineId, productId: product!.id, variantId: null, modifierIds: [], qty: "1", itemDiscount: "0", note: "" }],
        discountType: "none",
        orderDiscountAmount: "0",
        orderDiscountPercentInput: "0",
        payments: [{ id: generateId(), paymentMethodId: cashMethodId, amount: "999999", reference: "" }],
      });
      expect(result.error).toBeUndefined();

      const [itemBefore] = await db.select({ unitCogs: orderItems.unitCogs }).from(orderItems).where(eq(orderItems.id, lineId));
      expect(new Decimal(itemBefore!.unitCogs).toString()).toBe("1000");

      // EDIT resep SETELAH transaksi tersimpan -- qty per unit naik jadi 50
      // gram (HPP baru seharusnya 5000/unit kalau dihitung ulang).
      await db.update(recipeItems).set({ qty: "50" }).where(eq(recipeItems.recipeId, recipe!.id));

      const [itemAfter] = await db.select({ unitCogs: orderItems.unitCogs }).from(orderItems).where(eq(orderItems.id, lineId));
      // TIDAK BERUBAH -- angka yang dibekukan saat transaksi, bukan live join.
      expect(new Decimal(itemAfter!.unitCogs).toString()).toBe("1000");
    });
  });

  describe("4. Konsumsi bahan dari modifier", () => {
    it("modifier dengan ingredient_id+ingredient_qty ikut memotong stok, skala ikut qty baris", async () => {
      const devId = await openFreshShift("MODSTOCK");

      const [ingredient] = await db
        .insert(ingredients)
        .values({ businessId, name: `${PREFIX}_keju_modifier`, baseUnit: "gram", purchaseUnit: "kg", purchaseFactor: "1000" })
        .returning({ id: ingredients.id });
      const ingredientId = ingredient!.id;
      await db.insert(stockLevels).values({ businessId, ingredientId, outletId, qtyOnHand: "500", avgCost: "200" });

      // Produk TANPA resep -- yang dites di sini murni konsumsi modifier.
      const [product] = await db
        .insert(products)
        .values({ businessId, name: `${PREFIX}_produk_modstock`, isTaxable: false })
        .returning({ id: products.id });
      await db.insert(productPrices).values({ productId: product!.id, priceTierId, price: "15000" });

      const [modGroup] = await db
        .insert(modifierGroups)
        .values({ businessId, name: `${PREFIX}_topping` })
        .returning({ id: modifierGroups.id });
      const [modifier] = await db
        .insert(modifiers)
        .values({
          modifierGroupId: modGroup!.id,
          name: "Extra Keju",
          price: "5000",
          ingredientId,
          ingredientQty: "30", // 30 gram keju per unit
        })
        .returning({ id: modifiers.id });
      const modifierId = modifier!.id;

      const orderId = generateId();
      const lineId = generateId();
      const qty = "3"; // 3 unit -> konsumsi total 90 gram
      const result = await payOrderWithDb(db, businessId, {
        orderId,
        outletId,
        deviceId: devId,
        priceTierId,
        lines: [{ id: lineId, productId: product!.id, variantId: null, modifierIds: [modifierId], qty, itemDiscount: "0", note: "" }],
        discountType: "none",
        orderDiscountAmount: "0",
        orderDiscountPercentInput: "0",
        payments: [{ id: generateId(), paymentMethodId: cashMethodId, amount: "999999", reference: "" }],
      });
      expect(result.error).toBeUndefined();

      const finalStock = await getStock(ingredientId);
      expect(finalStock!.qty.toString()).toBe("410"); // 500 - (30*3)

      const [modRow] = await db
        .select({ unitCogs: orderItemModifiers.unitCogs })
        .from(orderItemModifiers)
        .where(eq(orderItemModifiers.orderItemId, lineId));
      // unitCogs modifier = ingredientQty(30) x avgCost(200) = 6000, PER UNIT.
      expect(new Decimal(modRow!.unitCogs).toString()).toBe("6000");

      const [itemRow] = await db.select({ unitCogs: orderItems.unitCogs }).from(orderItems).where(eq(orderItems.id, lineId));
      // Produk tanpa resep + satu modifier -> unitCogs baris = HPP modifier saja.
      expect(new Decimal(itemRow!.unitCogs).toString()).toBe("6000");
    });
  });

  describe("5. Produk tanpa resep aktif", () => {
    it("tidak ada movement yang ditulis, unit_cogs tetap 0", async () => {
      const devId = await openFreshShift("NORECIPE");

      const [product] = await db
        .insert(products)
        .values({ businessId, name: `${PREFIX}_produk_tanpa_resep`, isTaxable: false })
        .returning({ id: products.id });
      await db.insert(productPrices).values({ productId: product!.id, priceTierId, price: "10000" });

      const orderId = generateId();
      const lineId = generateId();
      const result = await payOrderWithDb(db, businessId, {
        orderId,
        outletId,
        deviceId: devId,
        priceTierId,
        lines: [{ id: lineId, productId: product!.id, variantId: null, modifierIds: [], qty: "1", itemDiscount: "0", note: "" }],
        discountType: "none",
        orderDiscountAmount: "0",
        orderDiscountPercentInput: "0",
        payments: [{ id: generateId(), paymentMethodId: cashMethodId, amount: "999999", reference: "" }],
      });
      expect(result.error).toBeUndefined();
      expect(result.success!.stockWarnings).toBeUndefined();

      const movementRows = await db.select().from(stockMovements).where(eq(stockMovements.refId, orderId));
      expect(movementRows).toHaveLength(0);

      const [itemRow] = await db.select({ unitCogs: orderItems.unitCogs, cogsAmount: orderItems.cogsAmount }).from(orderItems).where(eq(orderItems.id, lineId));
      expect(new Decimal(itemRow!.unitCogs).toString()).toBe("0");
      expect(new Decimal(itemRow!.cogsAmount).toString()).toBe("0");
    });
  });
});
