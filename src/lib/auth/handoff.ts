import { eq } from "drizzle-orm";
import { getAdminDb } from "@/lib/db/client";
import { handoffNonces, reportIdentityLinks } from "@/lib/db/schema";
import { createSupabaseAdminClient } from "@/lib/auth/supabase";

/**
 * lib/auth/handoff.ts — bagian yang MENYENTUH DATABASE dari handoff satu
 * pintu masuk (lihat handoff-token.ts untuk verifikasi tanda tangan, dan
 * app/handoff/route.ts untuk alur lengkapnya). Setiap fungsi di sini
 * memakai getAdminDb() -- SEMUANYA PENGECUALIAN TERTULIS CLAUDE.md §3.4:
 * `report_identity_links`/`handoff_nonces` TIDAK PUNYA policy RLS SAMA
 * SEKALI (disengaja, lihat schema.ts), jadi tidak ada cara membacanya
 * lewat getUserDb() sekalipun pemanggilnya user asli -- akses satu-satunya
 * memang lewat baris kode ini, dipanggil dari route yang sudah memverifikasi
 * tanda tangan token SEBELUM sampai sini.
 */

/**
 * Coba pakai nonce SEKALI. true = baru dipakai (lanjutkan). false = sudah
 * pernah dipakai sebelumnya (nonce constraint bentrok) -- TOLAK, jangan
 * lanjut ke langkah mana pun sesudah ini walau tanda tangan & exp valid.
 */
export async function consumeNonceOnce(nonce: string, reportEmail: string): Promise<boolean> {
  const db = getAdminDb();
  try {
    await db.insert(handoffNonces).values({ nonce, reportEmail });
    return true;
  } catch {
    // Primary key bentrok -- nonce ini sudah pernah ditukar. Tidak perlu
    // membedakan dari error lain (mis. DB down) di sini -- pemanggil
    // memperlakukan keduanya sama: tolak, jangan buat sesi.
    return false;
  }
}

/**
 * report_email -> pos_profile_id, kalau owner sudah memetakannya lewat
 * /team. null = belum ada pemetaan sama sekali -- pemanggil WAJIB
 * menampilkan pesan generik ("akun toko belum disiapkan"), TIDAK PERNAH
 * membedakan "email tidak terdaftar" dari kegagalan lain (lihat CLAUDE.md).
 */
export async function findPosProfileIdForReportEmail(reportEmail: string): Promise<string | null> {
  const db = getAdminDb();
  const [row] = await db
    .select({ posProfileId: reportIdentityLinks.posProfileId })
    .from(reportIdentityLinks)
    .where(eq(reportIdentityLinks.reportEmail, reportEmail));
  return row?.posProfileId ?? null;
}

/**
 * Bikin magic link Supabase sungguhan untuk profil pos-fnb yang sudah
 * dipetakan, lalu kembalikan action_link-nya SAJA -- tidak pernah
 * dikirim lewat email (generateLink cuma MEMBUAT tautannya, tidak
 * mengirim apa pun kalau dipanggil admin API langsung seperti ini).
 * Browser diarahkan LANGSUNG ke tautan ini oleh pemanggil.
 */
export async function createHandoffMagicLink(
  posProfileId: string,
  redirectTo: string
): Promise<string | null> {
  const admin = createSupabaseAdminClient();
  const { data: userData, error: userError } = await admin.auth.admin.getUserById(posProfileId);
  if (userError || !userData.user?.email) {
    return null;
  }
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: userData.user.email,
    options: { redirectTo },
  });
  if (error || !data.properties?.action_link) {
    return null;
  }
  return data.properties.action_link;
}
