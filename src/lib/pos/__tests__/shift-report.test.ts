/**
 * Rencana Revisi 24 September 2026 -- laporan Prepare/Closing, test
 * integrasi. "Test wajib" dari instruksi CEO:
 *
 *   1. Prepare belum diisi -> kasir tidak bisa transaksi
 *      (checkShiftSellability, diuji murni di shift.test.ts -- lihat
 *      "prepareCompleted=false -> 'prepare_required'").
 *   2. Kamera gagal -> boleh lanjut, alasan tersimpan, shift ditandai
 *      di layar manajer (getShiftsNeedingReview).
 *   3. Event "ya" tanpa keterangan -> ditolak.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
import { eq } from "drizzle-orm";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { brands, employees, outlets, shifts } from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";
import {
  isClosingReportComplete,
  isPrepareReportComplete,
  submitClosingReportWithDb,
  submitPrepareReportWithDb,
} from "../shift-report";
import { getShiftsNeedingReview } from "../shift";
import { createUserDbFixture, type UserDbFixture } from "@/lib/db/__tests__/helpers/user-db-fixture";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

describe("isPrepareReportComplete / isClosingReportComplete (murni, tidak butuh DB)", () => {
  it("prepare: prepareHasEvent null -> belum selesai walau foto sudah ada", () => {
    expect(
      isPrepareReportComplete({
        preparePhotoPath: "biz/shift/prepare.jpg",
        preparePhotoMissingReason: null,
        prepareHasEvent: null,
      })
    ).toBe(false);
  });

  it("prepare: prepareHasEvent terisi DAN (photoPath ATAU photoMissingReason) terisi -> selesai", () => {
    expect(
      isPrepareReportComplete({
        preparePhotoPath: null,
        preparePhotoMissingReason: "Kamera tidak bisa dibuka di perangkat ini saat membuka shift",
        prepareHasEvent: false,
      })
    ).toBe(true);
  });

  it("prepare: nol kolom terisi -> belum selesai", () => {
    expect(
      isPrepareReportComplete({ preparePhotoPath: null, preparePhotoMissingReason: null, prepareHasEvent: null })
    ).toBe(false);
  });

  it("closing: catatan kosong -> belum selesai walau foto ada", () => {
    expect(
      isClosingReportComplete({
        closingPhotoPath: "biz/shift/closing.jpg",
        closingPhotoMissingReason: null,
        closingCleanlinessNote: "   ",
      })
    ).toBe(false);
  });

  it("closing: foto DAN catatan non-kosong -> selesai", () => {
    expect(
      isClosingReportComplete({
        closingPhotoPath: "biz/shift/closing.jpg",
        closingPhotoMissingReason: null,
        closingCleanlinessNote: "Sudah dibersihkan",
      })
    ).toBe(true);
  });
});

describe.skipIf(!hasEnv)("lib/pos/shift-report — submitPrepareReportWithDb/submitClosingReportWithDb", () => {
  let fixture: UserDbFixture;
  let outletId: string;
  let employeeId: string;
  const BUSINESS_DATE = "2026-09-24";

  beforeAll(async () => {
    fixture = await createUserDbFixture("TEST_SHIFT_REPORT");
    const { db, businessId } = fixture;

    const [brand] = await db.insert(brands).values({ businessId, name: "BrandShiftReport" }).returning({ id: brands.id });
    const [outletRow] = await db
      .insert(outlets)
      .values({ businessId, brandId: brand!.id, code: "SRP", name: "Outlet Shift Report" })
      .returning({ id: outlets.id });
    outletId = outletRow!.id;

    const [emp] = await db
      .insert(employees)
      .values({ businessId, code: "SRP1", fullName: "Petugas Shift Report", role: "cashier", pinHash: null })
      .returning({ id: employees.id });
    employeeId = emp!.id;
  });

  afterAll(async () => {
    if (fixture) {
      await fixture.cleanup();
    }
  });

  async function makeOpenShift(): Promise<string> {
    const { db, businessId } = fixture;
    const [row] = await db
      .insert(shifts)
      .values({
        id: generateId(),
        businessId,
        outletId,
        employeeId,
        status: "open",
        openedAt: new Date(),
        businessDate: BUSINESS_DATE,
        openingCash: "0",
      })
      .returning({ id: shifts.id });
    return row!.id;
  }

  // ─── Test wajib: event "ya" tanpa keterangan -> ditolak ────────────────

  it("submitPrepareReportWithDb: hasEvent=true TANPA eventNote -> DITOLAK, kolom tidak berubah", async () => {
    const { db, businessId } = fixture;
    const shiftId = await makeOpenShift();

    const result = await submitPrepareReportWithDb(db, businessId, {
      shiftId,
      photo: { photoPath: "x/y/prepare.jpg" },
      hasEvent: true,
      eventNote: "",
    });
    expect(result.error).toBeTruthy();

    const [row] = await db
      .select({ prepareHasEvent: shifts.prepareHasEvent, preparePhotoPath: shifts.preparePhotoPath })
      .from(shifts)
      .where(eq(shifts.id, shiftId));
    expect(row!.prepareHasEvent).toBeNull();
    expect(row!.preparePhotoPath).toBeNull();
  });

  it("submitPrepareReportWithDb: hasEvent=true DENGAN eventNote -> berhasil", async () => {
    const { db, businessId } = fixture;
    const shiftId = await makeOpenShift();

    const result = await submitPrepareReportWithDb(db, businessId, {
      shiftId,
      photo: { photoPath: "x/y/prepare.jpg" },
      hasEvent: true,
      eventNote: "Ulang tahun anak, reservasi 20 orang",
    });
    expect(result.success).toBe(true);

    const [row] = await db
      .select({ prepareHasEvent: shifts.prepareHasEvent, prepareEventNote: shifts.prepareEventNote })
      .from(shifts)
      .where(eq(shifts.id, shiftId));
    expect(row!.prepareHasEvent).toBe(true);
    expect(row!.prepareEventNote).toBe("Ulang tahun anak, reservasi 20 orang");
  });

  it("submitPrepareReportWithDb: foto DAN alasan kamera gagal dua-duanya kosong -> DITOLAK (Zod refine)", async () => {
    const { db, businessId } = fixture;
    const shiftId = await makeOpenShift();

    const result = await submitPrepareReportWithDb(db, businessId, {
      shiftId,
      photo: {},
      hasEvent: false,
    });
    expect(result.error).toBeTruthy();
  });

  it("submitPrepareReportWithDb: foto DAN alasan kamera gagal dua-duanya terisi -> DITOLAK (Zod refine)", async () => {
    const { db, businessId } = fixture;
    const shiftId = await makeOpenShift();

    const result = await submitPrepareReportWithDb(db, businessId, {
      shiftId,
      photo: { photoPath: "x/y/prepare.jpg", photoMissingReason: "Kamera gagal" },
      hasEvent: false,
    });
    expect(result.error).toBeTruthy();
  });

  // ─── Test wajib: kamera gagal -> boleh lanjut, alasan tersimpan, shift
  // ditandai di layar manajer (getShiftsNeedingReview) ─────────────────

  it("submitPrepareReportWithDb: kamera gagal (photoMissingReason) -> berhasil, alasan tersimpan, shift ditandai 'prepare_photo_failed'", async () => {
    const { db, businessId } = fixture;
    const shiftId = await makeOpenShift();

    const autoReason = "Kamera tidak bisa dibuka di perangkat ini saat membuka shift";
    const result = await submitPrepareReportWithDb(db, businessId, {
      shiftId,
      photo: { photoMissingReason: autoReason },
      hasEvent: false,
    });
    expect(result.success).toBe(true);

    const [row] = await db
      .select({ preparePhotoPath: shifts.preparePhotoPath, preparePhotoMissingReason: shifts.preparePhotoMissingReason })
      .from(shifts)
      .where(eq(shifts.id, shiftId));
    expect(row!.preparePhotoPath).toBeNull();
    expect(row!.preparePhotoMissingReason).toBe(autoReason);

    const review = await getShiftsNeedingReview(db, businessId, "Asia/Jakarta", null);
    const flagged = review.find((r) => r.id === shiftId && r.reviewReason === "prepare_photo_failed");
    expect(flagged).toBeTruthy();
  });

  it("submitClosingReportWithDb: kamera gagal -> berhasil, shift ditandai 'closing_photo_failed'", async () => {
    const { db, businessId } = fixture;
    const shiftId = await makeOpenShift();

    const autoReason = "Kamera tidak bisa dibuka di perangkat ini saat menutup shift";
    const result = await submitClosingReportWithDb(db, businessId, {
      shiftId,
      photo: { photoMissingReason: autoReason },
      cleanlinessNote: "Lantai dan meja sudah dilap",
    });
    expect(result.success).toBe(true);

    const review = await getShiftsNeedingReview(db, businessId, "Asia/Jakarta", null);
    const flagged = review.find((r) => r.id === shiftId && r.reviewReason === "closing_photo_failed");
    expect(flagged).toBeTruthy();
  });

  it("submitClosingReportWithDb: catatan kosong -> DITOLAK", async () => {
    const { db, businessId } = fixture;
    const shiftId = await makeOpenShift();

    const result = await submitClosingReportWithDb(db, businessId, {
      shiftId,
      photo: { photoPath: "x/y/closing.jpg" },
      cleanlinessNote: "   ",
    });
    expect(result.error).toBeTruthy();
  });
});
