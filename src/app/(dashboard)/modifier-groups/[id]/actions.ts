"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, count, eq } from "drizzle-orm";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { modifierGroups, modifiers, orderItemModifiers } from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";
import { DeleteBlockedError } from "@/lib/db/errors";
import { id as strings } from "@/lib/i18n/id";

const modifierSchema = z.object({
  id: z.string().uuid().optional(),
  modifierGroupId: z.string().uuid(),
  name: z.string().trim().min(1, strings.common.requiredField),
  price: z.coerce.number(),
  sortOrder: z.coerce.number().int(),
});

export type ModifierFormState = {
  error?: string;
};

export async function saveModifier(
  _prevState: ModifierFormState,
  formData: FormData
): Promise<ModifierFormState> {
  const parsed = modifierSchema.safeParse({
    id: formData.get("id") || undefined,
    modifierGroupId: formData.get("modifierGroupId"),
    name: formData.get("name"),
    price: formData.get("price") || 0,
    sortOrder: formData.get("sortOrder") || 0,
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
    // business_id difilter eksplisit lewat parent modifier_groups -- RLS
    // lapisan terakhir, bukan satu-satunya (CLAUDE.md §3.4). Tabel modifiers
    // sendiri tidak punya business_id (lihat docs/04-CATATAN-TEKNIS.md §7).
    const [group] = await db
      .select({ id: modifierGroups.id })
      .from(modifierGroups)
      .where(
        and(
          eq(modifierGroups.id, parsed.data.modifierGroupId),
          eq(modifierGroups.businessId, businessId)
        )
      );
    if (!group) {
      return { error: strings.common.unexpectedError };
    }

    if (parsed.data.id) {
      await db
        .update(modifiers)
        .set({
          name: parsed.data.name,
          price: String(parsed.data.price),
          sortOrder: parsed.data.sortOrder,
        })
        .where(
          and(
            eq(modifiers.id, parsed.data.id),
            eq(modifiers.modifierGroupId, parsed.data.modifierGroupId)
          )
        );
    } else {
      await db.insert(modifiers).values({
        id: generateId(),
        modifierGroupId: parsed.data.modifierGroupId,
        name: parsed.data.name,
        price: String(parsed.data.price),
        sortOrder: parsed.data.sortOrder,
      });
    }
  } finally {
    await closeDb();
  }

  revalidatePath(`/modifier-groups/${parsed.data.modifierGroupId}`);
  return {};
}

export type DeleteModifierResult = { error?: string };

/**
 * Hapus permanen -- HANYA untuk item modifier yang belum pernah dipesan
 * (audit kelengkapan master data). Cek + delete dalam SATU transaksi.
 */
export async function deleteModifier(
  id: string,
  modifierGroupId: string
): Promise<DeleteModifierResult> {
  const parsed = z
    .object({ id: z.string().uuid(), modifierGroupId: z.string().uuid() })
    .safeParse({ id, modifierGroupId });
  if (!parsed.success) {
    return { error: strings.common.unexpectedError };
  }

  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "product.manage"
  );

  try {
    await db.transaction(async (tx) => {
      // business_id difilter eksplisit lewat parent modifier_groups -- RLS
      // lapisan terakhir, bukan satu-satunya (CLAUDE.md §3.4).
      const [group] = await tx
        .select({ id: modifierGroups.id })
        .from(modifierGroups)
        .where(
          and(
            eq(modifierGroups.id, parsed.data.modifierGroupId),
            eq(modifierGroups.businessId, businessId)
          )
        );
      if (!group) {
        throw new DeleteBlockedError(strings.common.unexpectedError);
      }

      const [orderedCount] = await tx
        .select({ n: count() })
        .from(orderItemModifiers)
        .where(eq(orderItemModifiers.modifierId, parsed.data.id));
      if (orderedCount && orderedCount.n > 0) {
        throw new DeleteBlockedError(strings.modifiers.deleteBlockedOrders);
      }

      await tx
        .delete(modifiers)
        .where(
          and(
            eq(modifiers.id, parsed.data.id),
            eq(modifiers.modifierGroupId, parsed.data.modifierGroupId)
          )
        );
    });
  } catch (err) {
    if (err instanceof DeleteBlockedError) {
      return { error: err.message };
    }
    throw err;
  } finally {
    await closeDb();
  }

  revalidatePath(`/modifier-groups/${parsed.data.modifierGroupId}`);
  return {};
}

export type SetModifierActiveResult = { error?: string };

/**
 * Modifier TIDAK PERNAH dihapus (master data, CLAUDE.md §3.2), cuma
 * disembunyikan dari dialog pilih modifier di layar kasir
 * (get-pos-catalog.ts sudah filter isActive).
 */
export async function setModifierActive(
  id: string,
  modifierGroupId: string,
  isActive: boolean
): Promise<SetModifierActiveResult> {
  const parsed = z
    .object({ id: z.string().uuid(), modifierGroupId: z.string().uuid(), isActive: z.boolean() })
    .safeParse({ id, modifierGroupId, isActive });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }

  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "product.manage"
  );

  try {
    // business_id difilter eksplisit lewat parent modifier_groups -- RLS
    // lapisan terakhir, bukan satu-satunya (CLAUDE.md §3.4).
    const [group] = await db
      .select({ id: modifierGroups.id })
      .from(modifierGroups)
      .where(
        and(
          eq(modifierGroups.id, parsed.data.modifierGroupId),
          eq(modifierGroups.businessId, businessId)
        )
      );
    if (!group) {
      return { error: strings.common.unexpectedError };
    }

    await db
      .update(modifiers)
      .set({ isActive: parsed.data.isActive })
      .where(
        and(
          eq(modifiers.id, parsed.data.id),
          eq(modifiers.modifierGroupId, parsed.data.modifierGroupId)
        )
      );
  } finally {
    await closeDb();
  }

  revalidatePath(`/modifier-groups/${parsed.data.modifierGroupId}`);
  return {};
}
