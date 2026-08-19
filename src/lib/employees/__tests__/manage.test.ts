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
    const first = await createEmployeeWithDb(db, businessId, {
      code: "DUPCODE",
      fullName: "Karyawan Pertama",
      role: "cashier",
      outletId,
      pin: "111111",
    });
    expect(first.success).toBeTruthy();

    const second = await createEmployeeWithDb(db, businessId, {
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

    const result = await updateEmployeeWithDb(db, businessId, {
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

    const result = await updateEmployeeWithDb(db, businessId, {
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

    const result = await updateEmployeeWithDb(db, businessId, {
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

    const resetResult = await resetPinWithDb(db, businessId, { employeeId, newPin });
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

    const unlockResult = await unlockEmployeeWithDb(db, businessId, { employeeId });
    expect(unlockResult.success).toBeTruthy();

    const identity = await verifyCashierPin({ outletId, code, pin });
    expect(identity.employeeId).toBe(employeeId);
  });

  it("regresi: karyawan nonaktif tidak lolos verifyCashierPin", async () => {
    const code = "INACTIVE1";
    const pin = "999999";
    const employeeId = await insertEmployee(code, pin);

    await updateEmployeeWithDb(db, businessId, {
      id: employeeId,
      fullName: `${PREFIX}_${code}`,
      role: "cashier",
      outletId,
      isActive: false,
    });

    await expect(verifyCashierPin({ outletId, code, pin })).rejects.toThrow(/salah/i);
  });
});
