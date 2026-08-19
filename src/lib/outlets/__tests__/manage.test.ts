/**
 * T22b — Test integrasi CRUD outlet. Butuh koneksi Supabase sungguhan
 * (DATABASE_URL + NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY),
 * sama seperti src/lib/employees/__tests__/manage.test.ts -- di-skip
 * otomatis kalau env belum diisi, bukan hijau palsu.
 *
 * getAdminDb() dipakai di sini SENGAJA melewati RLS -- ini test, bukan
 * kode aplikasi, dan fixture-nya bikin business/employee/device dari nol
 * yang butuh akses penuh untuk setup + assert langsung ke DB.
 *
 * Data uji diberi prefix TEST_OUTLETS_ dan dibersihkan di afterAll.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
import { eq } from "drizzle-orm";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { getAdminDb } from "@/lib/db/client";
import { brands, businesses, devices, employees, outlets, shifts } from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";
import { hashPin } from "@/lib/auth/pin";
import { openShiftWithDb } from "@/lib/pos/shift";
import { createOutletWithDb, updateOutletWithDb } from "../manage";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

describe.skipIf(!hasEnv)("T22b — CRUD outlet", () => {
  const db = getAdminDb();
  const PREFIX = `TEST_OUTLETS_${Date.now()}`;

  let businessId: string;
  let brandId: string;
  let otherBusinessId: string;
  let otherBrandId: string;

  function validOutletInput(code: string) {
    return {
      code,
      brandId,
      name: `Outlet ${code}`,
      address: "Jl. Uji No. 1",
      phone: "0812000000",
      dayCutoffTime: "04:00:00",
      isCentralKitchen: false,
      taxPercent: 10,
      taxInclusive: false,
      serviceChargePercent: 5,
      serviceChargeInTaxBase: true,
      roundingTo: 100,
      cashVarianceTolerance: "20000",
      cashEnabled: true,
      varianceAlertPercent: 3,
      varianceAlertValue: "100000",
    };
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
    brandId = brand!.id;

    const [otherBusiness] = await db
      .insert(businesses)
      .values({ name: `${PREFIX}_other_business` })
      .returning({ id: businesses.id });
    otherBusinessId = otherBusiness!.id;

    const [otherBrand] = await db
      .insert(brands)
      .values({ businessId: otherBusinessId, name: `${PREFIX}_other_brand` })
      .returning({ id: brands.id });
    otherBrandId = otherBrand!.id;
  });

  afterAll(async () => {
    // shifts.employee_id/outlet_id TIDAK cascade dari businesses (NO
    // ACTION) -- hapus dulu, sisanya (outlets/employees/devices/brands) cascade.
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
  });

  it("kode duplikat di bisnis sama ditolak dengan pesan jelas", async () => {
    const first = await createOutletWithDb(db, businessId, validOutletInput("DUPOUT"));
    expect(first.success).toBeTruthy();

    const second = await createOutletWithDb(db, businessId, validOutletInput("DUPOUT"));
    expect(second.error).toBeTruthy();
    expect(second.success).toBeUndefined();
  });

  it("brand milik bisnis lain DITOLAK dengan pesan jelas (T22a)", async () => {
    const result = await createOutletWithDb(db, businessId, {
      ...validOutletInput("XBRANDOUT"),
      brandId: otherBrandId,
    });
    expect(result.error).toBeTruthy();
    expect(result.success).toBeUndefined();
  });

  it("update field (nama, pajak, service charge, dll) berhasil, code tidak berubah", async () => {
    const created = await createOutletWithDb(db, businessId, validOutletInput("UPDOUT"));
    expect(created.success).toBeTruthy();
    const outletId = created.success!.outletId;

    const result = await updateOutletWithDb(db, businessId, {
      id: outletId,
      ...validOutletInput("IGNORED_CODE"),
      name: "Nama Baru",
      taxPercent: 11,
      serviceChargePercent: 7.5,
      isActive: true,
    });
    expect(result.success).toBeTruthy();

    const [row] = await db.select().from(outlets).where(eq(outlets.id, outletId));
    expect(row?.name).toBe("Nama Baru");
    expect(row?.code).toBe("UPDOUT"); // tidak berubah walau dikirim di payload
    expect(row?.taxPercent).toBe("11.0000");
    expect(row?.serviceChargePercent).toBe("7.5000");
  });

  it("nonaktifkan outlet yang PUNYA shift terbuka DITOLAK di server", async () => {
    const created = await createOutletWithDb(db, businessId, validOutletInput("OPENSHIFTOUT"));
    const outletId = created.success!.outletId;

    const pinHash = await hashPin("111111");
    await db.insert(employees).values({
      businessId,
      outletId,
      code: "OSEMP",
      fullName: `${PREFIX}_OSEMP`,
      role: "cashier",
      pinHash,
    });
    const [device] = await db
      .insert(devices)
      .values({ businessId, outletId, serialNumber: "OSDEV1", name: "Kasir Uji Outlet" })
      .returning({ id: devices.id });

    const openResult = await openShiftWithDb(db, businessId, {
      id: generateId(),
      outletId,
      deviceId: device!.id,
      employeeCode: "OSEMP",
      pin: "111111",
      openingCash: "0",
    });
    expect(openResult.success).toBeTruthy();

    const result = await updateOutletWithDb(db, businessId, {
      id: outletId,
      ...validOutletInput("IGNORED_CODE"),
      isActive: false,
    });
    expect(result.error).toBeTruthy();

    const [row] = await db.select().from(outlets).where(eq(outlets.id, outletId));
    expect(row?.isActive).toBe(true); // tidak berubah
  });

  it("nonaktifkan outlet TANPA shift terbuka berhasil", async () => {
    const created = await createOutletWithDb(db, businessId, validOutletInput("NOSHIFTOUT"));
    const outletId = created.success!.outletId;

    const result = await updateOutletWithDb(db, businessId, {
      id: outletId,
      ...validOutletInput("IGNORED_CODE"),
      isActive: false,
    });
    expect(result.success).toBeTruthy();

    const [row] = await db.select().from(outlets).where(eq(outlets.id, outletId));
    expect(row?.isActive).toBe(false);
  });
});
