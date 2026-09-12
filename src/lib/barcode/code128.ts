/**
 * lib/barcode/code128.ts — TT05. Code128 (subset B) diimplementasikan
 * sendiri sebagai fungsi murni -- TIDAK ADA dependency baru (CLAUDE.md §7
 * poin 5), sama filosofi lib/calc/: input data, output pola bar, tanpa
 * DOM/canvas di sini (itu di components/barcode/barcode-canvas.tsx).
 *
 * Subset B mencakup ASCII 32-126 (spasi sampai ~) -- kode barang
 * (lib/barang/kode.ts: huruf besar + angka + "-") ada jauh di dalam
 * jangkauan itu, tidak perlu subset A/C atau shift sama sekali.
 *
 * PENTING soal keandalan: tabel pola 107 baris di bawah adalah tabel
 * Code128 standar (dipublikasikan luas, sama di semua implementasi).
 * Diverifikasi di sini lewat DUA cara yang bisa diotomasi (struktural:
 * setiap pola persis 11 modul/13 untuk STOP, dimulai bar, tiap run
 * 1-4 modul; dan round-trip: decode(encode(x)) === x untuk banyak
 * kode uji, lihat __tests__/code128.test.ts) -- tapi TIDAK ADA cara
 * memverifikasi cocok dengan scanner fisik sungguhan dari lingkungan
 * ini. Tes pindai label cetakan sungguhan sebelum dipakai produksi.
 */

const START_B = 104;
const STOP = 106;

// Simbol 0-102 = karakter data (value = charCode - 32), 103 = START A,
// 104 = START B, 105 = START C, 106 = STOP. Pola sebagai string modul
// ('1' = bar/hitam, '0' = spasi/putih), 11 modul kecuali STOP (13).
const CODE128_PATTERNS: readonly string[] = [
  "11011001100", "11001101100", "11001100110", "10010011000", "10010001100",
  "10001001100", "10011001000", "10011000100", "10001100100", "11001001000",
  "11001000100", "11000100100", "10110011100", "10011011100", "10011001110",
  "10111001100", "10011101100", "10011100110", "11001110010", "11001011100",
  "11001001110", "11011100100", "11001110100", "11101101110", "11101001100",
  "11100101100", "11100100110", "11101100100", "11100110100", "11100110010",
  "11011011000", "11011000110", "11000110110", "10100011000", "10001011000",
  "10001000110", "10110001000", "10001101000", "10001100010", "11010001000",
  "11000101000", "11000100010", "10110111000", "10110001110", "10001101110",
  "10111011000", "10111000110", "10001110110", "11101110110", "11010001110",
  "11000101110", "11011101000", "11011100010", "11011101110", "11101011000",
  "11101000110", "11100010110", "11101101000", "11101100010", "11100011010",
  "11101111010", "11001000010", "11110001010", "10100110000", "10100001100",
  "10010110000", "10010000110", "10000101100", "10000100110", "10110010000",
  "10110000100", "10011010000", "10011000010", "10000110100", "10000110010",
  "11000010010", "11001010000", "11110111010", "11000010100", "10001111010",
  "10100111100", "10010111100", "10010011110", "10111100100", "10011110100",
  "10011110010", "11110100100", "11110010100", "11110010010", "11011011110",
  "11011110110", "11110110110", "10101111000", "10100011110", "10001011110",
  "10111101000", "10111100010", "11110101000", "11110100010", "10111011110",
  "10111101110", "11101011110", "11110101110", // 102
  "11010000100", // 103 START A
  "11010010000", // 104 START B
  "11010011100", // 105 START C
  "1100011101011", // 106 STOP (13 modul, satu bar ekstra di akhir)
];

export function code128CharValue(ch: string): number {
  const code = ch.charCodeAt(0);
  if (code < 32 || code > 126) {
    throw new Error(
      `Karakter "${ch}" (kode ${code}) di luar jangkauan Code128 subset B (32-126)`
    );
  }
  return code - 32;
}

