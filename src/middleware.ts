import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Refresh sesi Supabase Auth di setiap request (pola standar @supabase/ssr
 * untuk Next.js App Router). Tanpa ini, access token bisa kedaluwarsa di
 * tengah sesi browser tanpa pernah diperbarui — Server Component/Action
 * baru sadar sesi habis setelah user sudah gagal login diam-diam.
 *
 * SENGAJA masih "middleware.ts" (bukan "proxy.ts") walau deprecated di
 * Next.js 16 -- JANGAN jalankan lagi codemod middleware-to-proxy. Proxy
 * (file baru) SELALU jalan di Node.js runtime, tidak bisa dipaksa Edge lewat
 * config apa pun, dan @opennextjs/cloudflare 1.20.2 belum mendukung
 * Node.js middleware sama sekali -- `npx opennextjs-cloudflare build` gagal
 * total ("Node.js middleware is not currently supported") kalau file ini
 * bernama proxy.ts. middleware.ts (convention lama) tetap jalan di Edge
 * runtime seperti biasa dan didukung penuh. Ini pernah bikin deploy gagal
 * total di produksi Indokopi -- migrasi ke proxy.ts baru boleh dilakukan
 * lagi setelah @opennextjs/cloudflare merilis dukungan Node.js middleware
 * (cek https://github.com/opennextjs/opennextjs-cloudflare/issues/962).
 *
 * Guard auth SESUNGGUHNYA (redirect ke /login) TIDAK ada di sini -- itu
 * tanggung jawab getSession()/requirePermissionDb() di tiap layout/page
 * (lihat (dashboard)/layout.tsx, (pos)/layout.tsx). Middleware ini cuma
 * me-refresh cookie sesi, jadi convention lama/baru tidak mengubah
 * perilaku proteksi akses sama sekali.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabaseUrl = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const supabaseAnonKey = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];

  if (!supabaseUrl || !supabaseAnonKey) {
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Wajib dipanggil supaya cookie sesi diperbarui kalau perlu.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
