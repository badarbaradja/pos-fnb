import { randomInt } from "node:crypto";

/**
 * lib/barang/kode.ts — TT04. Kode barang DIGENERATE OTOMATIS, tidak pernah
 * diketik manual (jawaban CEO §5 SPESIFIKASI-THRIFTING.md: kecepatan input
 * adalah penentu sistem ini dipakai atau tidak -- mengetik kode sendiri per
 * barang akan memperlambat sesi 150 barang). Kode ini yang dicetak jadi
 * barcode fisik (TT05) dan yang diketik/dipindai kasir di layar kasir (TT06).
 *
 * Format: {kodeOutlet}-{5 karakter acak, huruf besar+angka, tanpa 0/O/1/I
 * supaya tidak ambigu dibaca manusia kalau label rusak/buram}. TIDAK
 * sekuensial -- sengaja acak supaya generateBarangKode() bisa dipanggil
 * berkali-kali secara paralel (dua kasir input barang bersamaan) tanpa
 * perlu mengunci counter bersama. Tabrakan ditangani pemanggil lewat
 * retry-on-unique-violation (lib/barang/manage.ts), bukan di sini --
 * fungsi ini murni generate, tidak menyentuh DB.
 */
const UNAMBIGUOUS_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export function generateBarangKode(outletCode: string): string {
  let suffix = "";
  for (let i = 0; i < 5; i++) {
    suffix += UNAMBIGUOUS_CHARS[randomInt(UNAMBIGUOUS_CHARS.length)];
  }
  return `${outletCode}-${suffix}`;
}
