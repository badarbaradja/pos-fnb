import { type NextRequest, NextResponse } from "next/server";
import { verifyHandoffToken } from "@/lib/auth/handoff-token";
import { consumeNonceOnce, createHandoffMagicLink, findPosProfileIdForReportEmail } from "@/lib/auth/handoff";

/**
 * GET /handoff?token=... — titik masuk satu pintu dari reportkoperumnasgroup
 * (25 September 2026). Lihat lib/auth/handoff-token.ts untuk desain penuh
 * dan batasnya, dan CLAUDE.md §3.4 untuk pengecualian koneksi admin yang
 * dipakai di lib/auth/handoff.ts.
 *
 * DILARANG membuat sesi Supabase apa pun secara langsung di sini (mis.
 * menyetel cookie sesi manual). SATU-SATUNYA cara sesi terbentuk adalah
 * lewat generateLink() Supabase asli + /auth/callback menukar kode --
 * kalau itu diganti jalan pintas, RLS/pembatasan outlet/gerbang peran bisa
 * jadi tidak berlaku untuk sesi yang "terlalu mudah" dibuat.
 *
 * Setiap kegagalan redirect ke /handoff/gagal dengan alasan GENERIK
 * (cuma dua nilai: "tidak_valid" / "belum_dipetakan") -- TIDAK PERNAH
 * membedakan lebih jauh dari itu, supaya tidak membocorkan apakah suatu
 * email terdaftar di pos-fnb atau tidak.
 */
export async function GET(request: NextRequest) {
  const gagal = (alasan: "tidak_valid" | "belum_dipetakan") =>
    NextResponse.redirect(new URL(`/handoff/gagal?alasan=${alasan}`, request.url));

  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return gagal("tidak_valid");
  }

  const secret = process.env["POS_HANDOFF_SECRET"];
  if (!secret) {
    // Belum dikonfigurasi -- perlakukan sama seperti token tidak valid,
    // JANGAN 500 mentah (ini bisa dipicu orang luar lewat URL).
    return gagal("tidak_valid");
  }

  const result = verifyHandoffToken(token, secret);
  if (!result.ok) {
    return gagal("tidak_valid");
  }

  const { email, nonce } = result.payload;

  const nonceBaru = await consumeNonceOnce(nonce, email);
  if (!nonceBaru) {
    return gagal("tidak_valid");
  }

  const posProfileId = await findPosProfileIdForReportEmail(email);
  if (!posProfileId) {
    return gagal("belum_dipetakan");
  }

  const appUrl = process.env["NEXT_PUBLIC_APP_URL"] ?? request.nextUrl.origin;
  const actionLink = await createHandoffMagicLink(posProfileId, `${appUrl}/auth/callback`);
  if (!actionLink) {
    return gagal("tidak_valid");
  }

  return NextResponse.redirect(actionLink);
}
