/**
 * T16 — Test integrasi void & refund. Butuh koneksi Supabase sungguhan
 * (DATABASE_URL + NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY),
 * sama seperti src/lib/pos/__tests__/shift.test.ts -- di-skip otomatis
 * kalau env belum diisi, bukan hijau palsu.
 *
 * getAdminDb() dipakai di sini SENGAJA melewati RLS -- ini test, bukan
 * kode aplikasi, dan fixture-nya bikin business/outlet/device/employee
 * dari nol yang butuh akses penuh untuk setup + assert langsung ke DB.
 *
 * Outlet fixture SENGAJA cash_enabled=false -- membuat tutup shift jadi
 * satu langkah (closeCashlessShiftWithDb, T15 lanjutan) tanpa perlu
 * rekonsiliasi kas, dan sekaligus jadi kesempatan menguji "refund metode
 * tunai ditolak di outlet cashless" pakai fixture yang sama (payment
 * method CASH tetap dibuat di business ini, cuma outlet-nya yang
 * mematikan tunai).
 *
 * Data uji diberi prefix TEST_VOIDREFUND_ dan dibersihkan di afterAll
 * (bukan di akhir tiap test) supaya tetap bersih walau ada test yang
 * gagal di tengah.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
import { and, eq } from "drizzle-orm";
import { Decimal } from "decimal.js";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { getAdminDb } from "@/lib/db/client";
import {
  auditLogs,
  brands,
  businesses,
  devices,
  employees,
  orderItems,
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
import { closeCashlessShiftWithDb, getShiftSalesSummary, openShiftWithDb } from "../shift";
import { payOrderWithDb } from "../pay-order";
import { refundOrderWithDb, voidOrderWithDb } from "../void-refund";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

describe.skipIf(!hasEnv)("T16 — void & refund", () => {
  const db = getAdminDb();
  const PREFIX = `TEST_VOIDREFUND_${Date.now()}`;
  const PIN = "135791";
  const EMPLOYEE_CODE = "VRKASIR";

  let businessId: string;
  let outletId: string;
  let deviceId: string;
  let mainShiftId: string; // satu shift TERBUKA dipakai lintas test (tidak pernah ditutup di sini)
  let qrisMethodId: string;
  let cashMethodId: string;
  let priceTierId: string;
  let productId: string; // harga 50000, isTaxable=false -> netAmount baris = 50000 * qty persis

  async function openShiftOnDevice(targetDeviceId: string) {
    const result = await openShiftWithDb(db, businessId, {
      id: generateId(),
      outletId,
      deviceId: targetDeviceId,
      employeeCode: EMPLOYEE_CODE,
      pin: PIN,
      openingCash: "0",
    });
    expect(result.success).toBeTruthy();
    return result.success!.shiftId;
  }

  async function payOrder(qty: string, targetDeviceId: string = deviceId) {
    const orderId = generateId();
    const lineId = generateId();
    const result = await payOrderWithDb(db, businessId, {
      orderId,
      outletId,
      deviceId: targetDeviceId,
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
      .returning({ id: businesses.id });
    businessId = business!.id;

    const [brand] = await db
      .insert(brands)
      .values({ businessId, name: `${PREFIX}_brand` })
      .returning({ id: brands.id });

    const [outlet] = await db
      .insert(outlets)
      .values({
        businessId,
        brandId: brand!.id,
        code: "VR1",
        name: `${PREFIX}_outlet`,
        cashEnabled: false,
      })
      .returning({ id: outlets.id });
    outletId = outlet!.id;

    const [device] = await db
      .insert(devices)
      .values({ businessId, outletId, serialNumber: "VRDEV1", name: "Kasir Uji VR" })
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

    const [cash] = await db
      .insert(paymentMethods)
      .values({ businessId, code: "CASH", name: "Tunai", type: "cash", isCashDrawer: true })
      .returning({ id: paymentMethods.id });
    cashMethodId = cash!.id;

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

    // Satu shift TERBUKA dipakai bersama oleh test 2-6 (refund/agregasi/
    // audit log) -- shift cuma dibuka SEKALI per device (T15), jadi
    // memanggil openShiftWithDb berkali-kali di device yang sama akan
    // gagal kalau shift sebelumnya belum ditutup. Test "shift tertutup"
    // (test khusus) pakai device sendiri supaya tidak mengganggu shift
    // bersama ini.
    mainShiftId = await openShiftOnDevice(deviceId);
  });

  afterAll(async () => {
    // Urutan hapus (FK, sama pelajaran shift.test.ts): refunds (cascade
    // refund_items) -> orders -> shifts -> businesses (cascade sisanya,
    // termasuk audit_logs -- FK-nya di-set cascade dari businessId).
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
    expect(cashMethodId).toBeTruthy();
    expect(priceTierId).toBeTruthy();
    expect(productId).toBeTruthy();
  });

  it("void order dari shift tertutup DITOLAK di server", async () => {
    // Device sendiri -- tidak boleh menyentuh mainShiftId yang dipakai
    // test lain, dan test ini justru PERLU menutup shift-nya.
    const [closedTestDevice] = await db
      .insert(devices)
      .values({ businessId, outletId, serialNumber: "VRDEV_CLOSED", name: "Kasir Uji VR (closed)" })
      .returning({ id: devices.id });
    const closedDeviceId = closedTestDevice!.id;

    const shiftId = await openShiftOnDevice(closedDeviceId);
    const { orderId } = await payOrder("1", closedDeviceId);

    const closeResult = await closeCashlessShiftWithDb(db, businessId, { shiftId });
    expect(closeResult.success).toBeTruthy();

    const result = await voidOrderWithDb(db, businessId, null, {
      orderId,
      reason: "harusnya ditolak, shift sudah tutup",
    });
    expect(result.error).toBeTruthy();

    const [orderRow] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(orderRow?.status).toBe("paid");
  });

  it("refund melebihi total pembayaran DITOLAK, termasuk akumulasi dari refund sebelumnya", async () => {
    const { orderId } = await payOrder("2"); // total = 100000

    const [orderRow] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(orderRow?.total).toBe("100000.00");

    // Seed refund sebelumnya LANGSUNG ke DB (bukan lewat refundOrderWithDb)
    // -- cara paling langsung menguji guard akumulasi total secara
    // terisolasi dari guard qty-per-item (lihat komentar di kepala file).
    await db.insert(refunds).values({
      id: generateId(),
      orderId,
      amount: "90000",
      restock: false,
      reason: "seed akumulasi uji",
      businessDate: orderRow!.businessDate,
      paymentMethodId: qrisMethodId,
    });

    const itemRows = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
    const orderItemId = itemRows[0]!.id;

    // 90.000 (seed) + 50.000 (qty 1 dari 2, proporsional) = 140.000 > 100.000
    const result = await refundOrderWithDb(db, businessId, null, {
      id: generateId(),
      orderId,
      paymentMethodId: qrisMethodId,
      reference: "",
      restock: false,
      reason: "harusnya ditolak, melebihi total",
      lines: [{ orderItemId, qty: "1" }],
    });
    expect(result.error).toBeTruthy();

    const refundRows = await db.select().from(refunds).where(eq(refunds.orderId, orderId));
    // Cuma baris seed di atas -- percobaan yang ditolak tidak menulis apa pun.
    expect(refundRows.length).toBe(1);
  });

  it("refund metode tunai DITOLAK di outlet cashless", async () => {
    const { orderId, lineId } = await payOrder("1");

    const result = await refundOrderWithDb(db, businessId, null, {
      id: generateId(),
      orderId,
      paymentMethodId: cashMethodId,
      reference: "",
      restock: false,
      reason: "harusnya ditolak, outlet cashless",
      lines: [{ orderItemId: lineId, qty: "1" }],
    });
    expect(result.error).toBeTruthy();
  });

  it("qty refund melebihi qty order_item DITOLAK", async () => {
    const { orderId, lineId } = await payOrder("1"); // qty asli cuma 1

    const result = await refundOrderWithDb(db, businessId, null, {
      id: generateId(),
      orderId,
      paymentMethodId: qrisMethodId,
      reference: "",
      restock: false,
      reason: "harusnya ditolak, qty melebihi",
      lines: [{ orderItemId: lineId, qty: "2" }],
    });
    expect(result.error).toBeTruthy();
  });

  it("order void TIDAK ikut terhitung di agregasi penjualan (getShiftSalesSummary)", async () => {
    // Baseline SEBELUM dua order baru ini -- test lain di mainShiftId
    // sudah bikin order duluan, jadi baca dulu baseline-nya, bukan
    // asumsikan agregasi mulai dari nol.
    const baseline = await getShiftSalesSummary(db, mainShiftId);
    const baselineQris = new Decimal(
      baseline.totalsByMethod.find((m) => m.methodName === "QRIS")?.total ?? "0"
    );

    const orderA = await payOrder("1"); // 50000
    await payOrder("1"); // 50000, tetap paid -- cuma untuk mengisi agregasi

    const before = await getShiftSalesSummary(db, mainShiftId);
    expect(before.orderCount).toBe(baseline.orderCount + 2);
    const totalBefore = new Decimal(
      before.totalsByMethod.find((m) => m.methodName === "QRIS")?.total ?? "0"
    );
    expect(totalBefore.toString()).toBe(baselineQris.plus(100000).toString());

    const voidResult = await voidOrderWithDb(db, businessId, null, {
      orderId: orderA.orderId,
      reason: "uji agregasi",
    });
    expect(voidResult.success).toBeTruthy();

    const after = await getShiftSalesSummary(db, mainShiftId);
    expect(after.orderCount).toBe(baseline.orderCount + 1);
    const totalAfter = new Decimal(
      after.totalsByMethod.find((m) => m.methodName === "QRIS")?.total ?? "0"
    );
    expect(totalAfter.toString()).toBe(baselineQris.plus(50000).toString());
  });

  it("audit log TERISI untuk void dan untuk refund", async () => {
    const orderToVoid = await payOrder("1");
    const orderToRefund = await payOrder("1");

    const voidResult = await voidOrderWithDb(db, businessId, null, {
      orderId: orderToVoid.orderId,
      reason: "uji audit log void",
    });
    expect(voidResult.success).toBeTruthy();

    const refundResult = await refundOrderWithDb(db, businessId, null, {
      id: generateId(),
      orderId: orderToRefund.orderId,
      paymentMethodId: qrisMethodId,
      reference: "",
      restock: false,
      reason: "uji audit log refund",
      lines: [{ orderItemId: orderToRefund.lineId, qty: "1" }],
    });
    expect(refundResult.success).toBeTruthy();

    const voidLogRows = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.businessId, businessId),
          eq(auditLogs.refType, "order"),
          eq(auditLogs.refId, orderToVoid.orderId)
        )
      );
    expect(voidLogRows.length).toBe(1);
    expect(voidLogRows[0]?.action).toBe("void");
    expect(voidLogRows[0]?.reason).toBe("uji audit log void");

    const refundLogRows = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.businessId, businessId),
          eq(auditLogs.refType, "refund"),
          eq(auditLogs.refId, refundResult.success!.refundId)
        )
      );
    expect(refundLogRows.length).toBe(1);
    expect(refundLogRows[0]?.action).toBe("refund");
    expect(refundLogRows[0]?.reason).toBe("uji audit log refund");
  });
});
