/**
 * T02 — Test businessDate() berdasarkan CALC-SPEC bagian F, TC-15.
 * Semua kasus dibuat dari instant UTC eksplisit + parameter timezone eksplisit,
 * supaya hasilnya tidak bergantung pada timezone lokal proses (mesin dev ini
 * berjalan di Asia/Bangkok, bukan UTC — lihat catatan di CALC-SPEC).
 */
import { describe, it, expect } from "vitest";
import { businessDate } from "../business-date";

describe("businessDate — TC-15 (cutoff 04:00, tz Asia/Jakarta / WIB)", () => {
  const tz = "Asia/Jakarta";
  const cutoff = "04:00";

  it("01:30 WIB (sebelum cutoff) -> business date hari sebelumnya", () => {
    // 2026-08-12 01:30 WIB = 2026-08-11 18:30 UTC
    const createdAt = new Date("2026-08-11T18:30:00Z");
    expect(businessDate(createdAt, tz, cutoff)).toBe("2026-08-11");
  });

  it("03:59 WIB (tepat sebelum cutoff) -> business date hari sebelumnya", () => {
    // 2026-08-12 03:59 WIB = 2026-08-11 20:59 UTC
    const createdAt = new Date("2026-08-11T20:59:00Z");
    expect(businessDate(createdAt, tz, cutoff)).toBe("2026-08-11");
  });

  it("04:00 WIB (tepat di cutoff) -> business date hari ini", () => {
    // 2026-08-12 04:00 WIB = 2026-08-11 21:00 UTC
    const createdAt = new Date("2026-08-11T21:00:00Z");
    expect(businessDate(createdAt, tz, cutoff)).toBe("2026-08-12");
  });

  it("23:00 WIB (jauh setelah cutoff) -> business date hari ini", () => {
    // 2026-08-12 23:00 WIB = 2026-08-12 16:00 UTC
    const createdAt = new Date("2026-08-12T16:00:00Z");
    expect(businessDate(createdAt, tz, cutoff)).toBe("2026-08-12");
  });
});

describe("businessDate — outlet zona WITA (Asia/Makassar, UTC+8), proses berjalan di UTC", () => {
  const tz = "Asia/Makassar";
  const cutoff = "04:00";

  it("02:00 WITA (sebelum cutoff) -> business date hari sebelumnya", () => {
    // 2026-08-12 02:00 WITA = 2026-08-11 18:00 UTC
    const createdAt = new Date("2026-08-11T18:00:00Z");
    expect(businessDate(createdAt, tz, cutoff)).toBe("2026-08-11");
  });

  it("04:00 WITA (tepat di cutoff) -> business date hari ini", () => {
    // 2026-08-12 04:00 WITA = 2026-08-11 20:00 UTC
    const createdAt = new Date("2026-08-11T20:00:00Z");
    expect(businessDate(createdAt, tz, cutoff)).toBe("2026-08-12");
  });

  it("WIB dan WITA menghasilkan business date berbeda untuk instant UTC yang sama dekat batas hari", () => {
    // 2026-08-12 03:30 WIB (UTC+7) = 2026-08-12 04:30 WITA (UTC+8) = 2026-08-11 20:30 UTC
    const createdAt = new Date("2026-08-11T20:30:00Z");
    expect(businessDate(createdAt, "Asia/Jakarta", cutoff)).toBe("2026-08-11"); // 03:30 WIB, sebelum cutoff
    expect(businessDate(createdAt, "Asia/Makassar", cutoff)).toBe("2026-08-12"); // 04:30 WITA, setelah cutoff
  });
});

describe("businessDate — cutoff kustom dengan detik", () => {
  it("mendukung format HH:mm:ss", () => {
    const tz = "Asia/Jakarta";
    // 2026-08-12 04:00:30 WIB = 2026-08-11 21:00:30 UTC
    const beforeCutoff = new Date("2026-08-11T21:00:00Z"); // 04:00:00 WIB
    const afterCutoff = new Date("2026-08-11T21:00:30Z"); // 04:00:30 WIB
    expect(businessDate(beforeCutoff, tz, "04:00:15")).toBe("2026-08-11");
    expect(businessDate(afterCutoff, tz, "04:00:15")).toBe("2026-08-12");
  });
});

describe("businessDate — format dayCutoffTime tidak valid", () => {
  it("melempar error kalau dayCutoffTime tidak sesuai format HH:mm[:ss]", () => {
    const createdAt = new Date("2026-08-11T18:30:00Z");
    expect(() => businessDate(createdAt, "Asia/Jakarta", "4:00")).toThrow();
    expect(() => businessDate(createdAt, "Asia/Jakarta", "invalid")).toThrow();
  });
});
