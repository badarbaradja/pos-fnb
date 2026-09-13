/**
 * Pembatasan akses per outlet -- Tahap 4 (13 September 2026, §27):
 * addBarangFromShiftWithDb -- ditemukan PROAKTIF (bukan diminta CEO)
 * saat memperbaiki saveBarangWithDb. Identitas di jalur ini BUKAN
 * membership Supabase Auth (gerbangnya role EMPLOYEE shift, lihat
 * komentar lib/pos/pos-add-barang.ts) -- skop yang benar adalah outlet
 * SHIFT INI, bukan allowedOutletIds dashboard. Dibuktikan: kasir yang
 * shift-nya di Outlet A TIDAK BISA menambah barang ke Outlet B walau
 * outletId Outlet B dikirim langsung di body request (rawInput, bukan
 * dari UI) -- celah nyata SEBELUM baris [shift.outletId] dipasang.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { eq } from "drizzle-orm";
import { getAdminDb } from "@/lib/db/client";
import { barang, brands, businesses, devices, employees, outlets, shifts } from "@/lib/db/schema";
import { hashPin } from "@/lib/auth/pin";
import { generateId } from "@/lib/utils/id";
import { openShiftWithDb } from "../shift";
import { addBarangFromShiftWithDb } from "../pos-add-barang";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

describe.skipIf(!hasEnv)("Pembatasan akses per outlet, Tahap 4 -- addBarangFromShiftWithDb", () => {
  const db = getAdminDb();
  const PREFIX = `TEST_POSADDBARANG_${Date.now()}`;

  let businessId: string;
  let outletAId: string;
  let outletBId: string;
  let managerShiftId: string;

  beforeAll(async () => {
    const [business] = await db.insert(businesses).values({ name: `${PREFIX}_business` }).returning({ id: businesses.id });
    businessId = business!.id;
    const [brand] = await db.insert(brands).values({ businessId, name: `${PREFIX}_brand` }).returning({ id: brands.id });

    const [oA] = await db
      .insert(outlets)
      .values({ businessId, brandId: brand!.id, code: "PABA", name: "Pos Add Barang A" })
      .returning({ id: outlets.id });
    const [oB] = await db
      .insert(outlets)
      .values({ businessId, brandId: brand!.id, code: "PABB", name: "Pos Add Barang B" })
      .returning({ id: outlets.id });
    outletAId = oA!.id;
    outletBId = oB!.id;

    const [device] = await db
      .insert(devices)
      .values({ businessId, outletId: outletAId, serialNumber: "PABA-DEV1", name: "Kasir A" })
      .returning({ id: devices.id });

    const pinHash = await hashPin("445566");
    await db.insert(employees).values({
      businessId,
      outletId: outletAId,
      code: "PABMANAGER",
      fullName: `${PREFIX}_manager`,
      role: "manager",
      pinHash,
    });

    const opened = await openShiftWithDb(db, businessId, {
      id: generateId(),
      outletId: outletAId,
      deviceId: device!.id,
      employeeCode: "PABMANAGER",
      pin: "445566",
      openingCash: "0",
    });
    expect(opened.success).toBeTruthy();
    managerShiftId = opened.success!.shiftId;
  });

  afterAll(async () => {
    // shifts.business_id TIDAK cascade dari businesses (NO ACTION) --
    // hapus dulu sebelum businesses.
    if (businessId) {
      await db.delete(shifts).where(eq(shifts.businessId, businessId));
      await db.delete(businesses).where(eq(businesses.id, businessId));
    }
  });

  it("data uji terbentuk (shift manager terbuka di outlet A)", () => {
    expect(managerShiftId).toBeTruthy();
  });

  it("outletId di rawInput SAMA dengan outlet shift -- berhasil", async () => {
    const result = await addBarangFromShiftWithDb(db, businessId, managerShiftId, {
      outletId: outletAId,
      nama: "Barang dari Kasir",
      hargaJual: "50000",
    });
    expect(result.success).toBeTruthy();

    const [row] = await db.select().from(barang).where(eq(barang.id, result.success!.barangId));
    expect(row?.outletId).toBe(outletAId);
    expect(row?.status).toBe("siap_jual"); // langsung siap jual, bukan baru_masuk
  });

  it("outletId di rawInput outlet LAIN (bukan outlet shift ini) -- DITOLAK, TIDAK ADA barang tertulis di outlet B", async () => {
    const before = await db.select({ id: barang.id }).from(barang).where(eq(barang.outletId, outletBId));

    const result = await addBarangFromShiftWithDb(db, businessId, managerShiftId, {
      outletId: outletBId,
      nama: "Barang Dipaksa ke Outlet Lain",
      hargaJual: "50000",
    });
    expect(result.error).toBeTruthy();
    expect(result.success).toBeUndefined();

    const after = await db.select({ id: barang.id }).from(barang).where(eq(barang.outletId, outletBId));
    expect(after.length).toBe(before.length);
  });
});
