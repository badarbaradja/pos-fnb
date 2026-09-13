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
import { and, eq } from "drizzle-orm";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { getAdminDb } from "@/lib/db/client";
import {
  auditLogs,
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
import {
  addCashMovementWithDb,
  checkShiftSellability,
  closeAndReopenShiftWithDb,
  confirmForceClosedReconciliationWithDb,
  confirmShiftCloseWithDb,
  forceCloseShiftWithDb,
  getOpenShiftForDevice,
  getOpenShiftsForBusiness,
  getShiftsNeedingReview,
  isShiftSellable,
  openShiftWithDb,
  reconcileForceClosedShiftWithDb,
  submitCountedCashWithDb,
  type OpenShiftRow,
} from "../shift";
import { payOrderWithDb } from "../pay-order";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

/**
 * checkShiftSellability -- MURNI, tidak butuh koneksi apa pun, selalu
 * jalan (§14 prasyarat shift, 13 September 2026).
 */
describe("checkShiftSellability", () => {
  const TIMEZONE = "Asia/Jakarta";
  const CUTOFF = "04:00:00";
  const TODAY = businessDateForTest();

  function businessDateForTest(): string {
    // Duplikasi minimal logika businessDate() cuma untuk mendapat "hari
    // ini" versi test, TANPA impor businessDate() -- sengaja, supaya
    // test ini benar-benar independen dari implementasi yang diuji.
    return new Date().toISOString().slice(0, 10);
  }

  function makeShift(overrides: Partial<OpenShiftRow>): OpenShiftRow {
    return {
      id: "shift-1",
      outletId: "outlet-1",
      deviceId: "device-1",
      employeeId: "employee-1",
      employeeName: "Karyawan Uji",
      employeeRole: "cashier",
      servedByName: null,
      status: "open",
      openedAt: new Date(),
      businessDate: TODAY,
      openingCash: "0",
      countedCash: null,
      expectedCash: null,
      cashVariance: null,
      ...overrides,
    };
  }

  it("shift null -> 'no_shift'", () => {
    expect(checkShiftSellability(null, TIMEZONE, CUTOFF)).toBe("no_shift");
  });

  it("countedCash sudah terisi -> 'closing_in_progress', walau businessDate masih hari ini", () => {
    expect(checkShiftSellability(makeShift({ countedCash: "100000" }), TIMEZONE, CUTOFF)).toBe(
      "closing_in_progress"
    );
  });

  it("businessDate SAMA dengan hari ini -> null (sellable)", () => {
    expect(checkShiftSellability(makeShift({}), TIMEZONE, CUTOFF)).toBeNull();
  });

  it("businessDate BEDA dari hari ini (shift basi, tertinggal dari hari sebelumnya) -> 'stale'", () => {
    expect(checkShiftSellability(makeShift({ businessDate: "2000-01-01" }), TIMEZONE, CUTOFF)).toBe(
      "stale"
    );
  });

  it("countedCash terisi DAN businessDate basi -- 'closing_in_progress' didahulukan (urutan pengecekan disengaja)", () => {
    expect(
      checkShiftSellability(
        makeShift({ countedCash: "50000", businessDate: "2000-01-01" }),
        TIMEZONE,
        CUTOFF
      )
    ).toBe("closing_in_progress");
  });
});

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

    const [brand] = await db
      .insert(brands)
      .values({ businessId, name: `${PREFIX}_brand` })
      .returning({ id: brands.id });

    const [outlet] = await db
      .insert(outlets)
      .values({
        businessId,
        brandId: brand!.id,
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
    // Fixture tidak menimpa timezone/dayCutoffTime -- default skema
    // (Asia/Jakarta, 04:00:00) yang berlaku.
    expect(isShiftSellable(active, "Asia/Jakarta", "04:00:00")).toBe(true);
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

  it("shift BASI (businessDate bukan hari ini) tidak bisa dipakai jualan, TAPI tidak menghalangi shift baru dibuka -- §14 prasyarat shift (13 September 2026)", async () => {
    const [staleDevice] = await db
      .insert(devices)
      .values({ businessId, outletId, serialNumber: "SHIFTDEV_STALE", name: "Kasir Uji Basi" })
      .returning({ id: devices.id });

    const openResult = await openShiftWithDb(db, businessId, {
      id: generateId(),
      outletId,
      deviceId: staleDevice!.id,
      employeeCode: EMPLOYEE_CODE,
      pin: CORRECT_PIN,
      openingCash: "0",
    });
    expect(openResult.success).toBeTruthy();
    const staleShiftId = openResult.success!.shiftId;

    // openShiftWithDb sendiri TIDAK PUNYA cara menerima businessDate dari
    // luar (dan memang tidak boleh) -- dipaksa mundur langsung di DB di
    // sini untuk mensimulasikan shift yang tertinggal terbuka dari hari
    // sebelumnya.
    await db.update(shifts).set({ businessDate: "2000-01-01" }).where(eq(shifts.id, staleShiftId));

    // TIDAK BISA jualan di bawah shift basi ini -- pesan menyebut jelas
    // "kemarin belum ditutup", bukan pesan galat generik "tidak ada shift".
    const payResult = await payOrderWithDb(db, businessId, {
      orderId: generateId(),
      outletId,
      deviceId: staleDevice!.id,
      priceTierId,
      lines: [
        { id: generateId(), productId, variantId: null, modifierIds: [], qty: "1", itemDiscount: "0", note: "" },
      ],
      discountType: "none",
      orderDiscountAmount: "0",
      orderDiscountPercentInput: "0",
      payments: [{ id: generateId(), paymentMethodId: cashPaymentMethodId, amount: "20000", reference: "" }],
    });
    expect(payResult.error).toBeTruthy();
    expect(payResult.error).toMatch(/kemarin belum ditutup/i);
    expect(payResult.success).toBeUndefined();

    // TAPI shift basi ini TIDAK menghalangi shift BARU dibuka di device
    // yang sama -- itu justru jalan keluarnya (bukan cron, bukan
    // pembersihan otomatis).
    const reopenResult = await openShiftWithDb(db, businessId, {
      id: generateId(),
      outletId,
      deviceId: staleDevice!.id,
      employeeCode: EMPLOYEE_CODE,
      pin: CORRECT_PIN,
      openingCash: "0",
    });
    expect(reopenResult.error).toBeUndefined();
    expect(reopenResult.success).toBeTruthy();

    // Shift lama (basi) tetap ada apa adanya, status masih 'open' --
    // TIDAK disentuh sama sekali, menunggu manajer menutupnya lewat fitur
    // force-close (bukan ditutup diam-diam oleh mekanisme ini).
    const [oldShiftRow] = await db.select({ status: shifts.status }).from(shifts).where(eq(shifts.id, staleShiftId));
    expect(oldShiftRow?.status).toBe("open");

    await db.delete(shifts).where(eq(shifts.deviceId, staleDevice!.id));
    await db.delete(devices).where(eq(devices.id, staleDevice!.id));
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

  it("getOpenShiftsForBusiness mengembalikan SEMUA shift terbuka bisnis ini; shift closed tidak ikut (T18)", async () => {
    const secondPin = "135791";
    const secondEmployeeCode = "SHIFTKASIR2";
    const secondPinHash = await hashPin(secondPin);
    const [secondEmployee] = await db
      .insert(employees)
      .values({
        businessId,
        outletId,
        code: secondEmployeeCode,
        fullName: `${PREFIX}_employee2`,
        role: "cashier",
        pinHash: secondPinHash,
      })
      .returning({ id: employees.id });
    const secondEmployeeId = secondEmployee!.id;

    const [secondDevice] = await db
      .insert(devices)
      .values({ businessId, outletId, serialNumber: "SHIFTDEV2", name: "Kasir Uji 2" })
      .returning({ id: devices.id });
    const secondDeviceId = secondDevice!.id;

    const opened = await openShiftWithDb(db, businessId, {
      id: generateId(),
      outletId,
      deviceId: secondDeviceId,
      employeeCode: secondEmployeeCode,
      pin: secondPin,
      openingCash: "0",
    });
    expect(opened.error).toBeUndefined();
    const secondShiftId = opened.success!.shiftId;

    const openList = await getOpenShiftsForBusiness(db, businessId);
    const ourShift = openList.find((s) => s.id === secondShiftId);
    expect(ourShift).toBeDefined();
    expect(ourShift?.employeeId).toBe(secondEmployeeId);
    expect(ourShift?.outletName).toBeTruthy();

    // Tutup langsung lewat admin db (alur submitCountedCash/confirmShiftClose
    // bukan yang diuji di sini) lalu pastikan TIDAK ikut lagi.
    await db.update(shifts).set({ status: "closed" }).where(eq(shifts.id, secondShiftId));

    const afterClose = await getOpenShiftsForBusiness(db, businessId);
    expect(afterClose.find((s) => s.id === secondShiftId)).toBeUndefined();
  });

  describe("forceCloseShiftWithDb / reconcileForceClosedShiftWithDb -- §14 prasyarat shift, manajer menutup shift orang lain (13 September 2026)", () => {
    async function openIsolatedShift(serialSuffix: string) {
      const [device] = await db
        .insert(devices)
        .values({ businessId, outletId, serialNumber: `SHIFTDEV_FC_${serialSuffix}`, name: `Kasir Uji FC ${serialSuffix}` })
        .returning({ id: devices.id });
      const opened = await openShiftWithDb(db, businessId, {
        id: generateId(),
        outletId,
        deviceId: device!.id,
        employeeCode: EMPLOYEE_CODE,
        pin: CORRECT_PIN,
        openingCash: "0",
      });
      if (!opened.success) {
        throw new Error(`Gagal buka shift uji force-close: ${opened.error}`);
      }
      return { deviceId: device!.id, shiftId: opened.success.shiftId };
    }

    it("force-close outlet BERTUNAI: forceClosedAt terisi, countedCash TETAP null, needsReview=true, audit log tercatat", async () => {
      const { deviceId: fcDeviceId, shiftId } = await openIsolatedShift("A");

      const result = await forceCloseShiftWithDb(db, businessId, "manager-uji-a", {
        shiftId,
        reason: "Shift kemarin malam tidak ditutup",
      });
      expect(result.error).toBeUndefined();
      expect(result.success?.needsReview).toBe(true);

      const [row] = await db.select().from(shifts).where(eq(shifts.id, shiftId));
      expect(row?.status).toBe("closed");
      expect(row?.forceClosedAt).not.toBeNull();
      expect(row?.countedCash).toBeNull();
      expect(row?.note).toBe("Shift kemarin malam tidak ditutup");

      const [log] = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.refId, shiftId), eq(auditLogs.action, "shift_force_closed")));
      expect(log).toBeTruthy();
      expect(log?.reason).toBe("Shift kemarin malam tidak ditutup");
      expect((log?.metadata as { closedByProfileId?: string })?.closedByProfileId).toBe("manager-uji-a");

      await db.delete(shifts).where(eq(shifts.id, shiftId));
      await db.delete(devices).where(eq(devices.id, fcDeviceId));
    });

    it("force-close DITOLAK untuk shift yang sudah closed", async () => {
      const { deviceId: fcDeviceId, shiftId } = await openIsolatedShift("B");
      await db.update(shifts).set({ status: "closed", closedAt: new Date() }).where(eq(shifts.id, shiftId));

      const result = await forceCloseShiftWithDb(db, businessId, "manager-uji-b", {
        shiftId,
        reason: "coba tutup lagi",
      });
      expect(result.error).toBeTruthy();
      expect(result.success).toBeUndefined();

      await db.delete(shifts).where(eq(shifts.id, shiftId));
      await db.delete(devices).where(eq(devices.id, fcDeviceId));
    });

    it("reconcile DALAM toleransi -> langsung 'reconciled', audit log 'shift_reconciled' tercatat", async () => {
      const { deviceId: fcDeviceId, shiftId } = await openIsolatedShift("C");
      await forceCloseShiftWithDb(db, businessId, "manager-uji-c", { shiftId, reason: "ditinggal" });

      // openingCash "0", tidak ada transaksi -- expectedCash = 0. Toleransi
      // fixture 20000, jadi countedCash "0" pasti dalam toleransi.
      const result = await reconcileForceClosedShiftWithDb(db, businessId, { shiftId, countedCash: "0" });
      expect(result.error).toBeUndefined();
      expect(result.success?.requiresReason).toBe(false);
      expect(result.success?.reconciled).toBe(true);

      const [row] = await db.select().from(shifts).where(eq(shifts.id, shiftId));
      expect(row?.status).toBe("reconciled");
      expect(row?.countedCash).toBe("0.00");

      const [log] = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.refId, shiftId), eq(auditLogs.action, "shift_reconciled")));
      expect(log).toBeTruthy();

      await db.delete(shifts).where(eq(shifts.id, shiftId));
      await db.delete(devices).where(eq(devices.id, fcDeviceId));
    });

    it("reconcile DI LUAR toleransi -> tetap 'closed' menunggu alasan, confirmForceClosedReconciliationWithDb baru memindahkan ke 'reconciled'", async () => {
      const { deviceId: fcDeviceId, shiftId } = await openIsolatedShift("D");
      await forceCloseShiftWithDb(db, businessId, "manager-uji-d", { shiftId, reason: "ditinggal" });

      // Toleransi fixture 20000 -- countedCash "100000" jauh di luar itu
      // (expectedCash tetap 0, tidak ada transaksi).
      const result = await reconcileForceClosedShiftWithDb(db, businessId, { shiftId, countedCash: "100000" });
      expect(result.error).toBeUndefined();
      expect(result.success?.requiresReason).toBe(true);
      expect(result.success?.reconciled).toBe(false);

      const [midRow] = await db.select().from(shifts).where(eq(shifts.id, shiftId));
      expect(midRow?.status).toBe("closed"); // BELUM 'reconciled'
      expect(midRow?.countedCash).toBe("100000.00"); // tapi sudah terkunci (write-once)

      // Percobaan reconcile KEDUA ditolak -- write-once, sama filosofi
      // submitCountedCashWithDb.
      const secondAttempt = await reconcileForceClosedShiftWithDb(db, businessId, { shiftId, countedCash: "0" });
      expect(secondAttempt.error).toBeTruthy();

      const confirmResult = await confirmForceClosedReconciliationWithDb(db, businessId, {
        shiftId,
        reason: "selisih karena modal awal salah dicatat manajer sebelumnya",
      });
      expect(confirmResult.error).toBeUndefined();
      expect(confirmResult.success?.reconciledAt).toBeTruthy();

      const [finalRow] = await db.select().from(shifts).where(eq(shifts.id, shiftId));
      expect(finalRow?.status).toBe("reconciled");

      const [log] = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.refId, shiftId), eq(auditLogs.action, "shift_reconciled")));
      expect(log?.reason).toBe("selisih karena modal awal salah dicatat manajer sebelumnya");

      await db.delete(shifts).where(eq(shifts.id, shiftId));
      await db.delete(devices).where(eq(devices.id, fcDeviceId));
    });

    it("reconcile DITOLAK untuk shift yang bukan hasil force-close (shift open biasa)", async () => {
      const { deviceId: fcDeviceId, shiftId } = await openIsolatedShift("E");

      const result = await reconcileForceClosedShiftWithDb(db, businessId, { shiftId, countedCash: "0" });
      expect(result.error).toBeTruthy();

      await db.delete(shifts).where(eq(shifts.id, shiftId));
      await db.delete(devices).where(eq(devices.id, fcDeviceId));
    });

    it("outlet CASHLESS: force-close langsung selesai, needsReview=false, tidak pernah menunggu rekonsiliasi", async () => {
      const [brand] = await db
        .insert(brands)
        .values({ businessId, name: `${PREFIX}_brand_cashless` })
        .returning({ id: brands.id });
      const [cashlessOutlet] = await db
        .insert(outlets)
        .values({
          businessId,
          brandId: brand!.id,
          code: "SHF2",
          name: `${PREFIX}_outlet_cashless`,
          cashEnabled: false,
        })
        .returning({ id: outlets.id });
      const [device] = await db
        .insert(devices)
        .values({ businessId, outletId: cashlessOutlet!.id, serialNumber: "SHIFTDEV_FC_CASHLESS", name: "Kasir Uji Cashless" })
        .returning({ id: devices.id });
      // Karyawan BARU khusus outlet ini -- EMPLOYEE_CODE fixture terikat
      // ke outlet ASLI (bertunai), verifyCashierPin() menolak kalau
      // outletId tidak cocok dengan employees.outlet_id-nya.
      const cashlessEmployeeCode = `${EMPLOYEE_CODE}_CL`;
      const cashlessPinHash = await hashPin(CORRECT_PIN);
      await db.insert(employees).values({
        businessId,
        outletId: cashlessOutlet!.id,
        code: cashlessEmployeeCode,
        fullName: `${PREFIX}_employee_cashless`,
        role: "cashier",
        pinHash: cashlessPinHash,
      });

      const opened = await openShiftWithDb(db, businessId, {
        id: generateId(),
        outletId: cashlessOutlet!.id,
        deviceId: device!.id,
        employeeCode: cashlessEmployeeCode,
        pin: CORRECT_PIN,
        openingCash: "0",
      });
      expect(opened.success).toBeTruthy();
      const shiftId = opened.success!.shiftId;

      const result = await forceCloseShiftWithDb(db, businessId, "manager-uji-cashless", {
        shiftId,
        reason: "ditinggal, outlet cashless",
      });
      expect(result.error).toBeUndefined();
      expect(result.success?.needsReview).toBe(false);

      const [row] = await db.select().from(shifts).where(eq(shifts.id, shiftId));
      expect(row?.status).toBe("closed");
      expect(row?.forceClosedAt).not.toBeNull();

      // audit_logs.employee_id -> employees FK -- hapus dulu sebelum
      // employee-nya, sama pola shifts/orders di afterAll file ini.
      await db.delete(auditLogs).where(eq(auditLogs.refId, shiftId));
      await db.delete(shifts).where(eq(shifts.id, shiftId));
      await db.delete(employees).where(eq(employees.code, cashlessEmployeeCode));
      await db.delete(devices).where(eq(devices.id, device!.id));
      await db.delete(outlets).where(eq(outlets.id, cashlessOutlet!.id));
      await db.delete(brands).where(eq(brands.id, brand!.id));
    });

    it("getShiftsNeedingReview: shift basi muncul reviewReason='stale', shift force-closed-tanpa-kas muncul reviewReason='force_closed_awaiting_cash'", async () => {
      const { deviceId: staleDeviceId, shiftId: staleShiftId } = await openIsolatedShift("F");
      await db.update(shifts).set({ businessDate: "2000-01-01" }).where(eq(shifts.id, staleShiftId));

      const { deviceId: fcDeviceId, shiftId: fcShiftId } = await openIsolatedShift("G");
      await forceCloseShiftWithDb(db, businessId, "manager-uji-f", { shiftId: fcShiftId, reason: "ditinggal" });

      const rows = await getShiftsNeedingReview(db, businessId, "Asia/Jakarta");
      const staleRow = rows.find((r) => r.id === staleShiftId);
      const fcRow = rows.find((r) => r.id === fcShiftId);

      expect(staleRow?.reviewReason).toBe("stale");
      expect(staleRow?.status).toBe("open");
      expect(fcRow?.reviewReason).toBe("force_closed_awaiting_cash");
      expect(fcRow?.status).toBe("closed");

      await db.delete(shifts).where(eq(shifts.id, staleShiftId));
      await db.delete(shifts).where(eq(shifts.id, fcShiftId));
      await db.delete(devices).where(eq(devices.id, staleDeviceId));
      await db.delete(devices).where(eq(devices.id, fcDeviceId));
    });
  });

  describe("closeAndReopenShiftWithDb -- §14 prasyarat shift, poin Indokopi 24 jam (13 September 2026)", () => {
    async function openIsolatedShiftWithOpeningCash(serialSuffix: string, openingCash: string) {
      const [device] = await db
        .insert(devices)
        .values({ businessId, outletId, serialNumber: `SHIFTDEV_CR_${serialSuffix}`, name: `Kasir Uji CR ${serialSuffix}` })
        .returning({ id: devices.id });
      const opened = await openShiftWithDb(db, businessId, {
        id: generateId(),
        outletId,
        deviceId: device!.id,
        employeeCode: EMPLOYEE_CODE,
        pin: CORRECT_PIN,
        openingCash,
      });
      if (!opened.success) {
        throw new Error(`Gagal buka shift uji close-and-reopen: ${opened.error}`);
      }
      return { deviceId: device!.id, shiftId: opened.success.shiftId };
    }

    it("selisih kas KECIL (dalam toleransi) -> langsung sukses, angka fisik yang SAMA jadi countedCash shift lama DAN openingCash shift baru -- selisih TETAP tercatat, bukan nol yang tidak berarti apa-apa", async () => {
      // openingCash 100000, tidak ada transaksi sama sekali -> expectedCash
      // = 100000 persis. countedCash 105000 -> selisih +5000, DI DALAM
      // toleransi fixture (20000), TAPI SENGAJA BUKAN NOL -- CEO eksplisit:
      // "kalau selisih selalu nol di test, berarti tidak ada yang diuji".
      const { deviceId: oldDeviceId, shiftId: oldShiftId } = await openIsolatedShiftWithOpeningCash("A", "100000");

      const result = await closeAndReopenShiftWithDb(db, businessId, {
        oldShiftId,
        countedCash: "105000",
        newShift: { id: generateId(), employeeCode: EMPLOYEE_CODE, pin: CORRECT_PIN, servedByName: "" },
      });
      expect(result.error).toBeUndefined();
      expect(result.needsReason).toBeUndefined();
      expect(result.success).toBeTruthy();
      expect(result.success?.cashVariance).toBe("5000.00");

      const [oldRow] = await db.select().from(shifts).where(eq(shifts.id, oldShiftId));
      expect(oldRow?.status).toBe("closed");
      expect(oldRow?.countedCash).toBe("105000.00");
      expect(oldRow?.expectedCash).toBe("100000.00");
      // SELISIH TETAP TERCATAT di shift LAMA -- ini yang dibuktikan, bukan
      // sekadar "berhasil".
      expect(oldRow?.cashVariance).toBe("5000.00");

      const [newRow] = await db.select().from(shifts).where(eq(shifts.id, result.success!.newShiftId));
      expect(newRow?.status).toBe("open");
      // Angka fisik yang SAMA (105000) -- BUKAN dihitung ulang -- jadi
      // saldo awal shift baru.
      expect(newRow?.openingCash).toBe("105000.00");
      expect(newRow?.countedCash).toBeNull();
      expect(newRow?.businessDate).toBe(oldRow?.businessDate);

      await db.delete(shifts).where(eq(shifts.id, oldShiftId));
      await db.delete(shifts).where(eq(shifts.id, result.success!.newShiftId));
      await db.delete(devices).where(eq(devices.id, oldDeviceId));
    });

    it("selisih kas BESAR (di luar toleransi) TANPA alasan -> needsReason, TIDAK ADA yang ditulis (shift lama tetap open, shift baru tidak pernah tercipta)", async () => {
      const { deviceId: oldDeviceId, shiftId: oldShiftId } = await openIsolatedShiftWithOpeningCash("B", "100000");
      const newShiftId = generateId();

      const result = await closeAndReopenShiftWithDb(db, businessId, {
        oldShiftId,
        countedCash: "50000", // selisih -50000, jauh di luar toleransi 20000
        newShift: { id: newShiftId, employeeCode: EMPLOYEE_CODE, pin: CORRECT_PIN, servedByName: "" },
      });
      expect(result.error).toBeUndefined();
      expect(result.success).toBeUndefined();
      expect(result.needsReason).toBeTruthy();
      expect(result.needsReason?.cashVariance).toBe("-50000.00");

      const [oldRow] = await db.select().from(shifts).where(eq(shifts.id, oldShiftId));
      expect(oldRow?.status).toBe("open"); // TIDAK disentuh sama sekali
      expect(oldRow?.countedCash).toBeNull();

      const [newRow] = await db.select().from(shifts).where(eq(shifts.id, newShiftId));
      expect(newRow).toBeUndefined(); // shift baru TIDAK PERNAH tercipta

      await db.delete(shifts).where(eq(shifts.id, oldShiftId));
      await db.delete(devices).where(eq(devices.id, oldDeviceId));
    });

    it("selisih di luar toleransi DENGAN alasan -> TETAP LANJUT (tidak diblokir), shift baru tetap terbuka, selisih besar tercatat apa adanya", async () => {
      const { deviceId: oldDeviceId, shiftId: oldShiftId } = await openIsolatedShiftWithOpeningCash("C", "100000");

      const result = await closeAndReopenShiftWithDb(db, businessId, {
        oldShiftId,
        countedCash: "50000",
        reason: "Uang dipakai bayar supplier mendadak, belum dicatat kas keluar",
        newShift: { id: generateId(), employeeCode: EMPLOYEE_CODE, pin: CORRECT_PIN, servedByName: "" },
      });
      expect(result.error).toBeUndefined();
      expect(result.needsReason).toBeUndefined();
      expect(result.success).toBeTruthy();
      expect(result.success?.cashVariance).toBe("-50000.00");

      const [oldRow] = await db.select().from(shifts).where(eq(shifts.id, oldShiftId));
      expect(oldRow?.status).toBe("closed"); // TETAP ditutup, TIDAK diblokir
      expect(oldRow?.cashVariance).toBe("-50000.00"); // selisih besar TETAP tercatat
      expect(oldRow?.note).toBe("Uang dipakai bayar supplier mendadak, belum dicatat kas keluar");

      const [newRow] = await db.select().from(shifts).where(eq(shifts.id, result.success!.newShiftId));
      expect(newRow?.status).toBe("open"); // shift baru TETAP terbuka, tidak diblokir
      expect(newRow?.openingCash).toBe("50000.00");

      await db.delete(shifts).where(eq(shifts.id, oldShiftId));
      await db.delete(shifts).where(eq(shifts.id, result.success!.newShiftId));
      await db.delete(devices).where(eq(devices.id, oldDeviceId));
    });

    it("PIN shift baru SALAH -> shift lama TIDAK ditutup sama sekali (gagal sebelum transaksi DB apa pun)", async () => {
      const { deviceId: oldDeviceId, shiftId: oldShiftId } = await openIsolatedShiftWithOpeningCash("D", "100000");

      const result = await closeAndReopenShiftWithDb(db, businessId, {
        oldShiftId,
        countedCash: "100000",
        newShift: { id: generateId(), employeeCode: EMPLOYEE_CODE, pin: WRONG_PIN, servedByName: "" },
      });
      expect(result.error).toBeTruthy();
      expect(result.success).toBeUndefined();

      const [oldRow] = await db.select().from(shifts).where(eq(shifts.id, oldShiftId));
      expect(oldRow?.status).toBe("open"); // TETAP open, tidak setengah-jalan

      await db.delete(shifts).where(eq(shifts.id, oldShiftId));
      await db.delete(devices).where(eq(devices.id, oldDeviceId));
    });

    it("outlet CASHLESS: tutup-dan-buka langsung tanpa hitungan apa pun, countedCash/expectedCash/cashVariance tetap null di shift lama", async () => {
      const [brand] = await db
        .insert(brands)
        .values({ businessId, name: `${PREFIX}_brand_cr_cashless` })
        .returning({ id: brands.id });
      const [cashlessOutlet] = await db
        .insert(outlets)
        .values({ businessId, brandId: brand!.id, code: "SHF3", name: `${PREFIX}_outlet_cr_cashless`, cashEnabled: false })
        .returning({ id: outlets.id });
      const cashlessEmployeeCode = `${EMPLOYEE_CODE}_CRCL`;
      const cashlessPinHash = await hashPin(CORRECT_PIN);
      await db.insert(employees).values({
        businessId,
        outletId: cashlessOutlet!.id,
        code: cashlessEmployeeCode,
        fullName: `${PREFIX}_employee_cr_cashless`,
        role: "cashier",
        pinHash: cashlessPinHash,
      });
      const [device] = await db
        .insert(devices)
        .values({ businessId, outletId: cashlessOutlet!.id, serialNumber: "SHIFTDEV_CR_CASHLESS", name: "Kasir Uji CR Cashless" })
        .returning({ id: devices.id });
      const opened = await openShiftWithDb(db, businessId, {
        id: generateId(),
        outletId: cashlessOutlet!.id,
        deviceId: device!.id,
        employeeCode: cashlessEmployeeCode,
        pin: CORRECT_PIN,
        openingCash: "0",
      });
      expect(opened.success).toBeTruthy();
      const oldShiftId = opened.success!.shiftId;

      const result = await closeAndReopenShiftWithDb(db, businessId, {
        oldShiftId,
        // countedCash TIDAK dikirim sama sekali -- outlet cashless
        // melewati seluruh langkah kas.
        newShift: { id: generateId(), employeeCode: cashlessEmployeeCode, pin: CORRECT_PIN, servedByName: "" },
      });
      expect(result.error).toBeUndefined();
      expect(result.needsReason).toBeUndefined();
      expect(result.success).toBeTruthy();

      const [oldRow] = await db.select().from(shifts).where(eq(shifts.id, oldShiftId));
      expect(oldRow?.status).toBe("closed");
      expect(oldRow?.countedCash).toBeNull();
      expect(oldRow?.expectedCash).toBeNull();
      expect(oldRow?.cashVariance).toBeNull();

      const [newRow] = await db.select().from(shifts).where(eq(shifts.id, result.success!.newShiftId));
      expect(newRow?.openingCash).toBe("0.00");

      await db.delete(shifts).where(eq(shifts.id, oldShiftId));
      await db.delete(shifts).where(eq(shifts.id, result.success!.newShiftId));
      await db.delete(employees).where(eq(employees.code, cashlessEmployeeCode));
      await db.delete(devices).where(eq(devices.id, device!.id));
      await db.delete(outlets).where(eq(outlets.id, cashlessOutlet!.id));
      await db.delete(brands).where(eq(brands.id, brand!.id));
    });
  });
});
