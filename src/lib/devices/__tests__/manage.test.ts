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
    const first = await createDeviceWithDb(db, businessId, {
      name: "Kasir 1",
      outletId,
      serialNumber: "DUPSERIAL",
      deviceType: "pos",
    });
    expect(first.success).toBeTruthy();

    const second = await createDeviceWithDb(db, businessId, {
      name: "Kasir 2",
      outletId,
      serialNumber: "DUPSERIAL",
      deviceType: "pos",
    });
    expect(second.error).toBeTruthy();
    expect(second.success).toBeUndefined();
  });

  it("update nama/outlet/isActive berhasil", async () => {
    const created = await createDeviceWithDb(db, businessId, {
      name: "Sebelum Ubah",
      outletId,
      serialNumber: "UPDME",
      deviceType: "pos",
    });
    const deviceId = created.success!.deviceId;

    const result = await updateDeviceWithDb(db, businessId, {
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
    const created = await createDeviceWithDb(db, businessId, {
      name: "Akan Dinonaktifkan",
      outletId,
      serialNumber: "DEACTIVATEME",
      deviceType: "pos",
    });
    const deviceId = created.success!.deviceId;

    const result = await updateDeviceWithDb(db, businessId, {
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
});
