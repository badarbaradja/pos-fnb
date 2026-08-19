/**
 * T17 — Test integrasi laporan penjualan. Butuh koneksi Supabase
 * sungguhan (DATABASE_URL + NEXT_PUBLIC_SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY), sama seperti
 * src/lib/pos/__tests__/void-refund.test.ts -- di-skip otomatis kalau
 * env belum diisi, bukan hijau palsu.
 *
 * getAdminDb() dipakai di sini SENGAJA melewati RLS -- ini test, bukan
 * kode aplikasi, dan fixture-nya bikin business/outlet/device/employee
 * dari nol yang butuh akses penuh untuk setup + assert langsung ke DB.
 *
 * Data uji diberi prefix TEST_SALESREPORT_ dan dibersihkan di afterAll
 * (bukan di akhir tiap test) supaya tetap bersih walau ada test yang
 * gagal di tengah.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
import { eq } from "drizzle-orm";
import { Decimal } from "decimal.js";
import { format, parseISO, subDays } from "date-fns";
loadEnv({ path: [".env.local", ".env"], quiet: true });

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
  refunds,
  shifts,
} from "@/lib/db/schema";
import { hashPin } from "@/lib/auth/pin";
import { generateId } from "@/lib/utils/id";
import { businessDate } from "@/lib/utils/business-date";
import { openShiftWithDb } from "@/lib/pos/shift";
import { payOrderWithDb } from "@/lib/pos/pay-order";
import { refundOrderWithDb, voidOrderWithDb } from "@/lib/pos/void-refund";
import {
  getSalesByDay,
  getSalesByHour,
  getSalesByOutlet,
  getSalesByPaymentMethod,
  getSalesByProduct,
  getSalesSummary,
  type SalesReportFilter,
} from "../sales-report";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

describe.skipIf(!hasEnv)("T17 — laporan penjualan", () => {
  const db = getAdminDb();
  const PREFIX = `TEST_SALESREPORT_${Date.now()}`;
  const PIN = "246813";
  const EMPLOYEE_CODE = "SRKASIR";

  let businessId: string;
  let brandId: string;
  let outletId: string;
  let deviceId: string;
  let qrisMethodId: string;
  let priceTierId: string;
  let productId: string; // harga 50000, isTaxable=false -> netAmount baris = 50000 * qty persis
  let today: string;
  let filter: SalesReportFilter;

  async function payOrder(qty: string) {
    const orderId = generateId();
    const lineId = generateId();
    const result = await payOrderWithDb(db, businessId, {
      orderId,
      outletId,
      deviceId,
      priceTierId,
      lines: [
        {
          id: lineId,
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
      payments: [
        { id: generateId(), paymentMethodId: qrisMethodId, amount: "999999", reference: "REF123" },
      ],
    });
    expect(result.success).toBeTruthy();
    return { orderId, lineId };
  }

  beforeAll(async () => {
    const [business] = await db
      .insert(businesses)
      .values({ name: `${PREFIX}_business` })
      .returning({ id: businesses.id, timezone: businesses.timezone });
    businessId = business!.id;

    const [brand] = await db
      .insert(brands)
      .values({ businessId, name: `${PREFIX}_brand` })
      .returning({ id: brands.id });
    brandId = brand!.id;

    const [outlet] = await db
      .insert(outlets)
      .values({ businessId, brandId, code: "SR1", name: `${PREFIX}_outlet` })
      .returning({ id: outlets.id, dayCutoffTime: outlets.dayCutoffTime });
    outletId = outlet!.id;

    today = businessDate(new Date(), business!.timezone, outlet!.dayCutoffTime);
    filter = { businessId, outletId, startDate: today, endDate: today };

    const [device] = await db
      .insert(devices)
      .values({ businessId, outletId, serialNumber: "SRDEV1", name: "Kasir Uji SR" })
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

    // Shift TERBUKA -- payOrderWithDb (T15) menolak bayar tanpa shift aktif.
    const openResult = await openShiftWithDb(db, businessId, {
      id: generateId(),
      outletId,
      deviceId,
      employeeCode: EMPLOYEE_CODE,
      pin: PIN,
      openingCash: "0",
    });
    expect(openResult.success).toBeTruthy();
  });

  afterAll(async () => {
    // Urutan hapus (FK, pelajaran shift.test.ts/void-refund.test.ts):
    // refunds -> orders -> shifts -> businesses (cascade sisanya).
    if (businessId) {
      const orderRows = await db
        .select({ id: orders.id })
        .from(orders)
        .where(eq(orders.businessId, businessId));
      for (const o of orderRows) {
        await db.delete(refunds).where(eq(refunds.orderId, o.id));
      }
      await db.delete(orders).where(eq(orders.businessId, businessId));
      await db.delete(shifts).where(eq(shifts.businessId, businessId));
      await db.delete(businesses).where(eq(businesses.id, businessId));
    }
  });

  it("data uji benar-benar terbentuk sebelum diuji (bukan hijau karena kosong)", () => {
    expect(businessId).toBeTruthy();
    expect(outletId).toBeTruthy();
    expect(deviceId).toBeTruthy();
    expect(qrisMethodId).toBeTruthy();
    expect(priceTierId).toBeTruthy();
    expect(productId).toBeTruthy();
    expect(today).toBeTruthy();
  });

  it("order void TIDAK masuk getSalesSummary maupun getSalesByProduct", async () => {
    const before = await getSalesSummary(db, filter);

    const { orderId } = await payOrder("1"); // net 50000
    const afterPay = await getSalesSummary(db, filter);
    expect(afterPay.orderCount).toBe(before.orderCount + 1);
    expect(new Decimal(afterPay.netSales).toString()).toBe(
      new Decimal(before.netSales).plus(50000).toString()
    );

    const voidResult = await voidOrderWithDb(db, businessId, null, {
      orderId,
      reason: "uji T17 -- void dikecualikan dari agregasi",
    });
    expect(voidResult.success).toBeTruthy();

    const afterVoid = await getSalesSummary(db, filter);
    expect(afterVoid.orderCount).toBe(before.orderCount);
    expect(afterVoid.netSales).toBe(before.netSales);

    const byProduct = await getSalesByProduct(db, filter);
    const ourProduct = byProduct.find((p) => p.productId === productId);
    // Order yang di-void tidak menyumbang qty/nilai apa pun ke breakdown produk.
    expect(ourProduct === undefined || new Decimal(ourProduct.qty).isZero()).toBe(true);
  });

  it("refund mengurangi net sales di ringkasan, TAPI TIDAK mengubah breakdown per produk", async () => {
    const before = await getSalesSummary(db, filter);
    const beforeByProduct = await getSalesByProduct(db, filter);
    const beforeProductNet = new Decimal(
      beforeByProduct.find((p) => p.productId === productId)?.netAmount ?? "0"
    );

    const { orderId, lineId } = await payOrder("1"); // net 50000
    const afterPay = await getSalesSummary(db, filter);
    expect(new Decimal(afterPay.netSales).toString()).toBe(
      new Decimal(before.netSales).plus(50000).toString()
    );

    const refundResult = await refundOrderWithDb(db, businessId, null, {
      id: generateId(),
      orderId,
      paymentMethodId: qrisMethodId,
      reference: "",
      restock: false,
      reason: "uji T17 -- refund scoping",
      lines: [{ orderItemId: lineId, qty: "1" }],
    });
    expect(refundResult.success).toBeTruthy();

    const afterRefund = await getSalesSummary(db, filter);
    // Net sales RINGKASAN turun kembali oleh jumlah refund penuh (50000).
    expect(new Decimal(afterRefund.netSales).toString()).toBe(
      new Decimal(before.netSales).toString()
    );
    expect(new Decimal(afterRefund.refundTotal).greaterThan(before.refundTotal)).toBe(true);

    const afterByProduct = await getSalesByProduct(db, filter);
    const afterProductNet = new Decimal(
      afterByProduct.find((p) => p.productId === productId)?.netAmount ?? "0"
    );
    // Breakdown per produk TETAP menghitung penuh (keputusan scoping T17 --
    // refund cuma dikurangkan di ringkasan, bukan per breakdown).
    expect(afterProductNet.toString()).toBe(beforeProductNet.plus(50000).toString());
  });

  it("getSalesByPaymentMethod menjumlahkan net dari kembalian, bukan amount mentah yang ditendang", async () => {
    const before = await getSalesByPaymentMethod(db, filter);
    const beforeQris = new Decimal(before.find((m) => m.methodName === "QRIS")?.amount ?? "0");

    await payOrder("1"); // net 50000, tendered 999999 (overpay besar sengaja)

    const after = await getSalesByPaymentMethod(db, filter);
    const afterQris = new Decimal(after.find((m) => m.methodName === "QRIS")?.amount ?? "0");
    // Bertambah 50000 (net), BUKAN 999999 (amount mentah) -- pelajaran bug T15.
    expect(afterQris.toString()).toBe(beforeQris.plus(50000).toString());
  });

  it("filter tanggal memakai business_date, bukan paid_at/created_at", async () => {
    const outsideDate = "2020-01-01"; // jauh di luar rentang manapun yang dipakai test lain

    // business_date DI DALAM rentang filter -- harus ikut kehitung
    // walau paid_at "sekarang" (kolom yang SENGAJA tidak dipakai untuk filter).
    await db.insert(orders).values({
      id: generateId(),
      businessId,
      outletId,
      number: `${PREFIX}-CUTOFF-IN`,
      status: "paid",
      businessDate: today,
      paidAt: new Date(),
      subtotal: "77000",
      discountTotal: "0",
      netSales: "77000",
      taxAmount: "0",
      serviceCharge: "0",
      total: "77000",
    });

    // business_date DI LUAR rentang filter -- harus TIDAK ikut, walau
    // paid_at juga "sekarang" (sama seperti order di atas).
    await db.insert(orders).values({
      id: generateId(),
      businessId,
      outletId,
      number: `${PREFIX}-CUTOFF-OUT`,
      status: "paid",
      businessDate: outsideDate,
      paidAt: new Date(),
      subtotal: "99000",
      discountTotal: "0",
      netSales: "99000",
      taxAmount: "0",
      serviceCharge: "0",
      total: "99000",
    });

    const summaryToday = await getSalesSummary(db, filter);
    expect(new Decimal(summaryToday.grossSales).greaterThanOrEqualTo(77000)).toBe(true);

    const summaryOutside = await getSalesSummary(db, {
      businessId,
      outletId,
      startDate: outsideDate,
      endDate: outsideDate,
    });
    expect(summaryOutside.grossSales).toBe("99000.00");
    expect(summaryOutside.orderCount).toBe(1);
  });

  it("getSalesByDay mengelompokkan per business_date, urut kronologis (T18)", async () => {
    const yesterday = format(subDays(parseISO(today), 1), "yyyy-MM-dd");

    await db.insert(orders).values({
      id: generateId(),
      businessId,
      outletId,
      number: `${PREFIX}-DAY-YDAY`,
      status: "paid",
      businessDate: yesterday,
      paidAt: new Date(),
      subtotal: "30000",
      discountTotal: "0",
      netSales: "30000",
      taxAmount: "0",
      serviceCharge: "0",
      total: "30000",
    });

    const rows = await getSalesByDay(db, {
      businessId,
      outletId,
      startDate: yesterday,
      endDate: today,
    });

    // Urut kronologis (ASC) -- beda dari breakdown lain yang ORDER BY nilai DESC.
    expect(rows.map((r) => r.businessDate)).toEqual([yesterday, today]);
    const yesterdayRow = rows.find((r) => r.businessDate === yesterday);
    expect(new Decimal(yesterdayRow?.netSales ?? "0").toString()).toBe("30000");
  });

  it("getSalesByOutlet memisahkan angka per outlet dengan benar (T18)", async () => {
    const [secondOutlet] = await db
      .insert(outlets)
      .values({ businessId, brandId, code: "SR2", name: `${PREFIX}_outlet2` })
      .returning({ id: outlets.id });
    const secondOutletId = secondOutlet!.id;
    // Tidak perlu cleanup manual -- outlet ini ikut kehapus oleh cascade
    // saat afterAll menghapus businessId (outlets.business_id ON DELETE CASCADE),
    // order barunya ikut kehapus oleh afterAll (delete orders WHERE business_id).

    await db.insert(orders).values({
      id: generateId(),
      businessId,
      outletId: secondOutletId,
      number: `${PREFIX}-OUTLET2-0001`,
      status: "paid",
      businessDate: today,
      paidAt: new Date(),
      subtotal: "45000",
      discountTotal: "0",
      netSales: "45000",
      taxAmount: "0",
      serviceCharge: "0",
      total: "45000",
    });

    const rows = await getSalesByOutlet(db, {
      businessId,
      outletId: null,
      startDate: today,
      endDate: today,
    });

    const outlet1Row = rows.find((r) => r.outletId === outletId);
    const outlet2Row = rows.find((r) => r.outletId === secondOutletId);
    expect(outlet2Row?.outletName).toBe(`${PREFIX}_outlet2`);
    expect(new Decimal(outlet2Row?.netSales ?? "0").toString()).toBe("45000");
    expect(outlet1Row).toBeDefined();
    expect(new Decimal(outlet1Row?.netSales ?? "0").greaterThan(0)).toBe(true);
  });

  it("getSalesByHour pakai timezone BISNIS (WITA), bukan UTC/timezone server", async () => {
    const [witaBusiness] = await db
      .insert(businesses)
      .values({ name: `${PREFIX}_wita_business`, timezone: "Asia/Makassar" })
      .returning({ id: businesses.id });
    const witaBusinessId = witaBusiness!.id;
    const [witaBrand] = await db
      .insert(brands)
      .values({ businessId: witaBusinessId, name: `${PREFIX}_wita_brand` })
      .returning({ id: brands.id });
    const [witaOutlet] = await db
      .insert(outlets)
      .values({
        businessId: witaBusinessId,
        brandId: witaBrand!.id,
        code: "WITA1",
        name: `${PREFIX}_wita_outlet`,
      })
      .returning({ id: outlets.id });
    const witaOutletId = witaOutlet!.id;

    try {
      // 16:30 UTC -> WITA (UTC+8, tanpa DST) = 00:30 keesokan harinya -> jam 0.
      // Kalau kode salah pakai UTC/timezone server, hasilnya akan 16.
      const paidAtUtc = new Date("2026-01-15T16:30:00.000Z");
      const bDate = "2026-01-16";
      await db.insert(orders).values({
        id: generateId(),
        businessId: witaBusinessId,
        outletId: witaOutletId,
        number: "WITA-TEST-0001",
        status: "paid",
        businessDate: bDate,
        paidAt: paidAtUtc,
        subtotal: "10000",
        discountTotal: "0",
        netSales: "10000",
        taxAmount: "0",
        serviceCharge: "0",
        total: "10000",
      });

      const rows = await getSalesByHour(db, {
        businessId: witaBusinessId,
        outletId: null,
        startDate: bDate,
        endDate: bDate,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.hour).toBe(0);
    } finally {
      await db.delete(orders).where(eq(orders.businessId, witaBusinessId));
      await db.delete(businesses).where(eq(businesses.id, witaBusinessId));
    }
  });
});
