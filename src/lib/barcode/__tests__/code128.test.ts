import { describe, expect, it } from "vitest";
import { decodeCode128B, encodeCode128B } from "../code128";

/**
 * Bug 12 September 2026: barcode TERBACA scanner sungguhan tapi isinya
 * salah/acak. CEO menunjukkan (benar) bahwa test lama di bawah ("struktur
 * tabel pola" dan "round-trip decode(encode(x)) === x") MELINGKAR --
 * decoder dan encoder di file ini saling sepakat, itu tidak membuktikan
 * keduanya cocok Code128 sungguhan. Satu kesalahan sistematis di tabel
 * pola akan lolos 100% dari kedua test itu.
 *
 * Blok PERTAMA di bawah ("vektor acuan eksternal") menggantikannya sebagai
 * bukti sungguhan: setiap bit pola di sini DIKETIK LANGSUNG dari
 * BARS[N] di github.com/lindell/JsBarcode (file
 * src/barcodes/CODE128/constants.js, commit di branch master, diambil
 * 12 September 2026) -- library barcode pihak ketiga yang sudah dipakai
 * produksi luas, BUKAN dari kode kita. Checksum dihitung tangan di
 * komentar, bukan dipanggil dari fungsi yang sedang diuji.
 *
 * Investigasi lengkap (dump per-simbol, transkrip verifikasi terhadap
 * JsBarcode utuh 107 baris, dan pembuktian lewat pembacaan ulang piksel
 * kanvas sungguhan di browser) ada di respons sesi 12 September 2026 --
 * SEMUA 107 baris tabel cocok byte-per-byte dengan JsBarcode, dan piksel
 * kanvas yang benar-benar tergambar di browser cocok persis dengan
 * bitstring yang dihitung. Akar masalah paling mungkin (BELUM dibuktikan
 * lewat pindai fisik ulang): resolusi buffer kanvas terlalu rendah untuk
 * DPI cetak printer termal, diperbaiki di barcode-canvas.tsx
 * (MIN_PX_PER_MODULE) -- baca komentar di file itu.
 */
describe("Code128 subset B — vektor acuan EKSTERNAL (JsBarcode BARS, bukan kode kita)", () => {
  it('vektor lengkap untuk "A" -- tiap pola dari BARS[N] JsBarcode, checksum dihitung tangan', () => {
    // 'A' = ASCII 65. Nilai Subset B = 65 - 32 = 33.
    // START_B = simbol 104. BARS[104] (JsBarcode) = "11010010000".
    // BARS[33]  (data 'A', nilai 33)                = "10100011000".
    // Checksum = (104 + 33*1) mod 103 = 137 mod 103 = 34.
    // BARS[34]  (checksum, nilai 34)                 = "10001011000".
    // STOP = simbol 106. BARS[106]                   = "1100011101011" (13 modul).
    const expected =
      "11010010000" + // START B      (BARS[104])
      "10100011000" + // 'A' = 33     (BARS[33])
      "10001011000" + // checksum=34  (BARS[34])
      "1100011101011"; // STOP        (BARS[106])
    expect(encodeCode128B("A")).toBe(expected);
  });

  it('vektor lengkap untuk "BTHR-7F3K9" (format kode barang sungguhan, lib/barang/kode.ts)', () => {
    // Nilai Subset B tiap karakter (charCode - 32):
    //   B=66->34  T=84->52  H=72->40  R=82->50  -=45->13
    //   7=55->23  F=70->38  3=51->19  K=75->43  9=57->25
    // Checksum = 104 + (34*1)+(52*2)+(40*3)+(50*4)+(13*5)+(23*6)+(38*7)+(19*8)+(43*9)+(25*10)
    //          = 104 + 34+104+120+200+65+138+266+152+387+250
    //          = 104 + 1716 = 1820 ; 1820 mod 103 = 69.
    // Semua pola BARS[N] di bawah dari JsBarcode (github.com/lindell/JsBarcode,
    // src/barcodes/CODE128/constants.js), bukan tabel kita.
    const expected =
      "11010010000" + // START B        (BARS[104])
      "10001011000" + // B = 34         (BARS[34])
      "11011100010" + // T = 52         (BARS[52])
      "11000101000" + // H = 40         (BARS[40])
      "11000101110" + // R = 50         (BARS[50])
      "10011011100" + // - = 13         (BARS[13])
      "11101101110" + // 7 = 23         (BARS[23])
      "10001100010" + // F = 38         (BARS[38])
      "11001011100" + // 3 = 19         (BARS[19])
      "10110001110" + // K = 43         (BARS[43])
      "11100101100" + // 9 = 25         (BARS[25])
      "10110010000" + // checksum = 69  (BARS[69])
      "1100011101011"; // STOP          (BARS[106])
    expect(encodeCode128B("BTHR-7F3K9")).toBe(expected);
  });

  it("START B, value-0 (spasi), dan STOP cocok anchor spesifikasi Code128 yang independen dari tabel manapun", () => {
    // Anchor yang bisa dicek langsung dari spesifikasi Code128 tanpa
    // tabel/decoder apa pun: lebar Start A/B/C dan STOP, dan pola value 0.
    // START A=2-1-1-4-1-2, START B=2-1-1-2-1-4, START C=2-1-1-2-3-2,
    // STOP=2-3-3-1-1-1-2 (satu-satunya pola 13 modul), value 0=2-1-2-2-2-2.
    const modules = encodeCode128B(" "); // " " (ASCII 32) = value 0 di Subset B
    expect(modules.slice(0, 11)).toBe("11010010000"); // START B: 2-1-1-2-1-4
    expect(modules.slice(11, 22)).toBe("11011001100"); // value 0: 2-1-2-2-2-2
    expect(modules.slice(-13)).toBe("1100011101011"); // STOP: 2-3-3-1-1-1-2, 13 modul
  });
});

/**
 * Test di bawah ini yang LAMA (struktural + round-trip) -- DITURUNKAN
 * STATUSNYA per instruksi CEO: ini JARING REGRESI (menangkap kalau kode
 * berubah dan tiba-tiba melanggar bentuk Code128 atau checksum sendiri
 * jadi tidak konsisten), BUKAN BUKTI kebenaran terhadap spesifikasi --
 * decoder dan encoder di file ini saling memakai tabel yang sama, jadi
 * satu kesalahan sistematis di tabel akan lolos dari kedua test ini.
 * Bukti terhadap spesifikasi ada di describe() di atas.
 */
describe("Code128 subset B — struktur tabel pola (JARING REGRESI, bukan bukti kebenaran)", () => {
  it("setiap karakter ASCII 32-126 menghasilkan modul data 11 digit di posisi kedua (setelah START B 11 digit)", () => {
    for (let code = 32; code <= 126; code++) {
      const ch = String.fromCharCode(code);
      const modules = encodeCode128B(ch);
      expect(modules).toHaveLength(46);
      const dataChunk = modules.slice(11, 22);
      expect(dataChunk).toHaveLength(11);
      expect(dataChunk).toMatch(/^[01]{11}$/);
      expect(dataChunk[0]).toBe("1");
      const runs = dataChunk.match(/1+|0+/g)!;
      expect(runs.length).toBe(6);
      runs.forEach((run) => {
        expect(run.length).toBeGreaterThanOrEqual(1);
        expect(run.length).toBeLessThanOrEqual(4);
      });
      expect(runs.reduce((sum, r) => sum + r.length, 0)).toBe(11);
    }
  });
});

describe("Code128 subset B — round-trip decode(encode(x)) === x (JARING REGRESI, bukan bukti kebenaran)", () => {
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
