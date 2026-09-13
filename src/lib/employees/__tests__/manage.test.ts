/**
 * T15b — Test integrasi CRUD karyawan. Butuh koneksi Supabase sungguhan
 * (DATABASE_URL + NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY),
 * sama seperti src/lib/pos/__tests__/shift.test.ts -- di-skip otomatis
 * kalau env belum diisi, bukan hijau palsu.
 *
 * getAdminDb() dipakai di sini SENGAJA melewati RLS -- ini test, bukan
 * kode aplikasi, dan fixture-nya bikin business/outlet/employee dari nol
 * yang butuh akses penuh untuk setup + assert langsung ke DB.
 *
 * Data uji diberi prefix TEST_EMPLOYEES_ dan dibersihkan di afterAll
 * (bukan di akhir tiap test) supaya tetap bersih walau ada test yang
 * gagal di tengah.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
import { eq } from "drizzle-orm";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { getAdminDb } from "@/lib/db/client";
import { brands, businesses, devices, employees, outlets, shifts } from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";
import { hashPin, verifyCashierPin } from "@/lib/auth/pin";
import { openShiftWithDb } from "@/lib/pos/shift";
import {
  createEmployeeWithDb,
  resetPinWithDb,
  unlockEmployeeWithDb,
  updateEmployeeWithDb,
} from "../manage";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

describe.skipIf(!hasEnv)("T15b — CRUD karyawan", () => {
  const db = getAdminDb();
  const PREFIX = `TEST_EMPLOYEES_${Date.now()}`;

  let businessId: string;
  let outletId: string;
  let outletBId: string;
  let deviceId: string;

  async function insertEmployee(code: string, pin: string) {
    const employeeId = generateId();
    const pinHash = await hashPin(pin);
    await db.insert(employees).values({
      id: employeeId,
      businessId,
      outletId,
      code,
      fullName: `${PREFIX}_${code}`,
      role: "cashier",
      pinHash,
    });
    return employeeId;
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
      .values({ businessId, brandId: brand!.id, code: "EMP1", name: `${PREFIX}_outlet` })
      .returning({ id: outlets.id });
    outletId = outlet!.id;

    const [outletB] = await db
      .insert(outlets)
      .values({ businessId, brandId: brand!.id, code: "EMP2", name: `${PREFIX}_outletB` })
      .returning({ id: outlets.id });
    outletBId = outletB!.id;

    const [device] = await db
      .insert(devices)
      .values({ businessId, outletId, serialNumber: "EMPDEV1", name: "Kasir Uji Karyawan" })
      .returning({ id: devices.id });
    deviceId = device!.id;
  });

  afterAll(async () => {
    // shifts.employee_id TIDAK cascade dari employees (NO ACTION) -- hapus
    // dulu sebelum businesses, sisanya (employees/outlets/devices) cascade
    // dari businesses.
    if (businessId) {
      await db.delete(shifts).where(eq(shifts.businessId, businessId));
      await db.delete(businesses).where(eq(businesses.id, businessId));
    }
  });

  it("data uji benar-benar terbentuk sebelum diuji (bukan hijau karena kosong)", () => {
    expect(businessId).toBeTruthy();
    expect(outletId).toBeTruthy();
    expect(deviceId).toBeTruthy();
  });

  it("kode duplikat di bisnis sama ditolak dengan pesan jelas", async () => {
    const first = await createEmployeeWithDb(db, businessId, null, {
      code: "DUPCODE",
      fullName: "Karyawan Pertama",
      role: "cashier",
      outletId,
      pin: "111111",
    });
    expect(first.success).toBeTruthy();

    const second = await createEmployeeWithDb(db, businessId, null, {
      code: "DUPCODE",
      fullName: "Karyawan Kedua",
      role: "cashier",
      outletId,
      pin: "222222",
    });
    expect(second.error).toBeTruthy();
    expect(second.success).toBeUndefined();
  });

  it("update nama/role/outlet berhasil", async () => {
    const employeeId = await insertEmployee("UPDME", "333333");

    const result = await updateEmployeeWithDb(db, businessId, null, {
      id: employeeId,
      fullName: "Nama Baru",
      role: "manager",
      outletId,
      isActive: true,
    });
    expect(result.success).toBeTruthy();

    const [row] = await db.select().from(employees).where(eq(employees.id, employeeId));
    expect(row?.fullName).toBe("Nama Baru");
    expect(row?.role).toBe("manager");
  });

  it("nonaktifkan karyawan yang PUNYA shift terbuka DITOLAK di server", async () => {
    const code = "OPENSHIFT";
    const pin = "444444";
    const employeeId = await insertEmployee(code, pin);

    const openResult = await openShiftWithDb(db, businessId, {
      id: generateId(),
      outletId,
      deviceId,
      employeeCode: code,
      pin,
      openingCash: "0",
    });
    expect(openResult.success).toBeTruthy();

    const result = await updateEmployeeWithDb(db, businessId, null, {
      id: employeeId,
      fullName: `${PREFIX}_${code}`,
      role: "cashier",
      outletId,
      isActive: false,
    });
    expect(result.error).toBeTruthy();

    const [row] = await db.select().from(employees).where(eq(employees.id, employeeId));
    expect(row?.isActive).toBe(true); // tidak berubah
  });

  it("nonaktifkan karyawan TANPA shift terbuka berhasil", async () => {
    const employeeId = await insertEmployee("NOSHIFT", "555555");

    const result = await updateEmployeeWithDb(db, businessId, null, {
      id: employeeId,
      fullName: `${PREFIX}_NOSHIFT`,
      role: "cashier",
      outletId,
      isActive: false,
    });
    expect(result.success).toBeTruthy();

    const [row] = await db.select().from(employees).where(eq(employees.id, employeeId));
    expect(row?.isActive).toBe(false);
  });

  it("reset PIN: PIN lama berhenti berfungsi, PIN baru berfungsi, lockout ikut ter-reset", async () => {
    const code = "RESETPIN";
    const oldPin = "666666";
    const newPin = "777777";
    const employeeId = await insertEmployee(code, oldPin);

    // Kunci dulu (lockout tertinggal) supaya kita bisa buktikan reset PIN
    // ikut membuka kunci.
    await db
      .update(employees)
      .set({ failedAttempts: 5, lockedUntil: new Date(Date.now() + 15 * 60_000) })
      .where(eq(employees.id, employeeId));

    const resetResult = await resetPinWithDb(db, businessId, null, { employeeId, newPin });
    expect(resetResult.success).toBeTruthy();

    await expect(
      verifyCashierPin({ outletId, code, pin: oldPin })
    ).rejects.toThrow(/salah|terkunci/i);

    const identity = await verifyCashierPin({ outletId, code, pin: newPin });
    expect(identity.employeeId).toBe(employeeId);
  });

  it("buka kunci: karyawan yang terkunci bisa login lagi setelah unlockEmployeeWithDb", async () => {
    const code = "UNLOCKME";
    const pin = "888888";
    const employeeId = await insertEmployee(code, pin);

    for (let i = 0; i < 5; i++) {
      await expect(
        verifyCashierPin({ outletId, code, pin: "000000" })
      ).rejects.toThrow(/salah/i);
    }
    await expect(verifyCashierPin({ outletId, code, pin })).rejects.toThrow(/terkunci/i);

    const unlockResult = await unlockEmployeeWithDb(db, businessId, null, { employeeId });
    expect(unlockResult.success).toBeTruthy();

    const identity = await verifyCashierPin({ outletId, code, pin });
    expect(identity.employeeId).toBe(employeeId);
  });

  it("regresi: karyawan nonaktif tidak lolos verifyCashierPin", async () => {
    const code = "INACTIVE1";
    const pin = "999999";
    const employeeId = await insertEmployee(code, pin);

    await updateEmployeeWithDb(db, businessId, null, {
      id: employeeId,
      fullName: `${PREFIX}_${code}`,
      role: "cashier",
      outletId,
      isActive: false,
    });

    await expect(verifyCashierPin({ outletId, code, pin })).rejects.toThrow(/salah/i);
  });

  describe("Pembatasan akses per outlet, Tahap 4 (13 September 2026, §27)", () => {
    it("createEmployeeWithDb: allowedOutletIds TIDAK memuat outlet ini -- DITOLAK, TIDAK ADA baris baru", async () => {
      const before = await db.select({ id: employees.id }).from(employees).where(eq(employees.outletId, outletBId));

      const result = await createEmployeeWithDb(db, businessId, [outletId], {
        code: "SCOPECREATENO",
        fullName: "Karyawan Scope",
        role: "cashier",
        outletId: outletBId,
        pin: "121212",
      });
      expect(result.error).toBeTruthy();
      expect(result.error).not.toContain(outletBId);

      const after = await db.select({ id: employees.id }).from(employees).where(eq(employees.outletId, outletBId));
      expect(after.length).toBe(before.length);
    });

    it("createEmployeeWithDb: allowedOutletIds memuat outlet ini -- berhasil", async () => {
      const result = await createEmployeeWithDb(db, businessId, [outletId], {
        code: "SCOPECREATEOK",
        fullName: "Karyawan Scope OK",
        role: "cashier",
        outletId,
        pin: "232323",
      });
      expect(result.success).toBeTruthy();
    });

    it("updateEmployeeWithDb: baris SAAT INI di outlet LAIN (di luar cakupan) -- DITOLAK, baris TIDAK BERUBAH, walau input outletId diisi outlet yang diizinkan", async () => {
      const employeeId = await insertEmployee("SCOPEUPDCURR", "343434"); // outlet A (outletId)
      // pindahkan manual ke outlet B dulu (simulasikan baris SUDAH di outlet
      // di luar cakupan manajer yang mencoba mengubahnya)
      await db.update(employees).set({ outletId: outletBId }).where(eq(employees.id, employeeId));
      const [before] = await db.select().from(employees).where(eq(employees.id, employeeId));

      // Manajer cuma diizinkan outletId (A) -- mencoba mengubah karyawan
      // yang SEKARANG di outletB, walau input outletId diisi outletA
      // (mencoba "menarik" karyawan itu ke outlet sendiri).
      const result = await updateEmployeeWithDb(db, businessId, [outletId], {
        id: employeeId,
        fullName: "DIUBAH PAKSA",
        role: "cashier",
        outletId,
        isActive: true,
      });
      expect(result.error).toBeTruthy();

      const [after] = await db.select().from(employees).where(eq(employees.id, employeeId));
      expect(after?.fullName).toBe(before?.fullName);
      expect(after?.outletId).toBe(outletBId); // tidak pernah "ditarik"
    });

    it("updateEmployeeWithDb: baris di outlet yang diizinkan, TAPI input outletId memindahkan ke outlet LAIN -- DITOLAK, baris TETAP di outlet asal", async () => {
      const employeeId = await insertEmployee("SCOPEUPDTARGET", "454545"); // outlet A (outletId)
      const [before] = await db.select().from(employees).where(eq(employees.id, employeeId));

      // Manajer cuma diizinkan outletId (A), baris ini MEMANG di outlet A --
      // tapi mencoba memindahkannya ke outletB lewat input.
      const result = await updateEmployeeWithDb(db, businessId, [outletId], {
        id: employeeId,
        fullName: before!.fullName,
        role: "cashier",
        outletId: outletBId,
        isActive: true,
      });
      expect(result.error).toBeTruthy();

      const [after] = await db.select().from(employees).where(eq(employees.id, employeeId));
      expect(after?.outletId).toBe(outletId); // tidak pernah pindah ke outletB
    });

    it("updateEmployeeWithDb: baris DAN outletId tujuan sama-sama di outlet yang diizinkan -- berhasil", async () => {
      const employeeId = await insertEmployee("SCOPEUPDOK", "565656");

      const result = await updateEmployeeWithDb(db, businessId, [outletId], {
        id: employeeId,
        fullName: "Nama Diizinkan",
        role: "cashier",
        outletId,
        isActive: true,
      });
      expect(result.success).toBeTruthy();
    });

    it("resetPinWithDb: karyawan di outlet LAIN -- DITOLAK, PIN lama TETAP berfungsi", async () => {
      const code = "SCOPERESETNO";
      const oldPin = "676767";
      const employeeId = await insertEmployee(code, oldPin);
      await db.update(employees).set({ outletId: outletBId }).where(eq(employees.id, employeeId));

      const result = await resetPinWithDb(db, businessId, [outletId], { employeeId, newPin: "787878" });
      expect(result.error).toBeTruthy();

      const identity = await verifyCashierPin({ outletId: outletBId, code, pin: oldPin });
      expect(identity.employeeId).toBe(employeeId); // PIN lama tetap berfungsi
    });

    it("unlockEmployeeWithDb: karyawan di outlet LAIN -- DITOLAK, tetap terkunci", async () => {
      const code = "SCOPEUNLOCKNO";
      const pin = "898989";
      const employeeId = await insertEmployee(code, pin);
      await db.update(employees).set({ outletId: outletBId }).where(eq(employees.id, employeeId));

      for (let i = 0; i < 5; i++) {
        await expect(
          verifyCashierPin({ outletId: outletBId, code, pin: "000000" })
        ).rejects.toThrow(/salah/i);
      }

      const result = await unlockEmployeeWithDb(db, businessId, [outletId], { employeeId });
      expect(result.error).toBeTruthy();

      await expect(verifyCashierPin({ outletId: outletBId, code, pin })).rejects.toThrow(/terkunci/i);
    });
  });
});
