"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import {
  deleteModifierWithDb,
  saveModifierWithDb,
  setModifierActiveWithDb,
  type ModifierActionResult,
} from "@/lib/modifiers/manage";

export type { ModifierActionResult };

export type ModifierFormState = {
  error?: string;
};

/**
 * Pembungkus Server Action tipis -- logika sesungguhnya ada di
 * lib/modifiers/manage.ts (pola sama dengan
 * app/(dashboard)/employees/actions.ts).
 */
export async function saveModifier(
  _prevState: ModifierFormState,
  formData: FormData
): Promise<ModifierFormState> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "product.manage"
  );

  const modifierGroupId = formData.get("modifierGroupId");

  try {
    const result = await saveModifierWithDb(db, businessId, {
      id: formData.get("id") || undefined,
      modifierGroupId,
      name: formData.get("name"),
      price: formData.get("price") || 0,
      sortOrder: formData.get("sortOrder") || 0,
    });
    if (result.error) {
      return { error: result.error };
    }
  } finally {
    await closeDb();
  }

  revalidatePath(`/modifier-groups/${modifierGroupId}`);
  return {};
}

export async function setModifierActive(
  id: string,
  modifierGroupId: string,
  isActive: boolean
): Promise<ModifierActionResult> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "product.manage"
  );

  try {
    const result = await setModifierActiveWithDb(db, businessId, {
      id,
      modifierGroupId,
      isActive,
    });
    if (!result.error) {
      revalidatePath(`/modifier-groups/${modifierGroupId}`);
    }
    return result;
  } finally {
    await closeDb();
  }
}

export async function deleteModifier(
  id: string,
  modifierGroupId: string
): Promise<ModifierActionResult> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "product.manage"
  );

  try {
    const result = await deleteModifierWithDb(db, businessId, { id, modifierGroupId });
    if (!result.error) {
      revalidatePath(`/modifier-groups/${modifierGroupId}`);
    }
    return result;
  } finally {
    await closeDb();
  }
}
