/**
 * Pembatasan akses per outlet -- Tahap 3 (13 September 2026, §24): halaman
 * PERTAMA yang dipasangi filter, Dashboard (`app/(dashboard)/page.tsx`).
 * File ini menguji getSalesByBrand() -- satu dari tiga fungsi yang
 * dashboard pakai (dua lainnya, getOpenShiftsForBusiness/
 * getShiftsNeedingReview, dites di lib/pos/__tests__/shift-outlet-scope.test.ts).
 *
 * TIGA TES WAJIB per halaman (keputusan CEO eksplisit):
 * 1. scope null (owner/akuntan): SEMUA outlet ikut terhitung.
 * 2. scope satu outlet (manajer dibatasi): CUMA outlet itu yang
 *    terhitung, outlet lain TIDAK ADA jejaknya di angka maupun daftar
 *    outletIds -- bukan cuma "difilter dari tampilan", benar-benar
 *    tidak ikut agregasi SQL.
 * 3. scope array KOSONG: NOL baris (brand ini tidak muncul sama sekali),
 *    BUKAN brand muncul dengan angka nol yang bisa disalahartikan
 *    "toko sepi". Ini kasus yang CEO bilang paling sering dilewatkan.
 *
 * Dibuktikan lewat order SUNGGUHAN (payOrderWithDb), bukan baris orders
 * yang di-insert manual -- pola sama sales-report.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { eq } from "drizzle-orm";
import { Decimal } from "decimal.js";
import { getAdminDb } from "@/lib/db/client";
import {
  brands,
  businesses,
  devices,
  employees,
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
import { businessDate } from "@/lib/utils/business-date";
import { openShiftWithDb } from "@/lib/pos/shift";
import { submitPrepareReportWithDb } from "@/lib/pos/shift-report";
import { payOrderWithDb } from "@/lib/pos/pay-order";
import { getSalesByBrand } from "../sales-report";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

describe.skipIf(!hasEnv)("Pembatasan akses per outlet, Tahap 3 -- getSalesByBrand (Dashboard)", () => {
  const db = getAdminDb();
  const PREFIX = `TEST_BRANDSCOPE_${Date.now()}`;

  let businessId: string;
  let brandId: string;
  let outletAId: string;
  let outletBId: string;
  let today: string;
  let qrisMethodId: string;
  let priceTierId: string;
  let productId: string; // 50000, isTaxable=false -> netAmount = 50000 * qty persis

  async function setupOutlet(code: string, employeeCode: string, pin: string) {
    const [outlet] = await db
      .insert(outlets)
      .values({ businessId, brandId, code, name: `${PREFIX}_${code}` })
      .returning({ id: outlets.id, dayCutoffTime: outlets.dayCutoffTime });
    const outletId = outlet!.id;

    const [device] = await db
      .insert(devices)
      .values({ businessId, outletId, serialNumber: `${code}-DEV1`, name: `Kasir ${code}` })
      .returning({ id: devices.id });

    const pinHash = await hashPin(pin);
    await db.insert(employees).values({
      businessId,
      outletId,
      code: employeeCode,
      fullName: `${PREFIX}_${employeeCode}`,
      role: "cashier",
      pinHash,
    });

    const openResult = await openShiftWithDb(db, businessId, {
      id: generateId(),
      outletId,
      deviceId: device!.id,
      employeeCode,
      pin,
      openingCash: "0",
    });
    expect(openResult.success).toBeTruthy();
    // Rencana Revisi 24 September 2026 -- laporan Prepare sekarang gerbang
    // WAJIB untuk SETIAP shift -- tidak relevan dengan yang diuji file ini.
    await submitPrepareReportWithDb(db, businessId, {
      shiftId: openResult.success!.shiftId,
      photo: { photoPath: "test/prepare.jpg" },
      hasEvent: false,
    });

    return { outletId, deviceId: device!.id };
  }

  async function payOrder(outletId: string, deviceId: string, qty: string) {
    const orderId = generateId();
    const result = await payOrderWithDb(db, businessId, {
      orderId,
      outletId,
      deviceId,
      priceTierId,
      lines: [
        {
          id: generateId(),
          productId,
          variantId: null,
          modifierIds: [],
          qty,
          itemDiscount: "0",
          note: "",
        },
      ],
      discountType: "none",
      orderDiscountAmount: "0",
      orderDiscountPercentInput: "0",
      payments: [{ id: generateId(), paymentMethodId: qrisMethodId, amount: "999999", reference: "REF" }],
    });
    expect(result.success).toBeTruthy();
  }

  beforeAll(async () => {
    const [business] = await db
      .insert(businesses)
      .values({ name: `${PREFIX}_business` })
      .returning({ id: businesses.id, timezone: businesses.timezone });
    businessId = business!.id;

    const [brand] = await db.insert(brands).values({ businessId, name: `${PREFIX}_brand` }).returning({ id: brands.id });
    brandId = brand!.id;

    const [qris] = await db
      .insert(paymentMethods)
      .values({ businessId, code: "QRIS", name: "QRIS", type: "qris", isCashDrawer: false })
      .returning({ id: paymentMethods.id });
    qrisMethodId = qris!.id;

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
    await db.insert(productPrices).values({ productId, priceTierId, price: "50000" });

    const a = await setupOutlet("BSA", "BSAKASIR", "111111");
    const b = await setupOutlet("BSB", "BSBKASIR", "222222");
    outletAId = a.outletId;
    outletBId = b.outletId;

    today = businessDate(new Date(), business!.timezone, "04:00:00");

    // Outlet A: 1x qty (netSales 50000). Outlet B: 2x qty (netSales
    // 100000) -- sengaja beda supaya tidak mungkin tertukar kalau
    // implementasinya salah menghitung outlet yang salah.
    await payOrder(outletAId, a.deviceId, "1");
    await payOrder(outletBId, b.deviceId, "2");
  });

  afterAll(async () => {
    if (businessId) {
      await db.delete(orders).where(eq(orders.businessId, businessId));
      await db.delete(shifts).where(eq(shifts.businessId, businessId));
      await db.delete(businesses).where(eq(businesses.id, businessId));
    }
  });

  it("data uji terbentuk (dua outlet, masing-masing punya order hari ini)", () => {
    expect(outletAId).toBeTruthy();
    expect(outletBId).toBeTruthy();
  });

  it("scope null (owner/akuntan): KEDUA outlet terhitung, netSales gabungan 150000", async () => {
    const rows = await getSalesByBrand(db, { businessId, startDate: today, endDate: today, allowedOutletIds: null });
    const row = rows.find((r) => r.brandId === brandId);
    expect(row).toBeTruthy();
    expect(row!.outletIds.sort()).toEqual([outletAId, outletBId].sort());
    expect(new Decimal(row!.netSales).toString()).toBe("150000");
    expect(row!.orderCount).toBe(2);
  });

  it("scope [outletA] (manajer dibatasi): CUMA outlet A terhitung, outlet B tidak ada jejaknya", async () => {
    const rows = await getSalesByBrand(db, {
      businessId,
      startDate: today,
      endDate: today,
      allowedOutletIds: [outletAId],
    });
    const row = rows.find((r) => r.brandId === brandId);
    expect(row).toBeTruthy();
    expect(row!.outletIds).toEqual([outletAId]);
    expect(new Decimal(row!.netSales).toString()).toBe("50000");
    expect(row!.orderCount).toBe(1);
  });

  it("scope array KOSONG: brand ini TIDAK MUNCUL SAMA SEKALI -- nol baris, bukan baris dengan angka nol", async () => {
    const rows = await getSalesByBrand(db, { businessId, startDate: today, endDate: today, allowedOutletIds: [] });
    const row = rows.find((r) => r.brandId === brandId);
    expect(row).toBeUndefined();
  });
});
