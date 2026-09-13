/**
 * Pembatasan akses per outlet -- Tahap 3 (13 September 2026, §24): halaman
 * PERTAMA yang dipasangi filter, Dashboard (`app/(dashboard)/page.tsx`).
 * File ini menguji getOpenShiftsForBusiness()/getShiftsNeedingReview() --
 * dua dari tiga fungsi yang dashboard pakai (yang ketiga, getSalesByBrand,
 * dites di lib/db/queries/__tests__/sales-by-brand-outlet-scope.test.ts).
 *
 * TIGA TES WAJIB per halaman (keputusan CEO eksplisit):
 * 1. scope null (owner/akuntan): shift KEDUA outlet muncul.
 * 2. scope satu outlet (manajer dibatasi): CUMA shift outlet itu muncul,
 *    shift outlet lain TIDAK ADA di hasil sama sekali.
 * 3. scope array KOSONG: NOL baris, bukan semua baris -- kasus yang
 *    paling sering dilewatkan menurut CEO.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { eq } from "drizzle-orm";
import { getAdminDb } from "@/lib/db/client";
import { brands, businesses, devices, employees, outlets, shifts } from "@/lib/db/schema";
import { hashPin } from "@/lib/auth/pin";
import { generateId } from "@/lib/utils/id";
import { getOpenShiftsForBusiness, getShiftsNeedingReview, openShiftWithDb } from "../shift";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

describe.skipIf(!hasEnv)(
  "Pembatasan akses per outlet, Tahap 3 -- getOpenShiftsForBusiness/getShiftsNeedingReview (Dashboard)",
  () => {
    const db = getAdminDb();
    const PREFIX = `TEST_SHIFTSCOPE_${Date.now()}`;

    let businessId: string;
    let brandId: string;
    let outletAId: string;
    let outletBId: string;
    let shiftAId: string;
    let shiftBId: string;

    async function setupOpenShift(code: string, employeeCode: string, pin: string) {
      const [outlet] = await db
        .insert(outlets)
        .values({ businessId, brandId, code, name: `${PREFIX}_${code}` })
        .returning({ id: outlets.id });
      const outletId = outlet!.id;

      const [device] = await db
        .insert(devices)
        .values({ businessId, outletId, serialNumber: `${code}-DEV1`, name: `Kasir ${code}` })
        .returning({ id: devices.id });

      const pinHash = await hashPin(pin);
      await db.insert(employees).values({
        businessId,
        outletId,
        code: employeeCode,
        fullName: `${PREFIX}_${employeeCode}`,
        role: "cashier",
        pinHash,
      });

      const shiftId = generateId();
      const openResult = await openShiftWithDb(db, businessId, {
        id: shiftId,
        outletId,
        deviceId: device!.id,
        employeeCode,
        pin,
        openingCash: "0",
      });
      expect(openResult.success).toBeTruthy();

      return { outletId, shiftId };
    }

    beforeAll(async () => {
      const [business] = await db.insert(businesses).values({ name: `${PREFIX}_business` }).returning({ id: businesses.id });
      businessId = business!.id;

      const [brand] = await db.insert(brands).values({ businessId, name: `${PREFIX}_brand` }).returning({ id: brands.id });
      brandId = brand!.id;

      const a = await setupOpenShift("SSA", "SSAKASIR", "111111");
      const b = await setupOpenShift("SSB", "SSBKASIR", "222222");
      outletAId = a.outletId;
      outletBId = b.outletId;
      shiftAId = a.shiftId;
      shiftBId = b.shiftId;

      // Shift B dipaksa BASI (businessDate kemarin) supaya juga muncul di
      // getShiftsNeedingReview -- kalau cuma shift "sehat" yang dites,
      // filter outlet pada fungsi review bisa saja lolos padahal salah.
      await db
        .update(shifts)
        .set({ businessDate: "2020-01-01" })
        .where(eq(shifts.id, shiftBId));
    });

    afterAll(async () => {
      if (businessId) {
        await db.delete(shifts).where(eq(shifts.businessId, businessId));
        await db.delete(businesses).where(eq(businesses.id, businessId));
      }
    });

    it("data uji terbentuk (dua outlet, masing-masing punya shift terbuka)", () => {
      expect(outletAId).toBeTruthy();
      expect(outletBId).toBeTruthy();
    });

    describe("getOpenShiftsForBusiness", () => {
      it("scope null: KEDUA shift muncul", async () => {
        const rows = await getOpenShiftsForBusiness(db, businessId, null);
        expect(rows.map((r) => r.id).sort()).toEqual([shiftAId, shiftBId].sort());
      });

      it("scope [outletA]: CUMA shift outlet A muncul, shift outlet B tidak ada jejaknya", async () => {
        const rows = await getOpenShiftsForBusiness(db, businessId, [outletAId]);
        expect(rows.map((r) => r.id)).toEqual([shiftAId]);
      });

      it("scope array KOSONG: NOL shift, bukan semua shift", async () => {
        const rows = await getOpenShiftsForBusiness(db, businessId, []);
        expect(rows).toHaveLength(0);
      });
    });

    describe("getShiftsNeedingReview", () => {
      it("scope null: shift BASI outlet B muncul", async () => {
        const rows = await getShiftsNeedingReview(db, businessId, "Asia/Jakarta", null);
        expect(rows.find((r) => r.id === shiftBId)?.reviewReason).toBe("stale");
      });

      it("scope [outletA]: shift basi outlet B TIDAK muncul (di luar cakupan), walau memenuhi kriteria basi", async () => {
        const rows = await getShiftsNeedingReview(db, businessId, "Asia/Jakarta", [outletAId]);
        expect(rows.find((r) => r.id === shiftBId)).toBeUndefined();
      });

      it("scope array KOSONG: NOL baris, walau ada shift basi yang seharusnya masuk daftar", async () => {
        const rows = await getShiftsNeedingReview(db, businessId, "Asia/Jakarta", []);
        expect(rows).toHaveLength(0);
      });
    });
  }
);
