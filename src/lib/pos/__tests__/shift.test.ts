/**
 * T15 — Test integrasi siklus shift. Butuh koneksi Supabase sungguhan
 * (DATABASE_URL + NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY),
 * sama seperti src/lib/auth/__tests__/pin.test.ts -- di-skip otomatis
 * kalau env belum diisi, bukan hijau palsu.
 *
 * getAdminDb() dipakai di sini SENGAJA melewati RLS -- ini test, bukan
 * kode aplikasi (guard no-admin-db-in-app.test.ts cuma membatasi src/app/),
 * dan fixture-nya lintas skenario (bikin business/outlet/device/employee
 * dari nol) yang butuh akses penuh untuk setup + assert langsung ke DB.
 *
 * Data uji diberi prefix TEST_SHIFT_ dan dibersihkan di afterAll (bukan di
 * akhir tiap test) supaya tetap bersih walau ada test yang gagal di tengah.
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
import {
  addCashMovementWithDb,
  confirmShiftCloseWithDb,
  getOpenShiftForDevice,
  isShiftSellable,
  openShiftWithDb,
  submitCountedCashWithDb,
} from "../shift";
import { payOrderWithDb } from "../pay-order";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

describe.skipIf(!hasEnv)("T15 — siklus shift", () => {
  // getAdminDb() dipakai di seluruh file ini untuk setup fixture DAN untuk
  // memanggil fungsi lib/pos/shift.ts yang sedang diuji -- fungsi itu cuma
  // butuh `db: UserDbHandle["db"]`, sama-sama Drizzle, RLS bukan yang
  // sedang diuji di sini (sudah ditest terpisah di rls.test.ts).
  const db = getAdminDb();
  const PREFIX = `TEST_SHIFT_${Date.now()}`;
  const CORRECT_PIN = "246810";
  const WRONG_PIN = "000000";
  const EMPLOYEE_CODE = "SHIFTKASIR";

  let businessId: string;
  let outletId: string;
  let deviceId: string;
  let employeeId: string;
  let cashPaymentMethodId: string;
  let priceTierId: string;
  let productId: string;

  beforeAll(async () => {
    const [business] = await db
      .insert(businesses)
      .values({ name: `${PREFIX}_business` })
      .returning({ id: businesses.id });
    businessId = business!.id;

    const [outlet] = await db
      .insert(outlets)
      .values({
        businessId,
        code: "SHF1",
        name: `${PREFIX}_outlet`,
        cashVarianceTolerance: "20000",
      })
      .returning({ id: outlets.id });
    outletId = outlet!.id;

    const [device] = await db
      .insert(devices)
      .values({ businessId, outletId, serialNumber: "SHIFTDEV1", name: "Kasir Uji" })
      .returning({ id: devices.id });
    deviceId = device!.id;

    const pinHash = await hashPin(CORRECT_PIN);
    const [employee] = await db
      .insert(employees)
      .values({
        businessId,
        outletId,
        code: EMPLOYEE_CODE,
        fullName: `${PREFIX}_employee`,
        role: "cashier",
        pinHash,
      })
      .returning({ id: employees.id });
    employeeId = employee!.id;

    const [cashMethod] = await db
      .insert(paymentMethods)
      .values({
        businessId,
        code: "CASH",
        name: "Tunai",
        type: "cash",
        isCashDrawer: true,
      })
      .returning({ id: paymentMethods.id });
    cashPaymentMethodId = cashMethod!.id;

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

    await db.insert(productPrices).values({
      productId,
      priceTierId,
      price: "10000",
    });
  });

  afterAll(async () => {
    // orders.business_id dan shifts.business_id SENGAJA tidak cascade dari
    // businesses (order/shift tidak pernah dihapus lewat aplikasi, CLAUDE.md
    // §3.2) -- hapus eksplisit dulu (payments/cash_movements ikut cascade
    // dari orders/shifts). Sisanya (outlets, employees, devices, products,
    // price_tiers, payment_methods) cascade otomatis dari businesses.
    if (businessId) {
      await db.delete(orders).where(eq(orders.businessId, businessId));
      await db.delete(shifts).where(eq(shifts.businessId, businessId));
      await db.delete(businesses).where(eq(businesses.id, businessId));
    }
  });

  it("data uji benar-benar terbentuk sebelum diuji (bukan hijau karena kosong)", () => {
    expect(businessId).toBeTruthy();
    expect(outletId).toBeTruthy();
    expect(deviceId).toBeTruthy();
    expect(employeeId).toBeTruthy();
    expect(cashPaymentMethodId).toBeTruthy();
    expect(priceTierId).toBeTruthy();
    expect(productId).toBeTruthy();
  });

  it("buka shift dengan PIN benar berhasil, employeeId sesuai", async () => {
    const result = await openShiftWithDb(db, businessId, {
      id: generateId(),
      outletId,
      deviceId,
      employeeCode: EMPLOYEE_CODE,
      pin: CORRECT_PIN,
      openingCash: "500000",
    });

    expect(result.error).toBeUndefined();
    expect(result.success?.employeeName).toContain(PREFIX);

    const active = await getOpenShiftForDevice(db, businessId, deviceId);
    expect(active).not.toBeNull();
    expect(active!.employeeId).toBe(employeeId);
    expect(isShiftSellable(active)).toBe(true);
  });

  it("buka shift ditolak kalau device sudah punya shift terbuka", async () => {
    const result = await openShiftWithDb(db, businessId, {
      id: generateId(),
      outletId,
      deviceId,
      employeeCode: EMPLOYEE_CODE,
      pin: CORRECT_PIN,
      openingCash: "100000",
    });
    expect(result.error).toBeTruthy();
    expect(result.success).toBeUndefined();
  });

  it("buka shift ditolak kalau PIN salah", async () => {
    // Device lain supaya tidak bentrok dengan "sudah ada shift terbuka".
    const [otherDevice] = await db
      .insert(devices)
      .values({ businessId, outletId, serialNumber: "SHIFTDEV_WRONGPIN", name: "Kasir Lain" })
      .returning({ id: devices.id });

    const result = await openShiftWithDb(db, businessId, {
      id: generateId(),
      outletId,
      deviceId: otherDevice!.id,
      employeeCode: EMPLOYEE_CODE,
      pin: WRONG_PIN,
      openingCash: "0",
    });
    expect(result.error).toMatch(/salah/i);

    await db.delete(devices).where(eq(devices.id, otherDevice!.id));
  });

  it("payOrderWithDb mengisi shiftId/cashierId dari shift aktif device", async () => {
    const activeShift = await getOpenShiftForDevice(db, businessId, deviceId);
    expect(activeShift).not.toBeNull();

    const orderId = generateId();
    const lineId = generateId();
    const paymentId = generateId();

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
          qty: "1",
          itemDiscount: "0",
          note: "",
        },
      ],
      discountType: "none",
      orderDiscountAmount: "0",
      orderDiscountPercentInput: "0",
      payments: [
        {
          id: paymentId,
          paymentMethodId: cashPaymentMethodId,
          // Bayar lebih dari cukup -- produk isTaxable=false + service
          // charge/tax outlet default 0%/10% tapi line ini dikeluarkan
          // dari tax_base, jadi total = 10000. Overpay supaya tidak perlu
          // menghitung ulang totalnya persis di sini.
          amount: "20000",
          reference: "",
        },
      ],
    });

    expect(result.error).toBeUndefined();
    expect(result.success?.orderId).toBe(orderId);

    const [orderRow] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(orderRow?.shiftId).toBe(activeShift!.id);
    expect(orderRow?.cashierId).toBe(activeShift!.employeeId);
  });

  it("WRITE-ONCE: submitCountedCash kedua kali ditolak, counted_cash di DB tidak berubah", async () => {
    const shift = await getOpenShiftForDevice(db, businessId, deviceId);
    expect(shift).not.toBeNull();

    const first = await submitCountedCashWithDb(db, businessId, {
      shiftId: shift!.id,
      countedCash: "530000", // dekat opening 500000 + penjualan 10000 -> dalam toleransi
    });
    expect(first.error).toBeUndefined();
    expect(first.success?.countedCash).toBe("530000.00");

    const [afterFirst] = await db.select().from(shifts).where(eq(shifts.id, shift!.id));
    expect(afterFirst?.countedCash).toBe("530000.00");

    // Percobaan KEDUA -- kasir "menyesuaikan hitungannya" setelah tahu
    // hasilnya. Ini yang WAJIB ditolak, membuktikan write-once ditegakkan
    // di server, bukan cuma disembunyikan di UI.
    const second = await submitCountedCashWithDb(db, businessId, {
      shiftId: shift!.id,
      countedCash: "999999",
    });
    expect(second.error).toBeTruthy();
    expect(second.success).toBeUndefined();

    const [afterSecond] = await db.select().from(shifts).where(eq(shifts.id, shift!.id));
    // Nilai TIDAK berubah dari percobaan pertama, walau percobaan kedua
    // mengirim angka yang jelas berbeda.
    expect(afterSecond?.countedCash).toBe("530000.00");
    expect(afterSecond?.status).toBe("closed");
  });

  it("selisih di atas toleransi tanpa alasan ditolak, tidak menulis apa pun ke DB", async () => {
    const openResult = await openShiftWithDb(db, businessId, {
      id: generateId(),
      outletId,
      deviceId,
      employeeCode: EMPLOYEE_CODE,
      pin: CORRECT_PIN,
      openingCash: "100000",
    });
    expect(openResult.success).toBeTruthy();
    const shiftId = openResult.success!.shiftId;

    const result = await submitCountedCashWithDb(db, businessId, {
      shiftId,
      // Selisih 50.000 dari opening 100.000 (tidak ada penjualan di shift
      // baru ini) -- jauh di atas toleransi default 20.000.
      countedCash: "150000",
    });
    expect(result.error).toBeUndefined();
    expect(result.success?.requiresReason).toBe(true);
    expect(result.success?.closed).toBe(false);

    const [row] = await db.select().from(shifts).where(eq(shifts.id, shiftId));
    // counted_cash SUDAH terkunci (write-once mulai berlaku dari titik
    // ini), tapi status masih 'open' -- menunggu alasan, belum ditutup.
    expect(row?.countedCash).toBe("150000.00");
    expect(row?.status).toBe("open");
    expect(row?.note).toBeNull();

    // Percobaan submitCountedCash LAGI di shift yang sama (mencoba
    // "memperbaiki" angka sebelum kasih alasan) -- juga harus ditolak.
    const retry = await submitCountedCashWithDb(db, businessId, {
      shiftId,
      countedCash: "100000",
    });
    expect(retry.error).toBeTruthy();

    // Lengkapi dengan alasan supaya shift ini tidak nyangkut 'open' dan
    // mengganggu test lain / cleanup.
    const confirmed = await confirmShiftCloseWithDb(db, businessId, {
      shiftId,
      reason: "Selisih uji otomatis -- kasir salah hitung receh",
    });
    expect(confirmed.success).toBeTruthy();

    const [closedRow] = await db.select().from(shifts).where(eq(shifts.id, shiftId));
    expect(closedRow?.status).toBe("closed");
    expect(closedRow?.note).toBe("Selisih uji otomatis -- kasir salah hitung receh");
    // counted_cash tetap dari submitCountedCash pertama, confirmShiftClose
    // tidak pernah menyentuhnya.
    expect(closedRow?.countedCash).toBe("150000.00");
  });

  it("addCashMovement ditolak setelah counted_cash terkunci", async () => {
    const openResult = await openShiftWithDb(db, businessId, {
      id: generateId(),
      outletId,
      deviceId,
      employeeCode: EMPLOYEE_CODE,
      pin: CORRECT_PIN,
      openingCash: "0",
    });
    const shiftId = openResult.success!.shiftId;

    const beforeLock = await addCashMovementWithDb(db, businessId, {
      id: generateId(),
      shiftId,
      type: "cash_out",
      amount: "20000",
      reason: "beli galon",
    });
    expect(beforeLock.error).toBeUndefined();

    await submitCountedCashWithDb(db, businessId, { shiftId, countedCash: "0" });

    const afterLock = await addCashMovementWithDb(db, businessId, {
      id: generateId(),
      shiftId,
      type: "cash_in",
      amount: "5000",
      reason: "harusnya ditolak",
    });
    expect(afterLock.error).toBeTruthy();
  });
});
