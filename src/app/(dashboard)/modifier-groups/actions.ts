"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import {
  deleteModifierGroupWithDb,
  saveModifierGroupWithDb,
  setModifierGroupActiveWithDb,
  type ModifierGroupActionResult,
} from "@/lib/modifier-groups/manage";

export type { ModifierGroupActionResult };

export type ModifierGroupFormState = {
  error?: string;
};

/**
 * Pembungkus Server Action tipis -- logika sesungguhnya ada di
 * lib/modifier-groups/manage.ts (pola sama dengan
 * app/(dashboard)/employees/actions.ts).
 */
export async function saveModifierGroup(
  _prevState: ModifierGroupFormState,
  formData: FormData
): Promise<ModifierGroupFormState> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "product.manage"
  );

  try {
    const result = await saveModifierGroupWithDb(db, businessId, {
      id: formData.get("id") || undefined,
      name: formData.get("name"),
      minSelect: formData.get("minSelect") || 0,
      maxSelect: formData.get("maxSelect") || 1,
      isRequired: formData.get("isRequired") === "on",
    });
    if (result.error) {
      return { error: result.error };
    }
  } finally {
    await closeDb();
  }

  revalidatePath("/modifier-groups");
  return {};
}

export async function setModifierGroupActive(
  id: string,
  isActive: boolean
): Promise<ModifierGroupActionResult> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "product.manage"
  );

  try {
    const result = await setModifierGroupActiveWithDb(db, businessId, { id, isActive });
    if (!result.error) {
      revalidatePath("/modifier-groups");
    }
    return result;
  } finally {
    await closeDb();
  }
}

export async function deleteModifierGroup(id: string): Promise<ModifierGroupActionResult> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "product.manage"
  );

  try {
    const result = await deleteModifierGroupWithDb(db, businessId, { id });
    if (!result.error) {
      revalidatePath("/modifier-groups");
    }
    return result;
  } finally {
    await closeDb();
  }
}
