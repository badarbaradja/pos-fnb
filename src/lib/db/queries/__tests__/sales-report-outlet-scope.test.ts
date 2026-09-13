/**
 * Pembatasan akses per outlet -- Tahap 3 (13 September 2026, §24), halaman
 * 2/6: Laporan Penjualan (`app/(dashboard)/reports/sales/page.tsx`).
 *
 * Halaman ini TIDAK menambah parameter baru ke getSalesSummary/dst --
 * SalesReportFilter.outletId SUDAH WAJIB diisi sejak awal (bukan opsional),
 * jadi "wajib bukan opsional" sudah terpenuhi oleh desain yang ada. Yang
 * BARU di Tahap 3: halaman menghitung nilai `outletId` itu lewat
 * `intersectOutletScope(allowedOutletIds, dropdownSelection)`, bukan
 * langsung dari pilihan dropdown mentah -- file ini membuktikan hasil
 * irisan itu benar sampai ke angka laporan, dengan transaksi SUNGGUHAN
 * beroutlet berbeda dan JUMLAH BERBEDA (permintaan CEO eksplisit -- kalau
 * angkanya sama, data yang tertukar tidak akan ketahuan).
 *
 * getSalesSummary = bentuk RINGKASAN (satu baris, tidak pernah "hilang" --
 * scope kosong berarti baris itu semua nol, bukan baris tidak ada).
 * getSalesByProduct = bentuk DAFTAR (scope kosong berarti produk itu
 * TIDAK MUNCUL sama sekali di daftar, bukan muncul dengan qty nol) --
 * ini yang mewakili "baris hilang, bukan baris nol" yang diminta CEO.
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
import { payOrderWithDb } from "@/lib/pos/pay-order";
import { getSalesByProduct, getSalesSummary } from "../sales-report";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

describe.skipIf(!hasEnv)(
  "Pembatasan akses per outlet, Tahap 3 -- getSalesSummary/getSalesByProduct (Laporan Penjualan)",
  () => {
    const db = getAdminDb();
    const PREFIX = `TEST_SALESSCOPE_${Date.now()}`;

    let businessId: string;
    let outletAId: string;
    let outletBId: string;
    let today: string;
    let qrisMethodId: string;
    let priceTierId: string;
    let productId: string; // 50000, isTaxable=false -> netAmount = 50000 * qty persis

    async function setupOutlet(code: string, employeeCode: string, pin: string) {
      const [brand] = await db.insert(brands).values({ businessId, name: `${PREFIX}_${code}_brand` }).returning({ id: brands.id });
      const [outlet] = await db
        .insert(outlets)
        .values({ businessId, brandId: brand!.id, code, name: `${PREFIX}_${code}` })
        .returning({ id: outlets.id });
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

      return { outletId, deviceId: device!.id };
    }

    async function payOrder(outletId: string, deviceId: string, qty: string) {
      const result = await payOrderWithDb(db, businessId, {
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

      const a = await setupOutlet("LPA", "LPAKASIR", "111111");
      const b = await setupOutlet("LPB", "LPBKASIR", "222222");
      outletAId = a.outletId;
      outletBId = b.outletId;

      today = businessDate(new Date(), business!.timezone, "04:00:00");

      // Qty BEDA per outlet (1 vs 4 -> netSales 50000 vs 200000) -- kalau
      // implementasinya salah menyaring outlet, angka gabungan/parsial
      // TIDAK MUNGKIN cocok kebetulan.
      await payOrder(outletAId, a.deviceId, "1");
      await payOrder(outletBId, b.deviceId, "4");
    });

    afterAll(async () => {
      if (businessId) {
        await db.delete(orders).where(eq(orders.businessId, businessId));
        await db.delete(shifts).where(eq(shifts.businessId, businessId));
        await db.delete(businesses).where(eq(businesses.id, businessId));
      }
    });

    it("data uji terbentuk (dua outlet, qty BEDA: 1 vs 4)", () => {
      expect(outletAId).toBeTruthy();
      expect(outletBId).toBeTruthy();
    });

    describe("getSalesSummary", () => {
      it("scope null: netSales gabungan KEDUA outlet (50000 + 200000 = 250000)", async () => {
        const result = await getSalesSummary(db, { businessId, outletId: null, startDate: today, endDate: today });
        expect(new Decimal(result.netSales).toString()).toBe("250000");
        expect(result.orderCount).toBe(2);
      });

      it("scope [outletA] (irisan dropdown+membership): netSales CUMA outlet A (50000), outlet B nol jejak", async () => {
        const result = await getSalesSummary(db, {
          businessId,
          outletId: [outletAId],
          startDate: today,
          endDate: today,
        });
        expect(new Decimal(result.netSales).toString()).toBe("50000");
        expect(result.orderCount).toBe(1);
      });

      it("scope array KOSONG: netSales 0, orderCount 0 (ringkasan tidak punya konsep 'baris hilang', tapi TETAP bukan gabungan)", async () => {
        const result = await getSalesSummary(db, { businessId, outletId: [], startDate: today, endDate: today });
        expect(new Decimal(result.netSales).toString()).toBe("0");
        expect(result.orderCount).toBe(0);
      });
    });

    describe("getSalesByProduct", () => {
      it("scope null: produk muncul dengan qty gabungan (1 + 4 = 5)", async () => {
        const rows = await getSalesByProduct(db, { businessId, outletId: null, startDate: today, endDate: today });
        const row = rows.find((r) => r.productId === productId);
        expect(row).toBeTruthy();
        expect(new Decimal(row!.qty).toString()).toBe("5");
      });

      it("scope [outletB]: produk muncul dengan qty CUMA outlet B (4)", async () => {
        const rows = await getSalesByProduct(db, {
          businessId,
          outletId: [outletBId],
          startDate: today,
          endDate: today,
        });
        const row = rows.find((r) => r.productId === productId);
        expect(row).toBeTruthy();
        expect(new Decimal(row!.qty).toString()).toBe("4");
      });

      it("scope array KOSONG: produk TIDAK MUNCUL SAMA SEKALI -- baris hilang, bukan baris qty nol", async () => {
        const rows = await getSalesByProduct(db, { businessId, outletId: [], startDate: today, endDate: today });
        const row = rows.find((r) => r.productId === productId);
        expect(row).toBeUndefined();
      });
    });
  }
);
