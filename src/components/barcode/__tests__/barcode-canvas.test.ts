/**
 * Perbaikan 13 September 2026 (temuan CEO): BarcodeCanvas dulu menelan
 * galat encodeCode128B diam-diam dan membiarkan kanvas kosong, tanpa
 * pesan apa pun -- label tercetak KOSONG, baru ketahuan setelah barang
 * dijual dan labelnya tidak mau dipindai.
 *
 * Cuma menguji resolveBarcodeModules() (logika PERSIS dipakai
 * BarcodeCanvas, diekspor terpisah supaya testable) -- proyek ini tidak
 * punya @testing-library/react/jsdom untuk render komponen sungguhan
 * (vitest.config.mts: environment 'node'), jadi tidak ada test render
 * DOM di sini. Pertahanan berlapis: kode barang SELALU digenerate sistem
 * dari alfabet aman, jalur ini tidak tercapai lewat kode manapun yang
 * dibuat lewat aplikasi hari ini -- disiapkan untuk jalur masuk lain di
 * masa depan (lihat komentar BarcodeCanvas).
 */
import { describe, expect, it } from "vitest";
import { resolveBarcodeModules } from "../barcode-canvas";

describe("resolveBarcodeModules", () => {
  it("data valid (ASCII 32-126) -> modules terisi, errorMessage null", () => {
    const result = resolveBarcodeModules("BTHR-7F3K9");
    expect(result.errorMessage).toBeNull();
    expect(result.modules.length).toBeGreaterThan(0);
  });

  it("data mengandung karakter di luar ASCII 32-126 -> errorMessage terisi (BUKAN modules kosong diam-diam)", () => {
    const result = resolveBarcodeModules("BTHR-Ñ123"); // Ñ = di luar Code128 subset B
    expect(result.modules).toBe("");
    expect(result.errorMessage).toBeTruthy();
    expect(result.errorMessage).toContain("Ñ");
  });

  it("data kosong -> errorMessage terisi, bukan modules kosong tanpa penjelasan", () => {
    const result = resolveBarcodeModules("");
    expect(result.modules).toBe("");
    expect(result.errorMessage).toBeTruthy();
  });
});
