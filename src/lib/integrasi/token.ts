/**
 * lib/integrasi/token.ts -- pengecekan token Bearer untuk endpoint integrasi
 * sistem laporan (19 September 2026).
 *
 * Bandingkan HASH SHA-256 kedua sisi dengan perbandingan waktu-konstan --
 * tidak membocorkan panjang atau awalan token lewat waktu respons. Web Crypto
 * dipakai (ada di Cloudflare Workers dan Node), bukan node:crypto.
 *
 * Token wajib >= 32 karakter; lebih pendek dianggap TIDAK dikonfigurasi (lebih
 * baik endpoint mati dan berteriak 503 daripada hidup dengan token yang bisa
 * ditebak).
 */
export const TOKEN_MIN_PANJANG = 32;

const UUID_POLA = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type KonfigurasiIntegrasi = { token: string; businessId: string };

/** Null = belum dikonfigurasi dengan benar (route menjawab 503). */
export function bacaKonfigurasiIntegrasi(
  env: Record<string, string | undefined> = process.env
): KonfigurasiIntegrasi | null {
  const token = env["INTEGRASI_LAPORAN_TOKEN"];
  const businessId = env["INTEGRASI_BUSINESS_ID"];
  if (!token || token.length < TOKEN_MIN_PANJANG) return null;
  if (!businessId || !UUID_POLA.test(businessId)) return null;
  return { token, businessId };
}

async function sha256(teks: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(teks);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

export async function tokenIntegrasiValid(
  headerAuthorization: string | null,
  tokenSeharusnya: string | undefined
): Promise<boolean> {
  if (!tokenSeharusnya || tokenSeharusnya.length < TOKEN_MIN_PANJANG) return false;
  if (!headerAuthorization) return false;
  const cocok = /^Bearer (.+)$/.exec(headerAuthorization);
  if (!cocok) return false;
  const [a, b] = await Promise.all([sha256(cocok[1]!), sha256(tokenSeharusnya)]);
  let selisih = a.length ^ b.length;
  for (let i = 0; i < a.length && i < b.length; i++) selisih |= a[i]! ^ b[i]!;
  return selisih === 0;
}
