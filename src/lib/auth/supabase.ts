import { createBrowserClient, createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * Client factory Supabase. Tiga varian:
 * - createBrowserSupabaseClient() — Client Component.
 * - createServerSupabaseClient()  — Server Component/Route Handler/Server
 *   Action ASLI, baca sesi dari cookie lewat next/headers. Ini yang TIDAK
 *   bisa dipanggil di test Vitest (next/headers butuh request scope Next.js).
 * - createSupabaseClientWithToken(accessToken) — dipakai untuk memanggil
 *   logika inti yang sama dengan Server Action, tapi dari luar request
 *   Next.js (test integrasi, script). Access token didapat dari sesi
 *   sungguhan (mis. signInWithPassword), bukan mock.
 * - createSupabaseAdminClient() — role service_role, bypass RLS. HANYA
 *   untuk operasi sistem (setup/cleanup test, cron, sync). Jangan dipakai
 *   untuk melayani request user biasa.
 */

function getEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `${key} belum diset. Isi .env.local berdasarkan .env.example.`
    );
  }
  return value;
}

export function createBrowserSupabaseClient() {
  return createBrowserClient(
    getEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
  );
}

export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient(
    getEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Dipanggil dari Server Component (bukan Server Action/Route
            // Handler) -> tidak boleh set cookie. Aman diabaikan selama ada
            // middleware yang me-refresh sesi di request berikutnya.
          }
        },
      },
    }
  );
}

/**
 * Client anon-key polos, tanpa sesi/token apa pun. Dipakai untuk operasi
 * yang tidak butuh (belum punya) sesi, mis. signInWithPassword() di test.
 */
export function createSupabaseAnonClient() {
  return createClient(
    getEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export function createSupabaseClientWithToken(accessToken: string) {
  return createClient(
    getEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    }
  );
}

export function createSupabaseAdminClient() {
  return createClient(
    getEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
