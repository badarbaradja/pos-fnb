"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { modifierGroups } from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";
import { id as strings } from "@/lib/i18n/id";

const modifierGroupSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, strings.common.requiredField),
  minSelect: z.coerce.number().int().min(0),
  maxSelect: z.coerce.number().int().min(0),
  isRequired: z.coerce.boolean(),
});

export type ModifierGroupFormState = {
  error?: string;
};

export async function saveModifierGroup(
  _prevState: ModifierGroupFormState,
  formData: FormData
): Promise<ModifierGroupFormState> {
  const parsed = modifierGroupSchema.safeParse({
    id: formData.get("id") || undefined,
    name: formData.get("name"),
    minSelect: formData.get("minSelect") || 0,
    maxSelect: formData.get("maxSelect") || 1,
    isRequired: formData.get("isRequired") === "on",
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError,
    };
  }

  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "product.manage"
  );

  try {
    if (parsed.data.id) {
      // business_id difilter eksplisit juga -- RLS lapisan terakhir, bukan
      // satu-satunya (CLAUDE.md §3.4).
      await db
        .update(modifierGroups)
        .set({
          name: parsed.data.name,
          minSelect: parsed.data.minSelect,
          maxSelect: parsed.data.maxSelect,
          isRequired: parsed.data.isRequired,
        })
        .where(
          and(
            eq(modifierGroups.id, parsed.data.id),
            eq(modifierGroups.businessId, businessId)
          )
        );
    } else {
      await db.insert(modifierGroups).values({
        id: generateId(),
        businessId,
        name: parsed.data.name,
        minSelect: parsed.data.minSelect,
        maxSelect: parsed.data.maxSelect,
        isRequired: parsed.data.isRequired,
      });
    }
  } finally {
    await closeDb();
  }

  revalidatePath("/modifier-groups");
  return {};
}

export type SetModifierGroupActiveResult = { error?: string };

/**
 * Grup modifier TIDAK PERNAH dihapus (master data, CLAUDE.md §3.2), cuma
 * disembunyikan dari dialog pilih modifier di layar kasir
 * (get-pos-catalog.ts sudah filter isActive).
 */
export async function setModifierGroupActive(
  id: string,
  isActive: boolean
): Promise<SetModifierGroupActiveResult> {
  const parsed = z.object({ id: z.string().uuid(), isActive: z.boolean() }).safeParse({
    id,
    isActive,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }

  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "product.manage"
  );

  try {
    await db
      .update(modifierGroups)
      .set({ isActive: parsed.data.isActive })
      .where(
        and(
          eq(modifierGroups.id, parsed.data.id),
          eq(modifierGroups.businessId, businessId)
        )
      );
  } finally {
    await closeDb();
  }

  revalidatePath("/modifier-groups");
  return {};
}
