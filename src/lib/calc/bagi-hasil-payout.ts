import { Decimal } from "decimal.js";

/**
 * lib/calc/bagi-hasil-payout.ts — TT11. Fungsi murni, sama filosofi
 * consignment-split.ts (TT07): input Decimal, output Decimal, tanpa
 * akses database.
 *
 * "Sisa dibayar" SELALU dihitung dari total SEMUA baris pemilik_payouts
 * periode itu (bisa lebih dari satu -- SPESIFIKASI-THRIFTING.md §7:
 * Rp800.000 dari Rp1.110.000 bisa jadi beberapa kali cicilan), TIDAK
 * PERNAH disimpan sebagai kolom tersendiri -- satu sumber kebenaran.
 *
 * SENGAJA tidak dibulatkan ke nol kalau negatif (kelebihan bayar) --
 * toko harus tahu kalau kelebihan bayar terjadi, bukan diam-diam
 * disembunyikan jadi kelihatan "lunas pas".
 */
export function calculateSisaDibayar(
  bagianPemilik: Decimal,
  totalDibayar: Decimal
): Decimal {
  return bagianPemilik.minus(totalDibayar);
}
