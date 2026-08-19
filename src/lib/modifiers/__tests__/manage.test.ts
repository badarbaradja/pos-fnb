/**
 * Audit kelengkapan master data -- hapus permanen item modifier TIDAK BISA
 * diurungkan, satu-satunya kondisi block modifiers (sudah pernah dipesan)
 * butuh order sungguhan -- pakai payOrderWithDb (T13, sudah teruji sendiri)
 * untuk fixture-nya, bukan insert manual ke order_item_modifiers, supaya
 * skenarionya realistis (jalur yang sama persis dipakai kasir).
 *
 * Lewat getUserDb() (via createUserDbFixture), BUKAN getAdminDb() -- lihat
 * komentar di lib/categories/__tests__/manage.test.ts untuk alasannya.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
import { eq } from "drizzle-orm";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import {
  devices,
  employees,
  modifierGroups,
  modifiers,
  outlets,
  paymentMethods,
  priceTiers,
  productPrices,
  products,
} from "@/lib/db/schema";
import { hashPin } from "@/lib/auth/pin";
import { generateId } from "@/lib/utils/id";
import { openShiftWithDb } from "@/lib/pos/shift";
import { payOrderWithDb } from "@/lib/pos/pay-order";
import { deleteModifierWithDb } from "../manage";
import { createUserDbFixture, type UserDbFixture } from "@/lib/db/__tests__/helpers/user-db-fixture";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

describe.skipIf(!hasEnv)("modifiers/manage — hapus permanen", () => {
  const PIN = "246810";
  const EMPLOYEE_CODE = "MODKASIR";

  let fixture: UserDbFixture;
  let outletId: string;
  let deviceId: string;
  let priceTierId: string;
  let productId: string;
  let paymentMethodId: string;
  let modifierGroupId: string;

  beforeAll(async () => {
    fixture = await createUserDbFixture("TEST_MODIFIERS");
    const { db, businessId } = fixture;

    const [outlet] = await db
      .insert(outlets)
      .values({ businessId, code: "MOD1", name: "outlet" })
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
      fullName: "employee",
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
      .values({ businessId, name: "product", isTaxable: false })
      .returning({ id: products.id });
    productId = product!.id;
    await db.insert(productPrices).values({ productId, priceTierId, price: "20000" });

    const [group] = await db
      .insert(modifierGroups)
      .values({ businessId, name: "group" })
      .returning({ id: modifierGroups.id });
    modifierGroupId = group!.id;
  });

  afterAll(async () => {
    // fixture.cleanup() sekarang menemukan & menghapus tabel penghalang
    // (orders, shifts, dkk, FK ON DELETE NO ACTION ke businesses) secara
    // otomatis lewat information_schema -- lihat lib/db/__tests__/helpers/
    // user-db-fixture.ts. Tidak perlu lagi daftar manual di sini.
    if (fixture) {
      await fixture.cleanup();
    }
  });

  it("data uji benar-benar terbentuk sebelum diuji (bukan hijau karena kosong)", () => {
    expect(fixture.businessId).toBeTruthy();
    expect(productId).toBeTruthy();
    expect(modifierGroupId).toBeTruthy();
  });

  it("item modifier yang BELUM pernah dipesan -- berhasil dihapus", async () => {
    const { db, businessId } = fixture;
    const [modifier] = await db
      .insert(modifiers)
      .values({ modifierGroupId, name: "unused", price: "1000" })
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
    const { db, businessId } = fixture;
    const [modifier] = await db
      .insert(modifiers)
      .values({ modifierGroupId, name: "ordered", price: "2000" })
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
