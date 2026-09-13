/**
 * Kesiapan sisi F&B (13 September 2026) -- lima jalur `payOrderWithDb`
 * yang SEBELUMNYA cuma teruji sebagai matematika murni
 * (`order-calculator.test.ts`) atau tidak teruji sama sekali lewat
 * pembayaran sungguhan: modifier berharga, varian, pajak > 0, split
 * payment, dan service charge > 0. CEO eksplisit: "kalau ternyata jalur
 * ini TIDAK DIDUKUNG kode yang ada, JANGAN bangun -- laporkan sebagai
 * temuan". File ini MEMBUKTIKAN (bukan memperbaiki) lima jalur itu.
 *
 * Pola: `calculateOrder()` (kalkulator murni, sudah lolos TC-01 s.d.
 * TC-17) dipanggil LANGSUNG di setiap test sebagai ORACLE dengan input
 * yang SAMA PERSIS yang akan dibangun `payOrderWithDb` secara internal
 * dari data outlet/produk/varian/modifier -- lalu hasil yang BENAR-BENAR
 * tersimpan di database dibandingkan ke oracle itu. Ini menghindari
 * risiko salah hitung manual sendiri di dalam test.
 *
 * `getAdminDb()` dipakai untuk SELURUH file ini (setup DAN pemanggilan
 * payOrderWithDb/openShiftWithDb) -- RLS bukan yang sedang dibuktikan
 * di sini, pola sama shift.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { Decimal } from "decimal.js";
import { eq } from "drizzle-orm";
import { getAdminDb } from "@/lib/db/client";
import {
  brands,
  businesses,
  devices,
  employees,
  modifierGroups,
  modifiers,
  orderItemModifiers,
  orderItems,
  orders,
  outlets,
  paymentMethods,
  payments,
  priceTiers,
  productPrices,
  products,
  productVariants,
  shifts,
} from "@/lib/db/schema";
import { hashPin } from "@/lib/auth/pin";
import { generateId } from "@/lib/utils/id";
import { openShiftWithDb } from "@/lib/pos/shift";
import { payOrderWithDb } from "@/lib/pos/pay-order";
import { calculateOrder, type CalcLine, type CalcSettings } from "@/lib/calc/order-calculator";
import { getSalesByProduct, type SalesReportFilter } from "@/lib/db/queries/sales-report";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

const PIN = "778899";

describe.skipIf(!hasEnv)("Kesiapan F&B -- payOrderWithDb: modifier, varian, pajak, split payment, service charge", () => {
  const db = getAdminDb();
  const PREFIX = `TEST_FNBREADY_${Date.now()}`;

  let businessId: string;
  let outletId: string;
  let priceTierId: string;
  let cashMethodId: string;
  let qrisMethodId: string;

  // Outlet gaya Indosteak/Indokopi: pajak 10%, service charge 5% (BUKAN
  // 0% seperti semua outlet nyata hari ini -- sengaja diisi di sini
  // supaya jalurnya benar-benar teraktifkan, terlepas dari data produksi
  // yang belum diisi).
  const TAX_PERCENT = "10";
  const SERVICE_CHARGE_PERCENT = "5";
  const ROUNDING_TO = 100;

  const calcSettings: CalcSettings = {
    discountType: "none",
    orderDiscountPercent: new Decimal(0),
    orderDiscountAmount: new Decimal(0),
    maxDiscount: null,
    serviceChargePercent: new Decimal(SERVICE_CHARGE_PERCENT).dividedBy(100),
    taxPercent: new Decimal(TAX_PERCENT).dividedBy(100),
    taxInclusive: false,
    serviceChargeInTaxBase: true,
    roundingTo: ROUNDING_TO,
    roundingMode: "nearest",
  };

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
    return device!.id;
  }

  beforeAll(async () => {
    const [business] = await db.insert(businesses).values({ name: `${PREFIX}_business` }).returning({ id: businesses.id });
    businessId = business!.id;

    const [brand] = await db.insert(brands).values({ businessId, name: `${PREFIX}_brand` }).returning({ id: brands.id });

    const [outlet] = await db
      .insert(outlets)
      .values({
        businessId,
        brandId: brand!.id,
        code: "FNBR",
        name: "Outlet Uji F&B",
        taxPercent: TAX_PERCENT,
        taxInclusive: false,
        serviceChargePercent: SERVICE_CHARGE_PERCENT,
        serviceChargeInTaxBase: true,
        roundingTo: ROUNDING_TO,
        cashEnabled: true,
      })
      .returning({ id: outlets.id });
    outletId = outlet!.id;

    const [tier] = await db
      .insert(priceTiers)
      .values({ businessId, code: "DINEIN", name: "Dine-in", channel: "dine_in", isDefault: true })
      .returning({ id: priceTiers.id });
    priceTierId = tier!.id;

    const [cash] = await db
      .insert(paymentMethods)
      .values({ businessId, code: "CASH", name: "Tunai", type: "cash", isCashDrawer: true })
      .returning({ id: paymentMethods.id });
    cashMethodId = cash!.id;

    const [qris] = await db
      .insert(paymentMethods)
      .values({ businessId, code: "QRIS", name: "QRIS", type: "qris", isCashDrawer: false })
      .returning({ id: paymentMethods.id });
    qrisMethodId = qris!.id;
  });

  afterAll(async () => {
    // orders.business_id DAN shifts.business_id sama-sama TIDAK cascade
    // dari businesses (NO ACTION) -- hapus dulu sebelum businesses.
    if (businessId) {
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
    expect(qrisMethodId).toBeTruthy();
  });

  describe("1. Modifier berharga > 0", () => {
    it("harga modifier masuk ke total, tersimpan di order_items, dan muncul benar di laporan penjualan", async () => {
      const devId = await openFreshShift("MOD");

      const [product] = await db
        .insert(products)
        .values({ businessId, name: "Kopi Susu (uji modifier)", isTaxable: true })
        .returning({ id: products.id });
      const productId = product!.id;
      await db.insert(productPrices).values({ productId, priceTierId, price: "20000" });

      const [modGroup] = await db
        .insert(modifierGroups)
        .values({ businessId, name: "Topping (uji)" })
        .returning({ id: modifierGroups.id });
      const [modifier] = await db
        .insert(modifiers)
        .values({ modifierGroupId: modGroup!.id, name: "Boba Ekstra", price: "5000" })
        .returning({ id: modifiers.id });
      const modifierId = modifier!.id;

      // Oracle: input yang SAMA persis yang akan dibangun payOrderWithDb
      // secara internal dari data di atas.
      const calcLines: CalcLine[] = [
        {
          id: "oracle",
          qty: new Decimal(1),
          unitPrice: new Decimal(20000),
          modifierTotal: new Decimal(5000),
          itemDiscount: new Decimal(0),
          isTaxable: true,
        },
      ];
      const oracle = calculateOrder(calcLines, calcSettings);

      const orderId = generateId();
      const lineId = generateId();
      const result = await payOrderWithDb(db, businessId, {
        orderId,
        outletId,
        deviceId: devId,
        priceTierId,
        lines: [{ id: lineId, productId, variantId: null, modifierIds: [modifierId], qty: "1", itemDiscount: "0", note: "" }],
        discountType: "none",
        orderDiscountAmount: "0",
        orderDiscountPercentInput: "0",
        payments: [{ id: generateId(), paymentMethodId: cashMethodId, amount: oracle.total.toFixed(2), reference: "" }],
      });

      expect(result.error).toBeUndefined();
      expect(result.success).toBeTruthy();

      const [orderRow] = await db.select().from(orders).where(eq(orders.id, orderId));
      expect(new Decimal(orderRow!.taxAmount).toFixed(2)).toBe(oracle.taxAmount.toFixed(2));
      expect(new Decimal(orderRow!.serviceCharge).toFixed(2)).toBe(oracle.serviceCharge.toFixed(2));
      expect(new Decimal(orderRow!.total).toFixed(2)).toBe(oracle.total.toFixed(2));

      const [itemRow] = await db.select().from(orderItems).where(eq(orderItems.id, lineId));
      expect(new Decimal(itemRow!.grossAmount).toFixed(2)).toBe(oracle.lines[0]!.grossAmount.toFixed(2));
      expect(new Decimal(itemRow!.modifierTotal).toFixed(2)).toBe("5000.00");
      expect(new Decimal(itemRow!.netAmount).toFixed(2)).toBe(oracle.lines[0]!.netAmount.toFixed(2));

      const [modRow] = await db.select().from(orderItemModifiers).where(eq(orderItemModifiers.orderItemId, lineId));
      expect(modRow).toBeTruthy();
      expect(new Decimal(modRow!.price).toFixed(2)).toBe("5000.00");

      // Laporan penjualan: netAmount per produk HARUS sudah mencakup
      // harga modifier (grossAmount = qty * (unitPrice + modifierTotal)
      // di kalkulator, bukan cuma unitPrice).
      const filter: SalesReportFilter = {
        businessId,
        outletId,
        startDate: orderRow!.businessDate,
        endDate: orderRow!.businessDate,
      };
      const byProduct = await getSalesByProduct(db, filter);
      const row = byProduct.find((r) => r.productId === productId);
      expect(row).toBeTruthy();
      expect(new Decimal(row!.netAmount).toFixed(2)).toBe(oracle.lines[0]!.netAmount.toFixed(2));
    });
  });

  describe("2. Varian (variantId non-null)", () => {
    it("harga varian (base + priceDelta) yang dipakai, BUKAN harga produk dasar", async () => {
      const devId = await openFreshShift("VAR");

      const [product] = await db
        .insert(products)
        .values({ businessId, name: "Es Kopi Susu (uji varian)", isTaxable: true })
        .returning({ id: products.id });
      const productId = product!.id;
      await db.insert(productPrices).values({ productId, priceTierId, price: "20000" });

      const [variant] = await db
        .insert(productVariants)
        .values({ productId, name: "Large", priceDelta: "8000" })
        .returning({ id: productVariants.id });
      const variantId = variant!.id;

      const calcLines: CalcLine[] = [
        {
          id: "oracle",
          qty: new Decimal(1),
          unitPrice: new Decimal(20000).plus(8000), // basePrice + variant.priceDelta
          modifierTotal: new Decimal(0),
          itemDiscount: new Decimal(0),
          isTaxable: true,
        },
      ];
      const oracle = calculateOrder(calcLines, calcSettings);

      const orderId = generateId();
      const lineId = generateId();
      const result = await payOrderWithDb(db, businessId, {
        orderId,
        outletId,
        deviceId: devId,
        priceTierId,
        lines: [{ id: lineId, productId, variantId, modifierIds: [], qty: "1", itemDiscount: "0", note: "" }],
        discountType: "none",
        orderDiscountAmount: "0",
        orderDiscountPercentInput: "0",
        payments: [{ id: generateId(), paymentMethodId: cashMethodId, amount: oracle.total.toFixed(2), reference: "" }],
      });

      expect(result.error).toBeUndefined();

      const [itemRow] = await db.select().from(orderItems).where(eq(orderItems.id, lineId));
      // unitPrice tersimpan HARUS basePrice+delta (28000), BUKAN basePrice
      // polos (20000) -- ini bukti langsung "harga varian yang dipakai".
      expect(new Decimal(itemRow!.unitPrice).toFixed(2)).toBe("28000.00");
      expect(itemRow!.variantId).toBe(variantId);
      expect(itemRow!.variantName).toBe("Large");

      const [orderRow] = await db.select().from(orders).where(eq(orders.id, orderId));
      expect(new Decimal(orderRow!.total).toFixed(2)).toBe(oracle.total.toFixed(2));
    });
  });

  describe("3. Pajak > 0 ujung-ke-ujung (outlet 10%, gaya Indosteak/Indokopi)", () => {
    it("taxAmount/total yang tersimpan cocok PERSIS dengan calculateOrder (oracle)", async () => {
      const devId = await openFreshShift("TAX");

      const [product] = await db
        .insert(products)
        .values({ businessId, name: "Nasi Goreng (uji pajak)", isTaxable: true })
        .returning({ id: products.id });
      const productId = product!.id;
      await db.insert(productPrices).values({ productId, priceTierId, price: "18000" });

      const calcLines: CalcLine[] = [
        {
          id: "oracle",
          qty: new Decimal(2),
          unitPrice: new Decimal(18000),
          modifierTotal: new Decimal(0),
          itemDiscount: new Decimal(0),
          isTaxable: true,
        },
      ];
      const oracle = calculateOrder(calcLines, calcSettings);
      // Sanity: pajak harus benar-benar > 0 di skenario ini (bukan
      // kebetulan lolos karena taxAmount = 0).
      expect(oracle.taxAmount.greaterThan(0)).toBe(true);

      const orderId = generateId();
      const lineId = generateId();
      const result = await payOrderWithDb(db, businessId, {
        orderId,
        outletId,
        deviceId: devId,
        priceTierId,
        lines: [{ id: lineId, productId, variantId: null, modifierIds: [], qty: "2", itemDiscount: "0", note: "" }],
        discountType: "none",
        orderDiscountAmount: "0",
        orderDiscountPercentInput: "0",
        payments: [{ id: generateId(), paymentMethodId: cashMethodId, amount: oracle.total.toFixed(2), reference: "" }],
      });

      expect(result.error).toBeUndefined();

      const [orderRow] = await db.select().from(orders).where(eq(orders.id, orderId));
      expect(new Decimal(orderRow!.taxAmount).toFixed(2)).toBe(oracle.taxAmount.toFixed(2));
      expect(new Decimal(orderRow!.rounding).toFixed(2)).toBe(oracle.rounding.toFixed(2));
      expect(new Decimal(orderRow!.total).toFixed(2)).toBe(oracle.total.toFixed(2));
      expect(result.success!.total).toBe(oracle.total.toFixed(2));
    });
  });

  describe("4. Split payment (dua metode bayar dalam satu order)", () => {
    it("dibayar sebagian QRIS + sebagian tunai -- KEDUA baris payments tersimpan, kembalian hanya di baris TERAKHIR", async () => {
      const devId = await openFreshShift("SPLIT");

      const [product] = await db
        .insert(products)
        .values({ businessId, name: "Americano (uji split payment)", isTaxable: true })
        .returning({ id: products.id });
      const productId = product!.id;
      await db.insert(productPrices).values({ productId, priceTierId, price: "20000" });

      const calcLines: CalcLine[] = [
        {
          id: "oracle",
          qty: new Decimal(1),
          unitPrice: new Decimal(20000),
          modifierTotal: new Decimal(0),
          itemDiscount: new Decimal(0),
          isTaxable: true,
        },
      ];
      const oracle = calculateOrder(calcLines, calcSettings);

      const qrisAmount = new Decimal(15000);
      const cashAmount = oracle.total.minus(qrisAmount).plus(1000); // sengaja lebih -> kembalian tunai
      const qrisPaymentId = generateId();
      const cashPaymentId = generateId();

      const orderId = generateId();
      const lineId = generateId();
      const result = await payOrderWithDb(db, businessId, {
        orderId,
        outletId,
        deviceId: devId,
        priceTierId,
        lines: [{ id: lineId, productId, variantId: null, modifierIds: [], qty: "1", itemDiscount: "0", note: "" }],
        discountType: "none",
        orderDiscountAmount: "0",
        orderDiscountPercentInput: "0",
        // QRIS lebih dulu, TUNAI terakhir -- kembalian selalu dilekatkan
        // ke pembayaran TERAKHIR di array (lihat catatan laporan: bukan
        // "yang metodenya cash", murni urutan array).
        payments: [
          { id: qrisPaymentId, paymentMethodId: qrisMethodId, amount: qrisAmount.toFixed(2), reference: "QRISREF" },
          { id: cashPaymentId, paymentMethodId: cashMethodId, amount: cashAmount.toFixed(2), reference: "" },
        ],
      });

      expect(result.error).toBeUndefined();
      expect(result.success).toBeTruthy();

      const paymentRows = await db.select().from(payments).where(eq(payments.orderId, orderId));
      expect(paymentRows).toHaveLength(2);

      const qrisRow = paymentRows.find((p) => p.id === qrisPaymentId);
      const cashRow = paymentRows.find((p) => p.id === cashPaymentId);
      expect(qrisRow).toBeTruthy();
      expect(cashRow).toBeTruthy();
      expect(new Decimal(qrisRow!.amount).toFixed(2)).toBe(qrisAmount.toFixed(2));
      expect(new Decimal(cashRow!.amount).toFixed(2)).toBe(cashAmount.toFixed(2));

      const totalReceived = qrisAmount.plus(cashAmount);
      const expectedChange = totalReceived.minus(oracle.total);
      expect(expectedChange.greaterThan(0)).toBe(true);
      expect(new Decimal(qrisRow!.changeAmount).toFixed(2)).toBe("0.00");
      expect(new Decimal(cashRow!.changeAmount).toFixed(2)).toBe(expectedChange.toFixed(2));
      expect(result.success!.change).toBe(expectedChange.toFixed(2));

      const [orderRow] = await db.select().from(orders).where(eq(orders.id, orderId));
      expect(new Decimal(orderRow!.total).toFixed(2)).toBe(oracle.total.toFixed(2));
    });
  });

  describe("5. Service charge > 0 ujung-ke-ujung (0% di semua outlet produksi hari ini -- dibuktikan dulu sebelum ada yang mengisi angkanya)", () => {
    it("serviceCharge yang tersimpan cocok PERSIS dengan calculateOrder (oracle), dan ikut masuk taxBase (serviceChargeInTaxBase=true)", async () => {
      const devId = await openFreshShift("SVC");

      const [product] = await db
        .insert(products)
        .values({ businessId, name: "Rib Eye Steak (uji service charge)", isTaxable: true })
        .returning({ id: products.id });
      const productId = product!.id;
      await db.insert(productPrices).values({ productId, priceTierId, price: "120000" });

      const calcLines: CalcLine[] = [
        {
          id: "oracle",
          qty: new Decimal(1),
          unitPrice: new Decimal(120000),
          modifierTotal: new Decimal(0),
          itemDiscount: new Decimal(0),
          isTaxable: true,
        },
      ];
      const oracle = calculateOrder(calcLines, calcSettings);
      expect(oracle.serviceCharge.greaterThan(0)).toBe(true);

      const orderId = generateId();
      const lineId = generateId();
      const result = await payOrderWithDb(db, businessId, {
        orderId,
        outletId,
        deviceId: devId,
        priceTierId,
        lines: [{ id: lineId, productId, variantId: null, modifierIds: [], qty: "1", itemDiscount: "0", note: "" }],
        discountType: "none",
        orderDiscountAmount: "0",
        orderDiscountPercentInput: "0",
        payments: [{ id: generateId(), paymentMethodId: cashMethodId, amount: oracle.total.toFixed(2), reference: "" }],
      });

      expect(result.error).toBeUndefined();

      const [orderRow] = await db.select().from(orders).where(eq(orders.id, orderId));
      expect(new Decimal(orderRow!.serviceCharge).toFixed(2)).toBe(oracle.serviceCharge.toFixed(2));
      // Bukti serviceChargeInTaxBase=true benar-benar berlaku (bukan cuma
      // setting yang diam): taxAmount oracle sendiri sudah menghitung
      // serviceCharge masuk taxBase -- membandingkan ke taxAmount yang
      // TIDAK memasukkan service charge ke taxBase harus beda.
      const taxBaseWithoutServiceCharge = new Decimal(120000).times(calcSettings.taxPercent);
      expect(new Decimal(orderRow!.taxAmount).toFixed(2)).not.toBe(taxBaseWithoutServiceCharge.toFixed(2));
      expect(new Decimal(orderRow!.taxAmount).toFixed(2)).toBe(oracle.taxAmount.toFixed(2));
      expect(new Decimal(orderRow!.total).toFixed(2)).toBe(oracle.total.toFixed(2));
    });
  });
});
