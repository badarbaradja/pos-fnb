"use server";

import { createServerSupabaseClient } from "./supabase";
import { listMyOutletsWithClient, type OutletSummary } from "./outlets";

/**
 * Server Action nyata: daftar outlet milik bisnis user yang login.
 * Pembungkus tipis di atas listMyOutletsWithClient() — baca sesi dari
 * cookie request Next.js sungguhan, lalu delegasikan ke logika inti yang
 * sama dipakai test integrasi.
 */
export async function listMyOutlets(): Promise<OutletSummary[]> {
  const supabase = await createServerSupabaseClient();
  return listMyOutletsWithClient(supabase);
}
