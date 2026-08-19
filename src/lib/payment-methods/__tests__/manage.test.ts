/**
 * Audit kelengkapan master data -- hapus permanen metode pembayaran TIDAK
 * BISA diurungkan, satu-satunya kondisi block (sudah pernah dipakai
 * transaksi) butuh order sungguhan -- pakai payOrderWithDb (T13, sudah
 * teruji sendiri) untuk fixture-nya, sama pola dengan
 * lib/modifiers/__tests__/manage.test.ts.
 *
 * Lewat getUserDb() (via createUserDbFixture), BUKAN getAdminDb() -- lihat
 * komentar di lib/categories/__tests__/manage.test.ts untuk alasannya.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
import { eq } from "drizzle-orm";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import {
  brands,
  devices,
  employees,
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
import { deletePaymentMethodWithDb } from "../manage";
import { createUserDbFixture, type UserDbFixture } from "@/lib/db/__tests__/helpers/user-db-fixture";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

describe.skipIf(!hasEnv)("payment-methods/manage — hapus permanen", () => {
  const PIN = "975310";
  const EMPLOYEE_CODE = "PMKASIR";

  let fixture: UserDbFixture;
  let outletId: string;
  let deviceId: string;
  let priceTierId: string;
  let productId: string;

  beforeAll(async () => {
    fixture = await createUserDbFixture("TEST_PAYMENTMETHODS");
    const { db, businessId } = fixture;

    const [brand] = await db
      .insert(brands)
      .values({ businessId, name: "brand" })
      .returning({ id: brands.id });

    const [outlet] = await db
      .insert(outlets)
      .values({ businessId, brandId: brand!.id, code: "PM1", name: "outlet" })
      .returning({ id: outlets.id });
    outletId = outlet!.id;

    const [device] = await db
      .insert(devices)
      .values({ businessId, outletId, serialNumber: "PMDEV1", name: "Kasir Uji Payment" })
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
    await db.insert(productPrices).values({ productId, priceTierId, price: "15000" });

    const shiftResult = await openShiftWithDb(db, businessId, {
      id: generateId(),
      outletId,
      deviceId,
      employeeCode: EMPLOYEE_CODE,
      pin: PIN,
      openingCash: "0",
    });
    expect(shiftResult.success).toBeTruthy();
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
  });

  it("metode pembayaran yang BELUM pernah dipakai -- berhasil dihapus", async () => {
    const { db, businessId } = fixture;
    const [pm] = await db
      .insert(paymentMethods)
      .values({ businessId, code: "UNUSED", name: "unused", type: "transfer" })
      .returning({ id: paymentMethods.id });
    const paymentMethodId = pm!.id;

    const result = await deletePaymentMethodWithDb(db, businessId, { id: paymentMethodId });
    expect(result.success).toBeTruthy();
    expect(result.error).toBeUndefined();

    const [row] = await db
      .select()
      .from(paymentMethods)
      .where(eq(paymentMethods.id, paymentMethodId));
    expect(row).toBeUndefined();
  });

  it("metode pembayaran dipakai di 2 transaksi -- DITOLAK, pesan menyebutkan jumlah yang benar, metode tetap ada", async () => {
    const { db, businessId } = fixture;
    const [pm] = await db
      .insert(paymentMethods)
      .values({ businessId, code: "USED", name: "used", type: "qris" })
      .returning({ id: paymentMethods.id });
    const paymentMethodId = pm!.id;

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
            modifierIds: [],
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

    const result = await deletePaymentMethodWithDb(db, businessId, { id: paymentMethodId });
    expect(result.error).toBeTruthy();
    expect(result.error).toContain("2 transaksi");
    expect(result.success).toBeUndefined();

    const [row] = await db
      .select()
      .from(paymentMethods)
      .where(eq(paymentMethods.id, paymentMethodId));
    expect(row).toBeTruthy();
  });
});
