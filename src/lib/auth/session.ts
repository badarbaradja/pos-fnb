import type { SupabaseClient } from "@supabase/supabase-js";
import { userRoleEnum } from "../db/schema";
import { createServerSupabaseClient } from "./supabase";

export type UserRole = (typeof userRoleEnum.enumValues)[number];

export type CurrentSession = {
  userId: string;
  email: string | null;
};

export type CurrentBusiness = {
  businessId: string;
  role: UserRole;
};

/**
 * getSession() — sesi Supabase Auth user yang login (owner/manajer/dll).
 * BUKAN untuk sesi PIN kasir — itu konsep terpisah, lihat lib/auth/pin.ts.
 *
 * Sengaja pakai supabase.auth.getUser(), bukan getSession(). getSession()
 * cuma baca JWT dari cookie tanpa verifikasi ke server (bisa dipalsukan
 * kalau cookie di-tempering); getUser() memvalidasi ke Supabase Auth.
 * Nama fungsi tetap getSession() sesuai konvensi yang diminta — isinya
 * yang aman.
 */
export async function getSession(): Promise<CurrentSession | null> {
  const supabase = await createServerSupabaseClient();
  return getSessionFromClient(supabase);
}

/**
 * Varian testable dari getSession() — menerima client eksplisit supaya bisa
 * dipanggil dari test (client dari token asli), bukan cuma dari request
 * Next.js sungguhan (yang butuh next/headers).
 */
export async function getSessionFromClient(
  supabase: SupabaseClient
): Promise<CurrentSession | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return null;
  }
  return { userId: data.user.id, email: data.user.email ?? null };
}

/**
 * getCurrentBusiness() — bisnis aktif user yang login, dari membership
 * pertama yang aktif. Belum ada mekanisme "pilih bisnis aktif" (cookie/
 * switcher) untuk user dengan banyak membership — di luar cakupan T07,
 * defaultnya membership aktif pertama yang RLS izinkan lihat.
 */
export async function getCurrentBusiness(): Promise<CurrentBusiness | null> {
  const supabase = await createServerSupabaseClient();
  const session = await getSessionFromClient(supabase);
  if (!session) {
    return null;
  }
  return getCurrentBusinessFromClient(supabase, session.userId);
}

export async function getCurrentBusinessFromClient(
  supabase: SupabaseClient,
  userId: string
): Promise<CurrentBusiness | null> {
  const { data, error } = await supabase
    .from("memberships")
    .select("business_id, role")
    .eq("user_id", userId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return null;
  }
  return { businessId: data.business_id as string, role: data.role as UserRole };
}
