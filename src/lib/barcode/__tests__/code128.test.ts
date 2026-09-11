import { describe, expect, it } from "vitest";
import { decodeCode128B, encodeCode128B } from "../code128";

/**
 * Test-first sesuai CLAUDE.md §7 poin 4 (logika non-trivial, ditulis
 * sebelum dipakai UI). Dua lapis:
 * 1. Struktural -- tiap baris tabel pola 11 modul (13 untuk STOP), diawali
 *    bar, tiap "run" 1-4 modul (aturan Code128) -- menangkap salah ketik
 *    transkripsi tabel walau tidak menjamin cocok scanner fisik
 *    sungguhan (lihat catatan di code128.ts).
 * 2. Round-trip decode(encode(x)) === x untuk variasi kode barang nyata.
 */
describe("Code128 subset B — struktur tabel pola", () => {
  // Akses tabel lewat encode sebuah karakter tunggal per posisi -- tabel
  // sendiri tidak diekspor (sengaja, detail implementasi), jadi struktur
  // diverifikasi tidak langsung lewat memeriksa OUTPUT encode untuk semua
  // 95 karakter subset B satu per satu.
  it("setiap karakter ASCII 32-126 menghasilkan modul data 11 digit di posisi kedua (setelah START B 11 digit)", () => {
    for (let code = 32; code <= 126; code++) {
      const ch = String.fromCharCode(code);
      const modules = encodeCode128B(ch);
      // START(11) + data(11) + checksum(11) + STOP(13) = 46
      expect(modules).toHaveLength(46);
      const dataChunk = modules.slice(11, 22);
      expect(dataChunk).toHaveLength(11);
      expect(dataChunk).toMatch(/^[01]{11}$/);
      expect(dataChunk[0]).toBe("1"); // setiap pola Code128 diawali bar
      const runs = dataChunk.match(/1+|0+/g)!;
      expect(runs.length).toBe(6);
      runs.forEach((run) => {
        expect(run.length).toBeGreaterThanOrEqual(1);
        expect(run.length).toBeLessThanOrEqual(4);
      });
      expect(runs.reduce((sum, r) => sum + r.length, 0)).toBe(11);
    }
  });

  it("START B dan STOP terpasang benar (panjang total & pola STOP 13 modul)", () => {
    const modules = encodeCode128B("A");
    expect(modules.slice(0, 11)).toBe("11010010000"); // START B
    expect(modules.slice(-13)).toBe("1100011101011"); // STOP
  });
});

describe("Code128 subset B — round-trip decode(encode(x)) === x", () => {
  const sampleKodeBarang = [
    "BTHR-7F3K9",
    "A",
    "Z9",
    "PST-ABCDE",
    "0123456789",
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    "kode-campur-123",
    " spasi di tepi ",
    "!@#$%^&*()",
  ];

  it.each(sampleKodeBarang)("round-trip untuk %j", (kode) => {
    const modules = encodeCode128B(kode);
    const result = decodeCode128B(modules);
    expect(result.data).toBe(kode);
    expect(result.checksumValid).toBe(true);
  });

  it("checksum berbeda untuk data berbeda (bukan konstanta)", () => {
    const a = encodeCode128B("AAAAA");
    const b = encodeCode128B("AAAAB");
    expect(a).not.toBe(b);
  });

  it("menolak karakter di luar ASCII 32-126", () => {
    expect(() => encodeCode128B("héllo")).toThrow();
  });

  it("menolak string kosong", () => {
    expect(() => encodeCode128B("")).toThrow();
  });
});
