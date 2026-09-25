import { createHmac, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { HANDOFF_AUDIENCE, verifyHandoffToken } from "../handoff-token";

const SECRET = "test-secret-abc";

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Duplikasi SENGAJA -- pos-fnb TIDAK PERNAH boleh punya kode yang bisa
 * menandatangani token handoff sungguhan (cuma reportkoperumnasgroup yang
 * menandatangani, lihat handoff-token.ts). Helper ini HANYA hidup di test.
 */
function buatTokenUji(payload: Record<string, unknown>, secret: string = SECRET): string {
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(createHmac("sha256", secret).update(payloadB64).digest());
  return `${payloadB64}.${sig}`;
}

function payloadValid(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    aud: HANDOFF_AUDIENCE,
    email: "ita@koperumnas.local",
    uid: "report-user-uid-123",
    nonce: randomUUID(),
    iat: now,
    exp: now + 60,
    ...overrides,
  };
}

describe("verifyHandoffToken", () => {
  it("token valid, ditandatangani secret benar -> diterima", () => {
    const token = buatTokenUji(payloadValid());
    const result = verifyHandoffToken(token, SECRET);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.email).toBe("ita@koperumnas.local");
    }
  });

  it("token kedaluwarsa -> ditolak", () => {
    const now = Math.floor(Date.now() / 1000);
    const token = buatTokenUji(payloadValid({ iat: now - 120, exp: now - 60 }));
    const result = verifyHandoffToken(token, SECRET);
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("ditandatangani dengan secret SALAH -> ditolak", () => {
    const token = buatTokenUji(payloadValid(), "secret-yang-salah");
    const result = verifyHandoffToken(token, SECRET);
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("payload diutak-atik setelah ditandatangani (signature tidak lagi cocok) -> ditolak", () => {
    const token = buatTokenUji(payloadValid());
    const [payloadB64, sigB64] = token.split(".");
    const payload = JSON.parse(Buffer.from(payloadB64!.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
    payload.email = "orang-lain@koperumnas.local";
    const payloadDiubah = b64url(Buffer.from(JSON.stringify(payload)));
    const tokenDiubah = `${payloadDiubah}.${sigB64}`;
    const result = verifyHandoffToken(tokenDiubah, SECRET);
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("format bukan dua bagian dipisah titik -> ditolak", () => {
    expect(verifyHandoffToken("bukan-token-valid-sama-sekali", SECRET)).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(verifyHandoffToken("terlalu.banyak.titik", SECRET)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("aud bukan pos-fnb-handoff -> ditolak", () => {
    const token = buatTokenUji(payloadValid({ aud: "aud-lain" }));
    const result = verifyHandoffToken(token, SECRET);
    expect(result.ok).toBe(false);
  });

  it("field wajib hilang -> ditolak", () => {
    const now = Math.floor(Date.now() / 1000);
    const token = buatTokenUji({ aud: HANDOFF_AUDIENCE, email: "ita@koperumnas.local", iat: now, exp: now + 60 });
    const result = verifyHandoffToken(token, SECRET);
    expect(result).toEqual({ ok: false, reason: "malformed" });
  });
});
