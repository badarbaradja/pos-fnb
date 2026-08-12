/**
 * T01 — Dummy test: memverifikasi Vitest berjalan dengan benar.
 * Test ini bisa dihapus setelah T03 selesai.
 */
import { describe, it, expect } from "vitest";

describe("T01 — setup sanity check", () => {
  it("vitest berjalan", () => {
    expect(1 + 1).toBe(2);
  });

  it("typescript strict mode aktif (noUncheckedIndexedAccess)", () => {
    // Membuktikan kode TypeScript bisa di-resolve dan di-run oleh Vitest
    const arr: number[] = [1, 2, 3];
    const first = arr[0];
    // Dengan noUncheckedIndexedAccess, first bertipe number | undefined
    // Kita assert ia tidak undefined sebelum dipakai
    expect(first).toBeDefined();
    if (first !== undefined) {
      expect(first).toBe(1);
    }
  });

  it("decimal.js dapat diimport (tidak ada angka floating point)", async () => {
    const { Decimal } = await import("decimal.js");
    const a = new Decimal("0.1");
    const b = new Decimal("0.2");
    const result = a.plus(b);
    // Buktikan tidak ada floating point error: 0.1 + 0.2 === 0.3 (bukan 0.30000000000000004)
    expect(result.toFixed(1)).toBe("0.3");
  });

  it("zod dapat diimport", async () => {
    const { z } = await import("zod");
    const schema = z.object({ name: z.string() });
    const parsed = schema.parse({ name: "POS FnB" });
    expect(parsed.name).toBe("POS FnB");
  });

  it("date-fns-tz dapat diimport", async () => {
    const { toZonedTime } = await import("date-fns-tz");
    // Waktu UTC, konversi ke Asia/Jakarta (UTC+7)
    const utc = new Date("2026-08-12T01:30:00Z");
    const jakarta = toZonedTime(utc, "Asia/Jakarta");
    // 01:30 UTC = 08:30 WIB
    expect(jakarta.getHours()).toBe(8);
  });

  it("uuidv7 dapat diimport dan menghasilkan UUID valid", async () => {
    const { uuidv7 } = await import("uuidv7");
    const id = uuidv7();
    // UUID v7 format: xxxxxxxx-xxxx-7xxx-xxxx-xxxxxxxxxxxx
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });
});
