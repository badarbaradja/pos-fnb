import { describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";
import { calculateSisaDibayar } from "../bagi-hasil-payout";

/**
 * Test-first (CLAUDE.md §7 poin 4), sama disiplin consignment-split.ts
 * (TT07) -- ditulis SEBELUM calculateSisaDibayar() dipakai laporan bagi
 * hasil (TT11). Angka TC-01 persis contoh SPESIFIKASI-THRIFTING.md §7:
 * bagian pemilik Rp1.110.000, sudah dibayar Rp800.000, sisa Rp310.000.
 */
describe("calculateSisaDibayar", () => {
  it("TC-01: contoh SPESIFIKASI-THRIFTING.md §7 -- 1.110.000 dikurangi 800.000 = 310.000", () => {
    const sisa = calculateSisaDibayar(new Decimal("1110000"), new Decimal("800000"));
    expect(sisa.toFixed(2)).toBe("310000.00");
  });

  it("belum dibayar sama sekali -- sisa = seluruh bagian pemilik", () => {
    const sisa = calculateSisaDibayar(new Decimal("1110000"), new Decimal("0"));
    expect(sisa.toFixed(2)).toBe("1110000.00");
  });

  it("sudah dibayar lunas -- sisa nol", () => {
    const sisa = calculateSisaDibayar(new Decimal("1110000"), new Decimal("1110000"));
    expect(sisa.toFixed(2)).toBe("0.00");
  });

  it("dibayar SEBAGIAN lewat beberapa kali (dijumlahkan pemanggil) -- bukan boolean, harus akumulatif", () => {
    // 300.000 + 500.000 = 800.000, sisa tetap 310.000 sama seperti TC-01
    // walau dibayar dua kali, bukan sekali Rp800.000.
    const totalDibayar = new Decimal("300000").plus(new Decimal("500000"));
    const sisa = calculateSisaDibayar(new Decimal("1110000"), totalDibayar);
    expect(sisa.toFixed(2)).toBe("310000.00");
  });

  it("kelebihan bayar TIDAK dibulatkan ke nol -- toko harus tahu kalau kelebihan bayar, bukan disembunyikan", () => {
    const sisa = calculateSisaDibayar(new Decimal("1110000"), new Decimal("1200000"));
    expect(sisa.toFixed(2)).toBe("-90000.00");
    expect(sisa.isNegative()).toBe(true);
  });

  it("bagian pemilik nol (tidak ada penjualan) -- sisa nol kalau belum dibayar apa pun", () => {
    const sisa = calculateSisaDibayar(new Decimal("0"), new Decimal("0"));
    expect(sisa.toFixed(2)).toBe("0.00");
  });
});
