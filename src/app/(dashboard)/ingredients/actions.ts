"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import {
  createIngredientWithDb,
  deleteIngredientWithDb,
  setIngredientActiveWithDb,
  setIngredientHitungTiapShiftWithDb,
  updateIngredientWithDb,
  type IngredientActionResult,
} from "@/lib/ingredients/manage";

export type { IngredientActionResult };

export type IngredientFormState = {
  error?: string;
};

/**
 * Pembungkus Server Action tipis -- logika sesungguhnya ada di
 * lib/ingredients/manage.ts. Permission "product.manage" dipakai apa
 * adanya, sama seperti /units -- bahan adalah master data katalog, bukan
 * operasi stok harian.
 */
export async function saveIngredient(
  _prevState: IngredientFormState,
  formData: FormData
): Promise<IngredientFormState> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "product.manage");

  const id = formData.get("id");
  const input = {
    code: formData.get("code") || undefined,
    name: formData.get("name"),
    category: formData.get("category") || undefined,
    baseUnit: formData.get("baseUnit"),
    purchaseUnit: formData.get("purchaseUnit"),
    purchaseFactor: formData.get("purchaseFactor"),
    yieldPercent: formData.get("yieldPercent") || 100,
    isSemiFinished: formData.get("isSemiFinished") === "on",
    shelfLifeDays: formData.get("shelfLifeDays") || undefined,
  };

  try {
    let result: IngredientActionResult;
    if (typeof id === "string" && id) {
      result = await updateIngredientWithDb(db, businessId, { id, ...input });
    } else {
      result = await createIngredientWithDb(db, businessId, input);
    }

    if (result.error) {
      return { error: result.error };
    }
  } finally {
    await closeDb();
  }

  revalidatePath("/ingredients");
  return {};
}

export async function setIngredientActive(
  id: string,
  isActive: boolean
): Promise<IngredientActionResult> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "product.manage");

  try {
    const result = await setIngredientActiveWithDb(db, businessId, { id, isActive });
    if (!result.error) {
      revalidatePath("/ingredients");
    }
    return result;
  } finally {
    await closeDb();
  }
}

export async function setIngredientHitungTiapShift(
  id: string,
  hitungTiapShift: boolean
): Promise<IngredientActionResult> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "product.manage");

  try {
    const result = await setIngredientHitungTiapShiftWithDb(db, businessId, { id, hitungTiapShift });
    if (!result.error) {
      revalidatePath("/ingredients");
    }
    return result;
  } finally {
    await closeDb();
  }
}

export async function deleteIngredient(id: string): Promise<IngredientActionResult> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "product.manage");

  try {
    const result = await deleteIngredientWithDb(db, businessId, { id });
    if (!result.error) {
      revalidatePath("/ingredients");
    }
    return result;
  } finally {
    await closeDb();
  }
}
