import type { SupabaseClient } from "@supabase/supabase-js";
import { requirePermission } from "./permissions";

export type OutletSummary = {
  id: string;
  name: string;
  businessId: string;
};

/**
 * Logika inti "daftar outlet milik bisnis saya" — dipisah dari Server
 * Action pembungkusnya (lib/auth/actions.ts) supaya bisa dites langsung
 * dengan client yang sudah terautentikasi (token asli), tanpa perlu
 * request Next.js sungguhan. Ini juga fungsi yang dipakai test isolasi
 * tenant untuk membuktikan jalur "Server Action" aman.
 */
export async function listMyOutletsWithClient(
  supabase: SupabaseClient
): Promise<OutletSummary[]> {
  const { businessId } = await requirePermission(supabase, "settings.business");

  const { data, error } = await supabase
    .from("outlets")
    .select("id, name, business_id")
    .eq("business_id", businessId);

  if (error) {
    throw error;
  }

  return (data ?? []).map((row) => ({
    id: row["id"] as string,
    name: row["name"] as string,
    businessId: row["business_id"] as string,
  }));
}
