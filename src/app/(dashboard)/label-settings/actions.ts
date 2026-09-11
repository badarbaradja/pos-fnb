"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { saveLabelSettingsWithDb } from "@/lib/labels/manage";

export type LabelSettingsFormState = {
  error?: string;
  success?: true;
};

/**
 * Pembungkus Server Action tipis -- logika di lib/labels/manage.ts.
 * "settings.business" (owner-only) -- pengaturan label satu baris per
 * bisnis, dampaknya ke semua label yang dicetak siapa pun, sama kelas
 * keputusan dengan pengaturan pajak/service charge outlet.
 */
export async function saveLabelSettings(
  _prevState: LabelSettingsFormState,
  formData: FormData
): Promise<LabelSettingsFormState> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "settings.business");

  try {
    const result = await saveLabelSettingsWithDb(db, businessId, {
      widthMm: formData.get("widthMm"),
      heightMm: formData.get("heightMm"),
      showBarcode: formData.get("showBarcode") === "on",
      showName: formData.get("showName") === "on",
      showPrice: formData.get("showPrice") === "on",
      showPemilikKode: formData.get("showPemilikKode") === "on",
      showUkuran: formData.get("showUkuran") === "on",
    });
    if (result.error) {
      return { error: result.error };
    }
  } finally {
    await closeDb();
  }

  revalidatePath("/label-settings");
  return { success: true };
}
