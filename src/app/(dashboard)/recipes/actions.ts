"use server";

import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import {
  getRecipeDetail,
  saveRecipeWithDb,
  type RecipeDetail,
  type SaveRecipeResult,
} from "@/lib/recipes/manage";
import { id as strings } from "@/lib/i18n/id";
import { revalidatePath } from "next/cache";

export type GetRecipeDetailActionResult = { data?: RecipeDetail; error?: string };

export async function getRecipeDetailAction(productId: string): Promise<GetRecipeDetailActionResult> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "product.manage");
  try {
    const data = await getRecipeDetail(db, businessId, productId);
    return { data };
  } catch {
    return { error: strings.common.unexpectedError };
  } finally {
    await closeDb();
  }
}

export type SaveRecipeActionInput = {
  productId: string;
  items: {
    ingredientId: string;
    qty: number;
    isOptional: boolean;
    wastePercent: number;
  }[];
};

export async function saveRecipeAction(input: SaveRecipeActionInput): Promise<SaveRecipeResult> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "product.manage");
  try {
    const result = await saveRecipeWithDb(db, businessId, input);
    if (!result.error) {
      revalidatePath("/recipes");
    }
    return result;
  } finally {
    await closeDb();
  }
}
