"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, count, eq } from "drizzle-orm";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { categories, products } from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";
import { DeleteBlockedError } from "@/lib/db/errors";
import { id as strings } from "@/lib/i18n/id";

const categorySchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, strings.common.requiredField),
  color: z.string().trim().optional(),
  sortOrder: z.coerce.number().int(),
});

export type CategoryFormState = {
  error?: string;
};

export async function saveCategory(
  _prevState: CategoryFormState,
  formData: FormData
): Promise<CategoryFormState> {
  const parsed = categorySchema.safeParse({
    id: formData.get("id") || undefined,
    name: formData.get("name"),
    color: formData.get("color") || undefined,
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
    if (parsed.data.id) {
      // business_id difilter eksplisit juga -- RLS lapisan terakhir, bukan
      // satu-satunya (CLAUDE.md §3.4).
      await db
        .update(categories)
        .set({
          name: parsed.data.name,
          color: parsed.data.color ?? null,
          sortOrder: parsed.data.sortOrder,
        })
        .where(
          and(eq(categories.id, parsed.data.id), eq(categories.businessId, businessId))
        );
    } else {
      await db.insert(categories).values({
        id: generateId(),
        businessId,
        name: parsed.data.name,
        color: parsed.data.color ?? null,
        sortOrder: parsed.data.sortOrder,
      });
    }
  } finally {
    await closeDb();
  }

  revalidatePath("/categories");
  return {};
}

export type DeleteCategoryResult = { error?: string };

/**
 * Hapus permanen -- HANYA untuk kategori yang belum pernah dipakai (audit
 * kelengkapan master data). Cek referensi + delete dalam SATU transaksi
 * (bukan dua round-trip terpisah) supaya tidak ada celah balapan antara
 * cek dan hapus. Kalau masih dipakai, DeleteBlockedError membatalkan
 * transaksi dan pesannya (menyebutkan apa yang menghalangi) dikirim balik
 * ke user apa adanya.
 */
export async function deleteCategory(id: string): Promise<DeleteCategoryResult> {
  const parsed = z.string().uuid().safeParse(id);
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
      const [productCount] = await tx
        .select({ n: count() })
        .from(products)
        .where(eq(products.categoryId, parsed.data));
      if (productCount && productCount.n > 0) {
        throw new DeleteBlockedError(
          strings.categories.deleteBlockedProducts.replace(
            "{count}",
            String(productCount.n)
          )
        );
      }

      const [childCount] = await tx
        .select({ n: count() })
        .from(categories)
        .where(eq(categories.parentId, parsed.data));
      if (childCount && childCount.n > 0) {
        throw new DeleteBlockedError(strings.categories.deleteBlockedChildren);
      }

      await tx
        .delete(categories)
        .where(and(eq(categories.id, parsed.data), eq(categories.businessId, businessId)));
    });
  } catch (err) {
    if (err instanceof DeleteBlockedError) {
      return { error: err.message };
    }
    throw err;
  } finally {
    await closeDb();
  }

  revalidatePath("/categories");
  return {};
}

export type SetCategoryActiveResult = { error?: string };

/**
 * Kategori TIDAK PERNAH dihapus (master data, CLAUDE.md §3.2), cuma
 * disembunyikan dari chip filter di layar kasir (get-pos-catalog.ts sudah
 * filter isActive).
 */
export async function setCategoryActive(
  id: string,
  isActive: boolean
): Promise<SetCategoryActiveResult> {
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
      .update(categories)
      .set({ isActive: parsed.data.isActive })
      .where(and(eq(categories.id, parsed.data.id), eq(categories.businessId, businessId)));
  } finally {
    await closeDb();
  }

  revalidatePath("/categories");
  return {};
}
