/**
 * T15c — Test integrasi CRUD perangkat. Butuh koneksi Supabase sungguhan
 * (DATABASE_URL + NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY),
 * di-skip otomatis kalau env belum diisi -- pola sama
 * lib/employees/__tests__/manage.test.ts (T15b).
 *
 * Data uji diberi prefix TEST_DEVICES_ dan dibersihkan di afterAll.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
import { eq } from "drizzle-orm";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { getAdminDb } from "@/lib/db/client";
import { brands, businesses, devices, outlets } from "@/lib/db/schema";
import { createDeviceWithDb, updateDeviceWithDb } from "../manage";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

describe.skipIf(!hasEnv)("T15c — CRUD perangkat", () => {
  const db = getAdminDb();
  const PREFIX = `TEST_DEVICES_${Date.now()}`;

  let businessId: string;
  let outletId: string;
  let otherOutletId: string;

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
    const brandId = brand!.id;

    const [outlet] = await db
      .insert(outlets)
      .values({ businessId, brandId, code: "DEV1", name: `${PREFIX}_outlet_1` })
      .returning({ id: outlets.id });
    outletId = outlet!.id;

    const [otherOutlet] = await db
      .insert(outlets)
      .values({ businessId, brandId, code: "DEV2", name: `${PREFIX}_outlet_2` })
      .returning({ id: outlets.id });
    otherOutletId = otherOutlet!.id;
  });

  afterAll(async () => {
    if (businessId) {
      await db.delete(businesses).where(eq(businesses.id, businessId));
    }
  });

  it("data uji benar-benar terbentuk sebelum diuji (bukan hijau karena kosong)", () => {
    expect(businessId).toBeTruthy();
    expect(outletId).toBeTruthy();
    expect(otherOutletId).toBeTruthy();
  });

  it("serial number duplikat di bisnis sama ditolak dengan pesan jelas", async () => {
    const first = await createDeviceWithDb(db, businessId, null, {
      name: "Kasir 1",
      outletId,
      serialNumber: "DUPSERIAL",
      deviceType: "pos",
    });
    expect(first.success).toBeTruthy();

    const second = await createDeviceWithDb(db, businessId, null, {
      name: "Kasir 2",
      outletId,
      serialNumber: "DUPSERIAL",
      deviceType: "pos",
    });
    expect(second.error).toBeTruthy();
    expect(second.success).toBeUndefined();
  });

  it("update nama/outlet/isActive berhasil", async () => {
    const created = await createDeviceWithDb(db, businessId, null, {
      name: "Sebelum Ubah",
      outletId,
      serialNumber: "UPDME",
      deviceType: "pos",
    });
    const deviceId = created.success!.deviceId;

    const result = await updateDeviceWithDb(db, businessId, null, {
      id: deviceId,
      name: "Sesudah Ubah",
      outletId: otherOutletId,
      isActive: true,
    });
    expect(result.success).toBeTruthy();

    const [row] = await db.select().from(devices).where(eq(devices.id, deviceId));
    expect(row?.name).toBe("Sesudah Ubah");
    expect(row?.outletId).toBe(otherOutletId);
  });

  it("nonaktifkan device: tetap ada di tabel (bukan dihapus), isActive jadi false", async () => {
    const created = await createDeviceWithDb(db, businessId, null, {
      name: "Akan Dinonaktifkan",
      outletId,
      serialNumber: "DEACTIVATEME",
      deviceType: "pos",
    });
    const deviceId = created.success!.deviceId;

    const result = await updateDeviceWithDb(db, businessId, null, {
      id: deviceId,
      name: "Akan Dinonaktifkan",
      outletId,
      isActive: false,
    });
    expect(result.success).toBeTruthy();

    const [row] = await db.select().from(devices).where(eq(devices.id, deviceId));
    expect(row).toBeTruthy(); // masih ada, bukan dihapus
    expect(row?.isActive).toBe(false);
  });

  describe("Pembatasan akses per outlet, Tahap 4 (13 September 2026, §27)", () => {
    it("createDeviceWithDb: allowedOutletIds TIDAK memuat outlet ini -- DITOLAK, TIDAK ADA baris baru", async () => {
      const before = await db.select({ id: devices.id }).from(devices).where(eq(devices.outletId, otherOutletId));

      const result = await createDeviceWithDb(db, businessId, [outletId], {
        name: "Dipaksa ke Outlet Lain",
        outletId: otherOutletId,
        serialNumber: "SCOPECREATENO",
        deviceType: "pos",
      });
      expect(result.error).toBeTruthy();
      expect(result.error).not.toContain(otherOutletId);

      const after = await db.select({ id: devices.id }).from(devices).where(eq(devices.outletId, otherOutletId));
      expect(after.length).toBe(before.length);
    });

    it("updateDeviceWithDb: baris SAAT INI di outlet LAIN -- DITOLAK, baris TIDAK BERUBAH, walau input outletId diisi outlet yang diizinkan", async () => {
      const created = await createDeviceWithDb(db, businessId, null, {
        name: "Device Outlet Lain",
        outletId: otherOutletId,
        serialNumber: "SCOPEUPDCURR",
        deviceType: "pos",
      });
      const deviceId = created.success!.deviceId;
      const [before] = await db.select().from(devices).where(eq(devices.id, deviceId));

      const result = await updateDeviceWithDb(db, businessId, [outletId], {
        id: deviceId,
        name: "DIUBAH PAKSA",
        outletId, // mencoba "menarik" ke outlet yang diizinkan
        isActive: true,
      });
      expect(result.error).toBeTruthy();

      const [after] = await db.select().from(devices).where(eq(devices.id, deviceId));
      expect(after?.name).toBe(before?.name);
      expect(after?.outletId).toBe(otherOutletId); // tidak pernah "ditarik"
    });

    it("updateDeviceWithDb: baris di outlet yang diizinkan, TAPI input outletId memindahkan ke outlet LAIN -- DITOLAK, baris TETAP di outlet asal", async () => {
      const created = await createDeviceWithDb(db, businessId, null, {
        name: "Device Outlet Sendiri",
        outletId,
        serialNumber: "SCOPEUPDTARGET",
        deviceType: "pos",
      });
      const deviceId = created.success!.deviceId;

      const result = await updateDeviceWithDb(db, businessId, [outletId], {
        id: deviceId,
        name: "Device Outlet Sendiri",
        outletId: otherOutletId, // mencoba memindahkan keluar
        isActive: true,
      });
      expect(result.error).toBeTruthy();

      const [after] = await db.select().from(devices).where(eq(devices.id, deviceId));
      expect(after?.outletId).toBe(outletId); // tidak pernah pindah
    });

    it("allowedOutletIds array KOSONG -- DITOLAK juga (create maupun update)", async () => {
      const createResult = await createDeviceWithDb(db, businessId, [], {
        name: "X",
        outletId,
        serialNumber: "SCOPEEMPTYCREATE",
        deviceType: "pos",
      });
      expect(createResult.error).toBeTruthy();

      const created = await createDeviceWithDb(db, businessId, null, {
        name: "Y",
        outletId,
        serialNumber: "SCOPEEMPTYUPD",
        deviceType: "pos",
      });
      const updateResult = await updateDeviceWithDb(db, businessId, [], {
        id: created.success!.deviceId,
        name: "Y",
        outletId,
        isActive: true,
      });
      expect(updateResult.error).toBeTruthy();
    });
  });
});
