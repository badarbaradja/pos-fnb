/**
 * Test integrasi ambang "barang menumpuk" (instruksi CEO 11 September
 * 2026: default 60 hari, wajib bisa diubah Ita/CEO, bukan angka mati).
 * Butuh koneksi Supabase sungguhan, pola sama shift.test.ts -- di-skip
 * otomatis kalau env belum diisi.
 *
 * getAdminDb() dipakai SENGAJA di sini (setup fixture lintas tabel +
 * memanggil fungsi yang cuma butuh UserDbHandle["db"], bukan test RLS).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
import { eq } from "drizzle-orm";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { getAdminDb } from "@/lib/db/client";
import { barang, brands, businesses, devices, employees, outlets, shifts } from "@/lib/db/schema";
import { hashPin } from "@/lib/auth/pin";
import { generateId } from "@/lib/utils/id";
import { openShiftWithDb } from "../shift";
import {
  getBarangMenumpuk,
  getBarangMenumpukDays,
  setBarangMenumpukDaysWithDb,
} from "../thrift-statistik";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

describe.skipIf(!hasEnv)("ambang barang menumpuk", () => {
  const db = getAdminDb();
  const PREFIX = `TEST_MENUMPUK_${Date.now()}`;
  const PIN = "135790";

  let businessId: string;
  let outletId: string;
  let managerShiftId: string;
  let cashierShiftId: string;
  let barangLamaId: string;
  let barangBaruId: string;

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
        code: "MNP1",
        name: `${PREFIX}_outlet`,
        posMode: "thrifting",
      })
      .returning({ id: outlets.id });
    outletId = outlet!.id;

    // Dua device terpisah -- openShiftWithDb menolak shift kedua di DEVICE
    // yang sama selagi masih ada yang terbuka (getOpenShiftForDevice), jadi
    // manager dan cashier di test ini butuh device masing-masing supaya
    // KEDUANYA bisa punya shift open bersamaan untuk skenario izin di bawah.
    const [managerDevice] = await db
      .insert(devices)
      .values({ businessId, outletId, serialNumber: "MNPDEV1", name: "Kasir Uji Menumpuk (Manager)" })
      .returning({ id: devices.id });
    const managerDeviceId = managerDevice!.id;

    const [cashierDevice] = await db
      .insert(devices)
      .values({ businessId, outletId, serialNumber: "MNPDEV2", name: "Kasir Uji Menumpuk (Cashier)" })
      .returning({ id: devices.id });
    const cashierDeviceId = cashierDevice!.id;

    const pinHash = await hashPin(PIN);
    await db.insert(employees).values([
      {
        businessId,
        outletId,
        code: "MNPMGR",
        fullName: `${PREFIX}_manager`,
        role: "manager",
        pinHash,
      },
      {
        businessId,
        outletId,
        code: "MNPCSH",
        fullName: `${PREFIX}_cashier`,
        role: "cashier",
        pinHash,
      },
    ]);

    const managerShift = await openShiftWithDb(db, businessId, {
      id: generateId(),
      outletId,
      deviceId: managerDeviceId,
      employeeCode: "MNPMGR",
      pin: PIN,
      openingCash: "0",
    });
    if (!managerShift.success) throw new Error("Gagal buka shift manager untuk fixture test");
    managerShiftId = managerShift.success.shiftId;

    const cashierShift = await openShiftWithDb(db, businessId, {
      id: generateId(),
      outletId,
      deviceId: cashierDeviceId,
      employeeCode: "MNPCSH",
      pin: PIN,
      openingCash: "0",
    });
    if (!cashierShift.success) throw new Error("Gagal buka shift cashier untuk fixture test");
    cashierShiftId = cashierShift.success.shiftId;

    const now = Date.now();
    const [lama] = await db
      .insert(barang)
      .values({
        businessId,
        outletId,
        kode: `${PREFIX}_LAMA`,
        nama: "Baju Lama",
        hargaJual: "50000",
        status: "siap_jual",
        masukPada: new Date(now - 90 * 86_400_000), // 90 hari lalu
      })
      .returning({ id: barang.id });
    barangLamaId = lama!.id;

    const [baru] = await db
      .insert(barang)
      .values({
        businessId,
        outletId,
        kode: `${PREFIX}_BARU`,
        nama: "Baju Baru",
        hargaJual: "50000",
        status: "siap_jual",
        masukPada: new Date(now - 5 * 86_400_000), // 5 hari lalu
      })
      .returning({ id: barang.id });
    barangBaruId = baru!.id;
  });

  afterAll(async () => {
    if (businessId) {
      await db.delete(shifts).where(eq(shifts.businessId, businessId));
      await db.delete(businesses).where(eq(businesses.id, businessId));
    }
  });

  it("data uji benar-benar terbentuk sebelum diuji", () => {
    expect(businessId).toBeTruthy();
    expect(outletId).toBeTruthy();
    expect(managerShiftId).toBeTruthy();
    expect(cashierShiftId).toBeTruthy();
    expect(barangLamaId).toBeTruthy();
    expect(barangBaruId).toBeTruthy();
  });

  it("ambang bawaan 60 hari kalau belum pernah diubah", async () => {
    const days = await getBarangMenumpukDays(db, businessId, outletId);
    expect(days).toBe(60);
  });

  it("getBarangMenumpuk cuma mengembalikan barang >= ambang", async () => {
    const rows = await getBarangMenumpuk(db, businessId, outletId, 60);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(barangLamaId);
    expect(ids).not.toContain(barangBaruId);
  });

  it("cashier (bukan manager/owner) DITOLAK mengubah ambang", async () => {
    const result = await setBarangMenumpukDaysWithDb(db, businessId, cashierShiftId, "10");
    expect(result.error).toBeTruthy();
    expect(result.success).toBeUndefined();
  });

  it("angka tidak valid ditolak", async () => {
    const result = await setBarangMenumpukDaysWithDb(db, businessId, managerShiftId, "abc");
    expect(result.error).toBeTruthy();

    const zero = await setBarangMenumpukDaysWithDb(db, businessId, managerShiftId, 0);
    expect(zero.error).toBeTruthy();
  });

  it("manager berhasil mengubah ambang, dan mempengaruhi getBarangMenumpuk berikutnya", async () => {
    const result = await setBarangMenumpukDaysWithDb(db, businessId, managerShiftId, 10);
    expect(result.success).toEqual({ days: 10 });

    const days = await getBarangMenumpukDays(db, businessId, outletId);
    expect(days).toBe(10);

    // Ambang baru (10 hari) -- barang 5 hari lalu tetap belum menumpuk,
    // barang 90 hari lalu tetap lolos.
    const rows = await getBarangMenumpuk(db, businessId, outletId, days);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(barangLamaId);
    expect(ids).not.toContain(barangBaruId);
  });
});
