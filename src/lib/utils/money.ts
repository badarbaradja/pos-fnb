import { Decimal } from "decimal.js";

export { Decimal };

export type RoundingMode = "nearest" | "up" | "down";

/**
 * roundTo() — CALC-SPEC A.2.
 * 'nearest' → Math.round(x / step) * step   (rentang rounding (-step/2, +step/2])
 * 'up'      → Math.ceil(x / step) * step    (rounding selalu >= 0)
 * 'down'    → Math.floor(x / step) * step   (rounding selalu <= 0)
 *
 * `step` bertipe `number`, bukan `Decimal` — ini satuan konfigurasi pembulatan
 * (mis. 100, 500, 1000), bukan nilai uang. Larangan §3.1 berlaku untuk nilai
 * uang, bukan untuk konfigurasi integer semacam ini.
 */
export function roundTo(
  value: Decimal,
  step: number,
  mode: RoundingMode
): Decimal {
  if (step === 0) {
    throw new Error("roundTo: step tidak boleh nol");
  }
  const stepDecimal = new Decimal(step);
  const ratio = value.dividedBy(stepDecimal);
  const roundingMode =
    mode === "up"
      ? Decimal.ROUND_CEIL
      : mode === "down"
      ? Decimal.ROUND_FLOOR
      : Decimal.ROUND_HALF_CEIL; // half-up ke arah +Infinity, sama seperti Math.round

  return ratio.toDecimalPlaces(0, roundingMode).times(stepDecimal);
}

/**
 * round2(x) — pembulatan ke 2 desimal, mode HALF_UP. Dipakai di seluruh
 * lib/calc/ (CALC-SPEC A.2, B.1, B.2) untuk perhitungan antara sebelum
 * pembulatan akhir ke satuan tampilan (roundTo/formatIDR).
 */
export function round2(x: Decimal): Decimal {
  return x.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/**
 * Format Decimal sebagai string Rupiah untuk tampilan UI, mis. "Rp 150.000".
 * Dibulatkan ke rupiah penuh (HALF_UP) karena IDR tidak punya sen dalam praktik,
 * meski nilai tersimpan di numeric(16,2).
 */
export function formatIDR(value: Decimal): string {
  const rounded = value.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const isNegative = rounded.isNegative();
  const digits = rounded.abs().toFixed(0);
  const withThousandSeparators = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${isNegative ? "-" : ""}Rp ${withThousandSeparators}`;
}

/**
 * Parse string notasi Indonesia jadi Decimal: titik = pemisah ribuan,
 * koma = desimal. Contoh: "1.500,50" -> 1500.50, "150.000" -> 150000.
 * Dipakai untuk input manual di layar kasir. Lempar error kalau formatnya
 * tidak valid — tidak pernah mengembalikan NaN.
 */
export function parseMoneyID(input: string): Decimal {
  const { isNegative, unsigned } = extractSign(input);

  const commaCount = (unsigned.match(/,/g) ?? []).length;
  if (commaCount > 1) {
    throw new Error(`parseMoneyID: format tidak valid: "${input}"`);
  }

  const normalized = unsigned.replace(/\./g, "").replace(",", ".");

  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error(`parseMoneyID: format tidak valid: "${input}"`);
  }

  return new Decimal(`${isNegative ? "-" : ""}${normalized}`);
}

/**
 * Parse string notasi internasional/wire format jadi Decimal: titik = desimal,
 * tanpa pemisah ribuan. Contoh: "1500.50" -> 1500.50. Dipakai untuk data dari
 * API/CSV/lewat jaringan (CLAUDE.md §3.1). Lempar error kalau formatnya tidak
 * valid — tidak pernah mengembalikan NaN.
 */
export function parseMoneyISO(input: string): Decimal {
  const trimmed = input.trim();
  if (trimmed === "" || !/^[+-]?\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`parseMoneyISO: format tidak valid: "${input}"`);
  }

  return new Decimal(trimmed);
}

function extractSign(input: string): { isNegative: boolean; unsigned: string } {
  const trimmed = input.trim();
  if (trimmed === "") {
    throw new Error("parseMoneyID: input kosong");
  }

  const isNegative = trimmed.startsWith("-");
  const hasSign = isNegative || trimmed.startsWith("+");
  return { isNegative, unsigned: hasSign ? trimmed.slice(1) : trimmed };
}
