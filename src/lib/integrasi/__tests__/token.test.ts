import { describe, expect, it } from "vitest";
import { bacaKonfigurasiIntegrasi, TOKEN_MIN_PANJANG, tokenIntegrasiValid } from "../token";

const TOKEN = "t".repeat(TOKEN_MIN_PANJANG) + "-rahasia";
const BUSINESS_ID = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

describe("tokenIntegrasiValid", () => {
  it("menerima token yang benar", async () => {
    expect(await tokenIntegrasiValid(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
  });

  it("menolak token salah (beda satu karakter di akhir)", async () => {
    expect(await tokenIntegrasiValid(`Bearer ${TOKEN.slice(0, -1)}x`, TOKEN)).toBe(false);
  });

  it("menolak token yang hanya awalan atau yang lebih panjang", async () => {
    expect(await tokenIntegrasiValid(`Bearer ${TOKEN.slice(0, 10)}`, TOKEN)).toBe(false);
    expect(await tokenIntegrasiValid(`Bearer ${TOKEN}x`, TOKEN)).toBe(false);
  });

  it("menolak header kosong, tanpa skema Bearer, atau skema lain", async () => {
    expect(await tokenIntegrasiValid(null, TOKEN)).toBe(false);
    expect(await tokenIntegrasiValid("", TOKEN)).toBe(false);
    expect(await tokenIntegrasiValid(TOKEN, TOKEN)).toBe(false);
    expect(await tokenIntegrasiValid(`Basic ${TOKEN}`, TOKEN)).toBe(false);
    expect(await tokenIntegrasiValid("Bearer ", TOKEN)).toBe(false);
  });

  it("menolak SEMUA permintaan kalau token seharusnya kosong atau terlalu pendek", async () => {
    expect(await tokenIntegrasiValid("Bearer abc", "abc")).toBe(false);
    expect(await tokenIntegrasiValid("Bearer ", "")).toBe(false);
    expect(await tokenIntegrasiValid(`Bearer ${TOKEN}`, undefined)).toBe(false);
  });
});

describe("bacaKonfigurasiIntegrasi", () => {
  it("valid kalau token cukup panjang dan business id UUID", () => {
    expect(bacaKonfigurasiIntegrasi({ INTEGRASI_LAPORAN_TOKEN: TOKEN, INTEGRASI_BUSINESS_ID: BUSINESS_ID })).toEqual({
      token: TOKEN,
      businessId: BUSINESS_ID,
    });
  });

  it("null kalau salah satu hilang, token pendek, atau business id bukan UUID", () => {
    expect(bacaKonfigurasiIntegrasi({ INTEGRASI_BUSINESS_ID: BUSINESS_ID })).toBeNull();
    expect(bacaKonfigurasiIntegrasi({ INTEGRASI_LAPORAN_TOKEN: TOKEN })).toBeNull();
    expect(bacaKonfigurasiIntegrasi({ INTEGRASI_LAPORAN_TOKEN: "pendek", INTEGRASI_BUSINESS_ID: BUSINESS_ID })).toBeNull();
    expect(bacaKonfigurasiIntegrasi({ INTEGRASI_LAPORAN_TOKEN: TOKEN, INTEGRASI_BUSINESS_ID: "bukan-uuid" })).toBeNull();
  });
});
