"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import {
  deleteCategoryWithDb,
  saveCategoryWithDb,
  setCategoryActiveWithDb,
  type CategoryActionResult,
} from "@/lib/categories/manage";

export type { CategoryActionResult };

export type CategoryFormState = {
  error?: string;
};

/**
 * Pembungkus Server Action tipis -- logika sesungguhnya ada di
 * lib/categories/manage.ts (pola sama dengan
 * app/(dashboard)/employees/actions.ts).
 */
export async function saveCategory(
  _prevState: CategoryFormState,
  formData: FormData
): Promise<CategoryFormState> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "product.manage"
  );

  try {
    const result = await saveCategoryWithDb(db, businessId, {
      id: formData.get("id") || undefined,
      name: formData.get("name"),
      color: formData.get("color") || undefined,
      sortOrder: formData.get("sortOrder") || 0,
      scope: formData.get("scope") || "fnb",
    });
    if (result.error) {
      return { error: result.error };
    }
  } finally {
    await closeDb();
  }

  revalidatePath("/categories");
  return {};
}

export async function setCategoryActive(
  id: string,
  isActive: boolean
): Promise<CategoryActionResult> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "product.manage"
  );

  try {
    const result = await setCategoryActiveWithDb(db, businessId, { id, isActive });
    if (!result.error) {
      revalidatePath("/categories");
    }
    return result;
  } finally {
    await closeDb();
  }
}

export async function deleteCategory(id: string): Promise<CategoryActionResult> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "product.manage"
  );

  try {
    const result = await deleteCategoryWithDb(db, businessId, { id });
    if (!result.error) {
      revalidatePath("/categories");
    }
    return result;
  } finally {
    await closeDb();
  }
}
