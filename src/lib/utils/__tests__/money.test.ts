/**
 * T02 — Test untuk src/lib/utils/money.ts.
 * roundTo() mengikuti definisi CALC-SPEC A.2 (Math.round/.ceil/.floor semantics),
 * termasuk TC-16 dan TC-17. `step` bertipe number (satuan konfigurasi, bukan uang).
 * formatIDR() diuji sesuai format yang dikonfirmasi: "Rp 150.000" (tanpa desimal).
 * parseMoneyID()/parseMoneyISO() dipisah eksplisit per format, tanpa auto-detect.
 */
import { describe, it, expect } from "vitest";
import { Decimal, roundTo, formatIDR, parseMoneyID, parseMoneyISO } from "../money";

describe("roundTo", () => {
  it("mode 'nearest' — TC-16: rounding negatif", () => {
    const result = roundTo(new Decimal("99849"), 100, "nearest");
    expect(result.toString()).toBe("99800");
    expect(result.minus("99849").toString()).toBe("-49");
  });

  it("mode 'up' — TC-17: rounding selalu positif", () => {
    const result = roundTo(new Decimal("99201"), 100, "up");
    expect(result.toString()).toBe("99300");
    expect(result.minus("99201").toString()).toBe("99");
  });

  it("mode 'nearest' — TC-01: totalBeforeRounding 99.792 -> 99.800", () => {
    const result = roundTo(new Decimal("99792"), 100, "nearest");
    expect(result.toString()).toBe("99800");
  });

  it("mode 'down' — selalu membulatkan ke bawah, rounding <= 0", () => {
    const result = roundTo(new Decimal("1560"), 100, "down");
    expect(result.toString()).toBe("1500");
    expect(result.minus("1560").toString()).toBe("-60");
  });

  it("mode 'up' — nilai yang sudah kelipatan tidak berubah", () => {
    const result = roundTo(new Decimal("1500"), 100, "up");
    expect(result.toString()).toBe("1500");
  });

  it("mode 'nearest' — tie (persis di tengah) membulatkan ke atas, rentang (-step/2, step/2]", () => {
    const tieUp = roundTo(new Decimal("50"), 100, "nearest");
    expect(tieUp.toString()).toBe("100");
    expect(tieUp.minus("50").toString()).toBe("50"); // batas atas tercapai (closed)

    const tieDown = roundTo(new Decimal("-50"), 100, "nearest");
    expect(tieDown.toString()).toBe("0");
    expect(tieDown.minus("-50").toString()).toBe("50"); // tetap tidak pernah -50 (batas bawah terbuka)
  });

  it("melempar error kalau step nol", () => {
    expect(() => roundTo(new Decimal("100"), 0, "nearest")).toThrow();
  });
});

describe("formatIDR", () => {
  it("memformat nilai positif dengan pemisah ribuan titik, tanpa desimal", () => {
    expect(formatIDR(new Decimal("150000"))).toBe("Rp 150.000");
    expect(formatIDR(new Decimal("99800"))).toBe("Rp 99.800");
    expect(formatIDR(new Decimal("1000000"))).toBe("Rp 1.000.000");
  });

  it("membulatkan desimal ke rupiah penuh (HALF_UP)", () => {
    expect(formatIDR(new Decimal("1500.5"))).toBe("Rp 1.501");
    expect(formatIDR(new Decimal("1500.4"))).toBe("Rp 1.500");
  });

  it("memformat nol", () => {
    expect(formatIDR(new Decimal("0"))).toBe("Rp 0");
  });

  it("memformat nilai negatif", () => {
    expect(formatIDR(new Decimal("-15000"))).toBe("-Rp 15.000");
  });
});

describe("parseMoneyID — notasi Indonesia (titik ribuan, koma desimal)", () => {
  it("mengurai angka dengan koma desimal", () => {
    expect(parseMoneyID("18,5").toString()).toBe("18.5");
    expect(parseMoneyID("7.858,30").toString()).toBe("7858.3");
    expect(parseMoneyID("150.000,50").toString()).toBe("150000.5");
  });

  it("mengurai angka ribuan tanpa desimal", () => {
    expect(parseMoneyID("150.000").toString()).toBe("150000");
    expect(parseMoneyID("1.234.567").toString()).toBe("1234567");
  });

  it("mengurai angka tanpa pemisah ribuan", () => {
    expect(parseMoneyID("15000").toString()).toBe("15000");
  });

  it("mendukung tanda minus", () => {
    expect(parseMoneyID("-15000").toString()).toBe("-15000");
    expect(parseMoneyID("-1.500,50").toString()).toBe("-1500.5");
  });

  it("melempar error untuk input yang tidak valid", () => {
    expect(() => parseMoneyID("")).toThrow();
    expect(() => parseMoneyID("abc")).toThrow();
    expect(() => parseMoneyID("12.34.56,78,90")).toThrow(); // lebih dari satu koma
  });
});

describe("parseMoneyISO — notasi internasional/wire format (titik desimal)", () => {
  it("mengurai angka desimal polos", () => {
    expect(parseMoneyISO("150000").toString()).toBe("150000");
    expect(parseMoneyISO("150000.5").toString()).toBe("150000.5");
    expect(parseMoneyISO("150000.50").toString()).toBe("150000.5");
    expect(parseMoneyISO("18.5").toString()).toBe("18.5");
  });

  it("mendukung tanda minus/plus", () => {
    expect(parseMoneyISO("-15000").toString()).toBe("-15000");
    expect(parseMoneyISO("-1500.5").toString()).toBe("-1500.5");
    expect(parseMoneyISO("+15000").toString()).toBe("15000");
  });

  it("melempar error untuk notasi Indonesia atau input tidak valid", () => {
    expect(() => parseMoneyISO("150.000,50")).toThrow(); // koma tidak diterima
    expect(() => parseMoneyISO("1.234.567")).toThrow(); // lebih dari satu titik
    expect(() => parseMoneyISO("")).toThrow();
    expect(() => parseMoneyISO("abc")).toThrow();
  });
});