/**
 * Encode string jadi urutan modul bar/spasi ('1'/'0'), lengkap dengan
 * START B, checksum, dan STOP. Kembalikan sebagai satu string modul --
 * penggambar (barcode-canvas.tsx) tinggal iterasi karakter demi
 * karakter, gambar kotak hitam untuk '1', lewati untuk '0'.
 */
export function encodeCode128B(data: string): string {
  if (data.length === 0) {
    throw new Error("Data barcode tidak boleh kosong");
  }
  const values = [...data].map(code128CharValue);

  let checksum = START_B;
  values.forEach((v, i) => {
    checksum += v * (i + 1);
  });
  checksum %= 103;

  const symbolValues = [START_B, ...values, checksum, STOP];
  return symbolValues.map((v) => CODE128_PATTERNS[v]).join("");
}

export type Code128DebugInfo = {
  codeSet: "B";
  startValue: number;
  symbols: { position: number; char: string; charCode: number; value: number }[];
  checksumSteps: { position: number; value: number; weight: number; contribution: number; runningTotal: number }[];
  checksum: number;
  stopValue: number;
  modules: string;
};

/**
 * Rincian per-simbol untuk mode debug (/label-settings) -- instruksi CEO
 * 12 September 2026, sesudah bug barcode salah baca: kasir/CEO harus bisa
 * memindai label lalu membandingkan sendiri nilai per simbol dan checksum
 * tanpa bertanya ke developer tiap kali. Logika SAMA PERSIS dengan
 * encodeCode128B() (bukan reimplementasi terpisah yang bisa diam-diam
 * menyimpang) -- fungsi ini cuma mengekspos langkah antaranya.
 */
export function debugEncodeCode128B(data: string): Code128DebugInfo {
  const values = [...data].map(code128CharValue);

  let checksum = START_B;
  const checksumSteps: Code128DebugInfo["checksumSteps"] = [];
  values.forEach((v, i) => {
    const weight = i + 1;
    const contribution = v * weight;
    checksum += contribution;
    checksumSteps.push({ position: i + 1, value: v, weight, contribution, runningTotal: checksum });
  });

  return {
    codeSet: "B",
    startValue: START_B,
    symbols: [...data].map((ch, i) => ({
      position: i + 1,
      char: ch,
      charCode: ch.charCodeAt(0),
      value: values[i]!,
    })),
    checksumSteps,
    checksum: checksum % 103,
    stopValue: STOP,
    modules: encodeCode128B(data),
  };
}

/**
 * Decode modul kembali jadi data + checksum -- DIPAKAI CUMA untuk
 * verifikasi round-trip di test, bukan di alur aplikasi (tidak ada
 * kebutuhan membaca barcode dari gambar di app ini).
 */
export function decodeCode128B(modules: string): { data: string; checksumValid: boolean } {
  const patternToValue = new Map<string, number>();
  CODE128_PATTERNS.forEach((pattern, value) => {
    patternToValue.set(pattern, value);
  });

  const symbols: number[] = [];
  let i = 0;
  while (i < modules.length) {
    const remaining = modules.length - i;
    const len = remaining === 13 ? 13 : 11;
    const chunk = modules.slice(i, i + len);
    const value = patternToValue.get(chunk);
    if (value === undefined) {
      throw new Error(`Pola modul tidak dikenal pada posisi ${i}: "${chunk}"`);
    }
    symbols.push(value);
    i += len;
  }

  if (symbols[0] !== START_B) {
    throw new Error("Simbol pertama bukan START B");
  }
  if (symbols[symbols.length - 1] !== STOP) {
    throw new Error("Simbol terakhir bukan STOP");
  }
  const dataValues = symbols.slice(1, -2);
  const checksumSymbol = symbols[symbols.length - 2]!;

  let expectedChecksum = START_B;
  dataValues.forEach((v, idx) => {
    expectedChecksum += v * (idx + 1);
  });
  expectedChecksum %= 103;

  const data = dataValues.map((v) => String.fromCharCode(v + 32)).join("");
  return { data, checksumValid: checksumSymbol === expectedChecksum };
}
