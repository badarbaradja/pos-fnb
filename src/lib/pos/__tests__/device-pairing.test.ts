/**
 * T22e — Test integrasi pairDeviceWithDb. Butuh koneksi Supabase sungguhan
 * (DATABASE_URL + NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY),
 * sama seperti src/lib/pos/__tests__/shift.test.ts -- di-skip otomatis
 * kalau env belum diisi, bukan hijau palsu.
 *
 * getPairedDevice() TIDAK dites di sini -- fungsi itu baca cookie lewat
 * next/headers, yang butuh request scope Next.js sungguhan (tidak bisa
 * dipanggil dari Vitest node biasa, sama batasan yang didokumentasikan di
 * lib/auth/supabase.ts untuk createServerSupabaseClient()). Bagian itu
 * dibuktikan lewat verifikasi browser, bukan unit test.
 *
 * getAdminDb() dipakai di sini SENGAJA melewati RLS -- ini test, bukan
 * kode aplikasi (pola sama shift.test.ts: RLS bukan yang sedang diuji).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
import { eq } from "drizzle-orm";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { getAdminDb } from "@/lib/db/client";
import { brands, businesses, devices, employees, outlets, shifts } from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";
import { hashPin } from "@/lib/auth/pin";
import { openShiftWithDb } from "../shift";
import { pairDeviceWithDb } from "../device-pairing";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

describe.skipIf(!hasEnv)("T22e — pairDeviceWithDb", () => {
  const db = getAdminDb();
  const PREFIX = `TEST_DEVICEPAIRING_${Date.now()}`;

  let businessId: string;
  let outletId: string;
  let deviceId: string;
  let otherBusinessId: string;
  let otherDeviceId: string;

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
      .values({ businessId, brandId: brand!.id, code: "DP1", name: `${PREFIX}_outlet` })
      .returning({ id: outlets.id });
    outletId = outlet!.id;

    const [device] = await db
      .insert(devices)
      .values({ businessId, outletId, serialNumber: "DPDEV1", name: "Kasir Uji Pairing" })
      .returning({ id: devices.id });
    deviceId = device!.id;

    const [otherBusiness] = await db
      .insert(businesses)
      .values({ name: `${PREFIX}_other_business` })
      .returning({ id: businesses.id });
    otherBusinessId = otherBusiness!.id;

    const [otherBrand] = await db
      .insert(brands)
      .values({ businessId: otherBusinessId, name: `${PREFIX}_other_brand` })
      .returning({ id: brands.id });

    const [otherOutlet] = await db
      .insert(outlets)
      .values({
        businessId: otherBusinessId,
        brandId: otherBrand!.id,
        code: "DP2",
        name: `${PREFIX}_other_outlet`,
      })
      .returning({ id: outlets.id });

    const [otherDevice] = await db
      .insert(devices)
      .values({
        businessId: otherBusinessId,
        outletId: otherOutlet!.id,
        serialNumber: "DPDEV2",
        name: "Kasir Uji Pairing Lain",
      })
      .returning({ id: devices.id });
    otherDeviceId = otherDevice!.id;
  });

  afterAll(async () => {
    // shifts.device_id/outlet_id/employee_id TIDAK cascade dari businesses
    // (NO ACTION) -- hapus dulu, sisanya cascade.
    if (businessId) {
      await db.delete(shifts).where(eq(shifts.businessId, businessId));
      await db.delete(businesses).where(eq(businesses.id, businessId));
    }
    if (otherBusinessId) {
      await db.delete(businesses).where(eq(businesses.id, otherBusinessId));
    }
  });

  it("data uji benar-benar terbentuk sebelum diuji (bukan hijau karena kosong)", () => {
    expect(businessId).toBeTruthy();
    expect(deviceId).toBeTruthy();
    expect(otherDeviceId).toBeTruthy();
  });

  it("device milik bisnis lain DITOLAK dengan pesan jelas", async () => {
    const result = await pairDeviceWithDb(db, businessId, otherDeviceId);
    expect(result.error).toBeTruthy();
    expect(result.success).toBeUndefined();
  });

  it("device valid TANPA shift terbuka: berhasil, TANPA peringatan, last_paired_at terisi", async () => {
    const result = await pairDeviceWithDb(db, businessId, deviceId);
    expect(result.success).toBeTruthy();
    expect(result.success!.warning).toBeUndefined();
    expect(result.success!.outlet.id).toBe(outletId);
    expect(result.success!.device.id).toBe(deviceId);

    const [row] = await db.select().from(devices).where(eq(devices.id, deviceId));
    expect(row?.lastPairedAt).toBeTruthy();
  });

  it("device yang SEDANG punya shift terbuka: berhasil TAPI dengan peringatan (tidak diblokir)", async () => {
    const pinHash = await hashPin("222222");
    await db.insert(employees).values({
      businessId,
      outletId,
      code: "DPEMP",
      fullName: `${PREFIX}_DPEMP`,
      role: "cashier",
      pinHash,
    });
    const openResult = await openShiftWithDb(db, businessId, {
      id: generateId(),
      outletId,
      deviceId,
      employeeCode: "DPEMP",
      pin: "222222",
      openingCash: "0",
    });
    expect(openResult.success).toBeTruthy();

    const result = await pairDeviceWithDb(db, businessId, deviceId);
    expect(result.success).toBeTruthy();
    expect(result.success!.warning).toBeTruthy();
    expect(result.success!.warning).toContain(`${PREFIX}_DPEMP`);
    expect(result.success!.warning).toMatch(/shift terbuka/i);
  });
});
