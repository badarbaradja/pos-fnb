"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import {
  deletePriceTierWithDb,
  savePriceTierWithDb,
  setPriceTierActiveWithDb,
  type PriceTierActionResult,
} from "@/lib/price-tiers/manage";

export type { PriceTierActionResult };

export type PriceTierFormState = {
  error?: string;
};

/**
 * Pembungkus Server Action tipis -- logika sesungguhnya ada di
 * lib/price-tiers/manage.ts (pola sama dengan
 * app/(dashboard)/employees/actions.ts).
 */
export async function savePriceTier(
  _prevState: PriceTierFormState,
  formData: FormData
): Promise<PriceTierFormState> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "price.manage"
  );

  try {
    const result = await savePriceTierWithDb(db, businessId, {
      id: formData.get("id") || undefined,
      code: formData.get("code"),
      name: formData.get("name"),
      channel: formData.get("channel") || undefined,
      markupPercent: formData.get("markupPercent") || 0,
      isDefault: formData.get("isDefault") === "on",
    });
    if (result.error) {
      return { error: result.error };
    }
  } finally {
    await closeDb();
  }

  revalidatePath("/price-tiers");
  return {};
}

export async function setPriceTierActive(
  id: string,
  isActive: boolean
): Promise<PriceTierActionResult> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "price.manage"
  );

  try {
    const result = await setPriceTierActiveWithDb(db, businessId, { id, isActive });
    if (!result.error) {
      revalidatePath("/price-tiers");
    }
    return result;
  } finally {
    await closeDb();
  }
}

export async function deletePriceTier(id: string): Promise<PriceTierActionResult> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "price.manage"
  );

  try {
    const result = await deletePriceTierWithDb(db, businessId, { id });
    if (!result.error) {
      revalidatePath("/price-tiers");
    }
    return result;
  } finally {
    await closeDb();
  }
}
