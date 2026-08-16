/**
 * Audit kelengkapan master data -- hapus permanen item modifier TIDAK BISA
 * diurungkan, satu-satunya kondisi block modifiers (sudah pernah dipesan)
 * butuh order sungguhan -- pakai payOrderWithDb (T13, sudah teruji sendiri)
 * untuk fixture-nya, bukan insert manual ke order_item_modifiers, supaya
 * skenarionya realistis (jalur yang sama persis dipakai kasir).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
import { eq } from "drizzle-orm";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { getAdminDb } from "@/lib/db/client";
import {
  businesses,
  devices,
  employees,
  modifierGroups,
  modifiers,
  orders,
  outlets,
  paymentMethods,
  priceTiers,
  productPrices,
  products,
  shifts,
} from "@/lib/db/schema";
import { hashPin } from "@/lib/auth/pin";
import { generateId } from "@/lib/utils/id";
import { openShiftWithDb } from "@/lib/pos/shift";
import { payOrderWithDb } from "@/lib/pos/pay-order";
import { deleteModifierWithDb } from "../manage";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

describe.skipIf(!hasEnv)("modifiers/manage — hapus permanen", () => {
  const db = getAdminDb();
  const PREFIX = `TEST_MODIFIERS_${Date.now()}`;
  const PIN = "246810";
  const EMPLOYEE_CODE = "MODKASIR";

  let businessId: string;
  let outletId: string;
  let deviceId: string;
  let priceTierId: string;
  let productId: string;
  let paymentMethodId: string;
  let modifierGroupId: string;

  beforeAll(async () => {
    const [business] = await db
      .insert(businesses)
      .values({ name: `${PREFIX}_business` })
      .returning({ id: businesses.id });
    businessId = business!.id;

    const [outlet] = await db
      .insert(outlets)
      .values({ businessId, code: "MOD1", name: `${PREFIX}_outlet` })
      .returning({ id: outlets.id });
    outletId = outlet!.id;

    const [device] = await db
      .insert(devices)
      .values({ businessId, outletId, serialNumber: "MODDEV1", name: "Kasir Uji Modifier" })
      .returning({ id: devices.id });
    deviceId = device!.id;

    const pinHash = await hashPin(PIN);
    await db.insert(employees).values({
      businessId,
      outletId,
      code: EMPLOYEE_CODE,
      fullName: `${PREFIX}_employee`,
      role: "cashier",
      pinHash,
    });

    const [pm] = await db
      .insert(paymentMethods)
      .values({ businessId, code: "QRIS", name: "QRIS", type: "qris", isCashDrawer: false })
      .returning({ id: paymentMethods.id });
    paymentMethodId = pm!.id;

    const [tier] = await db
      .insert(priceTiers)
      .values({ businessId, code: "DINEIN", name: "Dine In", isDefault: true })
      .returning({ id: priceTiers.id });
    priceTierId = tier!.id;

    const [product] = await db
      .insert(products)
      .values({ businessId, name: `${PREFIX}_product`, isTaxable: false })
      .returning({ id: products.id });
    productId = product!.id;
    await db.insert(productPrices).values({ productId, priceTierId, price: "20000" });

    const [group] = await db
      .insert(modifierGroups)
      .values({ businessId, name: `${PREFIX}_group` })
      .returning({ id: modifierGroups.id });
    modifierGroupId = group!.id;
  });

  afterAll(async () => {
    // Urutan hapus (FK, sama pelajaran void-refund.test.ts): orders (cascade
    // order_items -> order_item_modifiers) -> shifts -> businesses (cascade
    // sisanya, termasuk modifier_groups -> modifiers).
    if (businessId) {
      await db.delete(orders).where(eq(orders.businessId, businessId));
      await db.delete(shifts).where(eq(shifts.businessId, businessId));
      await db.delete(businesses).where(eq(businesses.id, businessId));
    }
  });

  it("data uji benar-benar terbentuk sebelum diuji (bukan hijau karena kosong)", () => {
    expect(businessId).toBeTruthy();
    expect(productId).toBeTruthy();
    expect(modifierGroupId).toBeTruthy();
  });

  it("item modifier yang BELUM pernah dipesan -- berhasil dihapus", async () => {
    const [modifier] = await db
      .insert(modifiers)
      .values({ modifierGroupId, name: `${PREFIX}_unused`, price: "1000" })
      .returning({ id: modifiers.id });
    const modifierId = modifier!.id;

    const result = await deleteModifierWithDb(db, businessId, {
      id: modifierId,
      modifierGroupId,
    });
    expect(result.success).toBeTruthy();
    expect(result.error).toBeUndefined();

    const [row] = await db.select().from(modifiers).where(eq(modifiers.id, modifierId));
    expect(row).toBeUndefined();
  });

  it("item modifier yang sudah dipesan 2 kali -- DITOLAK, pesan menyebutkan jumlah yang benar, item tetap ada", async () => {
    const [modifier] = await db
      .insert(modifiers)
      .values({ modifierGroupId, name: `${PREFIX}_ordered`, price: "2000" })
      .returning({ id: modifiers.id });
    const modifierId = modifier!.id;

    const shiftResult = await openShiftWithDb(db, businessId, {
      id: generateId(),
      outletId,
      deviceId,
      employeeCode: EMPLOYEE_CODE,
      pin: PIN,
      openingCash: "0",
    });
    expect(shiftResult.success).toBeTruthy();

    // Dua order terpisah yang sama-sama pakai modifier ini -- dua baris di
    // order_item_modifiers, bukan satu order dengan qty 2 (line item cuma
    // punya modifierIds sebagai SET, bukan qty per modifier).
    for (let i = 0; i < 2; i++) {
      const payResult = await payOrderWithDb(db, businessId, {
        orderId: generateId(),
        outletId,
        deviceId,
        priceTierId,
        lines: [
          {
            id: generateId(),
            productId,
            variantId: null,
            modifierIds: [modifierId],
            qty: "1",
            itemDiscount: "0",
            note: "",
          },
        ],
        discountType: "none",
        orderDiscountAmount: "0",
        orderDiscountPercentInput: "0",
        payments: [
          { id: generateId(), paymentMethodId, amount: "999999", reference: "REF" },
        ],
      });
      expect(payResult.success).toBeTruthy();
    }

    const result = await deleteModifierWithDb(db, businessId, {
      id: modifierId,
      modifierGroupId,
    });
    expect(result.error).toBeTruthy();
    expect(result.error).toContain("2 transaksi");
    expect(result.success).toBeUndefined();

    const [row] = await db.select().from(modifiers).where(eq(modifiers.id, modifierId));
    expect(row).toBeTruthy();
  });
});
