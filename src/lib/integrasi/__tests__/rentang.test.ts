import { describe, expect, it } from "vitest";
import { keRupiahBulat, RENTANG_MAKS_HARI, tentukanRentang } from "../omzet-harian";

describe("tentukanRentang", () => {
  it("bawaan: 7 hari ke belakang sampai hari ini kalender", () => {
    expect(tentukanRentang(null, undefined, "2026-09-19")).toEqual({ ok: true, dari: "2026-09-12", sampai: "2026-09-19" });
  });

  it("menerima rentang eksplisit, termasuk tepat di batas maksimal", () => {
    expect(tentukanRentang("2026-09-01", "2026-09-15", "2026-09-19")).toEqual({ ok: true, dari: "2026-09-01", sampai: "2026-09-15" });
    expect(RENTANG_MAKS_HARI).toBe(14);
  });

  it("menolak rentang lebih dari 14 hari", () => {
    const r = tentukanRentang("2026-09-01", "2026-09-16", "2026-09-19");
    expect(r.ok).toBe(false);
  });

  it("menolak dari > sampai", () => {
    expect(tentukanRentang("2026-09-10", "2026-09-09", "2026-09-19").ok).toBe(false);
  });

  it("menolak format buruk dan tanggal yang tidak ada di kalender", () => {
    for (const buruk of ["2026-9-1", "19-09-2026", "2026-02-30", "2026-13-01", "abc", "2026-09-19T00:00:00Z"]) {
      expect(tentukanRentang(buruk, "2026-09-19", "2026-09-19").ok).toBe(false);
      expect(tentukanRentang("2026-09-01", buruk, "2026-09-19").ok).toBe(false);
    }
  });

  it("hanya 'dari' diisi: 'sampai' jatuh ke hari ini kalender dan tetap dicek batasnya", () => {
    expect(tentukanRentang("2026-09-15", null, "2026-09-19")).toEqual({ ok: true, dari: "2026-09-15", sampai: "2026-09-19" });
    expect(tentukanRentang("2026-08-01", null, "2026-09-19").ok).toBe(false);
  });
});

describe("keRupiahBulat", () => {
  it("membulatkan half-up sekali di akhir", () => {
    expect(keRupiahBulat("100.49")).toBe(100);
    expect(keRupiahBulat("100.50")).toBe(101);
    expect(keRupiahBulat("0.5")).toBe(1);
    expect(keRupiahBulat("1234567.00")).toBe(1234567);
  });

  it("nol tidak pernah menjadi -0", () => {
    expect(Object.is(keRupiahBulat("-0.4"), -0)).toBe(false);
    expect(keRupiahBulat("-0.4")).toBe(0);
  });

  it("melempar kalau melebihi bilangan bulat aman", () => {
    expect(() => keRupiahBulat("9007199254740993")).toThrow();
  });
});
