/**
 * TT07 — Golden test cases untuk consignmentSplit(), lib/calc/consignment-split.ts.
 * JANGAN UBAH ANGKA EKSPEKTASI DI FILE INI.
 *
 * Konvensi: pemilikBagiPercent PECAHAN (0.60 = 60%), sama seperti
 * order-calculator.ts (lihat komentar di consignment-split.ts).
 */
import { describe, it, expect } from "vitest";
import { Decimal } from "../../utils/money";
import { consignmentSplit } from "../consignment-split";

describe("TC-01 — contoh SPESIFIKASI-THRIFTING.md §7 (Rp1.850.000 @ 60%)", () => {
  it("membagi 60% ke pemilik, 40% ke toko, tanpa sisa pembulatan", () => {
    const result = consignmentSplit(new Decimal("1850000"), new Decimal("0.6"));
    expect(result.pemilikShareAmount.toString()).toBe("1110000");
    expect(result.tokoShareAmount.toString()).toBe("740000");
    expect(result.pemilikShareAmount.plus(result.tokoShareAmount).toString()).toBe("1850000");
  });
});

describe("TC-02 — persentase menghasilkan pecahan sen, sisa pembulatan diserap toko", () => {
  it("pemilikShareAmount dibulatkan langsung, tokoShareAmount = sisa (bukan dibulatkan sendiri)", () => {
    // salePrice=100, persen=33.335% -> raw pemilik = 33.335, raw toko = 66.665.
    // Dibulatkan INDEPENDEN (naif), keduanya round HALF_UP ke atas jadi
    // 33.34 + 66.67 = 100.01 -- lebih dari salePrice, tidak boleh terjadi.
    // Implementasi yang benar: tokoShareAmount = salePrice - pemilikShareAmount,
    // BUKAN round2(raw toko) -- hasilnya harus 66.66, bukan 66.67.
    const result = consignmentSplit(new Decimal("100"), new Decimal("0.33335"));
    expect(result.pemilikShareAmount.toString()).toBe("33.34");
    expect(result.tokoShareAmount.toString()).toBe("66.66");
    expect(result.pemilikShareAmount.plus(result.tokoShareAmount).toString()).toBe("100");
  });
});

describe("TC-03 — persen 0% (barang titipan tanpa bagi hasil, teoritis)", () => {
  it("seluruh harga jadi bagian toko, pemilik dapat nol", () => {
    const result = consignmentSplit(new Decimal("50000"), new Decimal("0"));
    expect(result.pemilikShareAmount.toString()).toBe("0");
    expect(result.tokoShareAmount.toString()).toBe("50000");
  });
});

describe("TC-04 — persen 100% (toko cuma jasa titip, teoritis)", () => {
  it("seluruh harga jadi bagian pemilik, toko dapat nol", () => {
    const result = consignmentSplit(new Decimal("50000"), new Decimal("1"));
    expect(result.pemilikShareAmount.toString()).toBe("50000");
    expect(result.tokoShareAmount.toString()).toBe("0");
  });
});
