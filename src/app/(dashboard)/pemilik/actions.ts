"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import {
  savePemilikWithDb,
  setPemilikActiveWithDb,
  type PemilikActionResult,
} from "@/lib/pemilik/manage";

export type { PemilikActionResult };

export type PemilikFormState = {
  error?: string;
  success?: { pemilikId: string };
};

/**
 * Pembungkus Server Action tipis -- logika sesungguhnya ada di
 * lib/pemilik/manage.ts (pola sama app/(dashboard)/payment-methods/actions.ts).
 * Gerbang "pemilik.manage" (owner on, manajer off/bisa-diaktifkan, staf lain
 * na -- lihat lib/auth/permissions.ts).
 */
export async function savePemilik(
  _prevState: PemilikFormState,
  formData: FormData
): Promise<PemilikFormState> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "pemilik.manage"
  );

  try {
    const result = await savePemilikWithDb(db, businessId, {
      id: formData.get("id") || undefined,
      kode: formData.get("kode") || undefined,
      nama: formData.get("nama"),
      kontak: formData.get("kontak") || undefined,
      persenBagi: formData.get("persenBagi") || 60,
      catatan: formData.get("catatan") || undefined,
    });
    if (result.error) {
      return { error: result.error };
    }
    revalidatePath("/pemilik");
    return { success: result.success };
  } finally {
    await closeDb();
  }
}

export async function setPemilikActive(
  id: string,
  isActive: boolean
): Promise<PemilikActionResult> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "pemilik.manage"
  );

  try {
    const result = await setPemilikActiveWithDb(db, businessId, { id, isActive });
    if (!result.error) {
      revalidatePath("/pemilik");
    }
    return result;
  } finally {
    await closeDb();
  }
}
