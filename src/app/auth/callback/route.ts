import { type NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/auth/supabase";

/**
 * GET /auth/callback?code=... — penukar kode PKCE standar @supabase/ssr.
 * Belum ada sebelum handoff (25 September 2026, login sebelumnya cuma
 * password) -- action_link dari generateLink() (lib/auth/handoff.ts)
 * mengarah ke sini SETELAH Supabase sendiri memverifikasi token magic
 * link-nya. Sesi yang terbentuk di sini SAMA PERSIS dengan login password
 * biasa (membership/role/outlet dibaca ulang dari database seperti biasa,
 * bukan diwariskan dari mana pun) -- RLS dan gerbang peran tidak butuh
 * tahu bedanya.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");

  if (code) {
    const supabase = await createServerSupabaseClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(new URL("/", request.url));
}
