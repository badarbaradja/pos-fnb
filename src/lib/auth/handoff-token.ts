import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * lib/auth/handoff-token.ts — verifikasi token "satu pintu masuk" dari
 * reportkoperumnasgroup (25 September 2026). Lihat komentar
 * `reportIdentityLinks`/`handoffNonces` di lib/db/schema.ts untuk desain
 * penuh, dan CLAUDE.md untuk batasnya.
 *
 * PENTING, jangan dilanggar: token ini HANYA pembawa "orang ini SEDANG
 * login di reportkoperumnasgroup sebagai email X, baru saja, buktinya
 * tanda tangan ini". Token TIDAK PERNAH jadi sumber role atau outlet --
 * itu SELALU datang dari membership pos-fnb sungguhan sesudah sesi
 * Supabase asli terbentuk (lihat app/handoff/route.ts). Kalau ada
 * dorongan menambah field role/outlet ke payload ini, berhenti -- itu
 * jalan pintas yang persis dihindari desain ini.
 *
 * Format token: `${base64url(JSON payload)}.${base64url(HMAC-SHA256)}`.
 * Bukan JWT library (jose/jsonwebtoken) SENGAJA -- payloadnya kecil dan
 * tunggal-tujuan (satu audience, satu bentuk), HMAC bawaan Node cukup dan
 * tidak menambah dependency untuk satu fungsi ini.
 *
 * Reimplementasi SISI PENANDATANGAN ada di reportkoperumnasgroup
 * (`lib/posHandoff.ts`, repo terpisah) -- kalau format payload di sini
 * diubah, berkas itu WAJIB ikut diubah, tidak ada cara berbagi kode
 * karena dua repo terpisah total.
 */

export const HANDOFF_AUDIENCE = "pos-fnb-handoff";
export const HANDOFF_TOKEN_TTL_SECONDS = 60;

export type HandoffPayload = {
  aud: typeof HANDOFF_AUDIENCE;
  email: string;
  uid: string; // report_user_id -- audit/log SAJA, bukan kunci pencocokan
  nonce: string;
  iat: number; // detik epoch
  exp: number; // detik epoch
};

export type VerifyHandoffResult =
  | { ok: true; payload: HandoffPayload }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

function base64UrlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function sign(payloadB64: string, secret: string): string {
  return base64UrlEncode(createHmac("sha256", secret).update(payloadB64).digest());
}

export function verifyHandoffToken(
  token: string,
  secret: string,
  now: Date = new Date()
): VerifyHandoffResult {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, reason: "malformed" };
  }
  const [payloadB64, sigB64] = parts;

  const expectedSig = sign(payloadB64, secret);
  const expectedBuf = base64UrlDecode(expectedSig);
  const actualBuf = base64UrlDecode(sigB64);
  // Panjang beda dulu -- timingSafeEqual melempar kalau panjang buffer
  // tidak sama, jadi cek eksplisit dulu (bukan ditangkap sebagai exception).
  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
    return { ok: false, reason: "bad_signature" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(base64UrlDecode(payloadB64).toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as Record<string, unknown>)["aud"] !== HANDOFF_AUDIENCE ||
    typeof (parsed as Record<string, unknown>)["email"] !== "string" ||
    typeof (parsed as Record<string, unknown>)["uid"] !== "string" ||
    typeof (parsed as Record<string, unknown>)["nonce"] !== "string" ||
    typeof (parsed as Record<string, unknown>)["iat"] !== "number" ||
    typeof (parsed as Record<string, unknown>)["exp"] !== "number"
  ) {
    return { ok: false, reason: "malformed" };
  }

  const payload = parsed as HandoffPayload;
  if (now.getTime() > payload.exp * 1000) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, payload };
}
