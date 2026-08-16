import { z } from "zod";
import { and, count, eq } from "drizzle-orm";
import type { UserDbHandle } from "@/lib/db/client";
import { categories, products } from "@/lib/db/schema";
import { DeleteBlockedError } from "@/lib/db/errors";
import { generateId } from "@/lib/utils/id";
import { id as strings } from "@/lib/i18n/id";

/**
 * lib/categories/manage.ts — pola thin-wrapper sama lib/employees/manage.ts/
 * lib/devices/manage.ts (fungsi murni (db, businessId, input) => result,
 * testable tanpa request Next.js sungguhan, dipisah dari Server Action
 * pembungkus di app/(dashboard)/categories/actions.ts). Diekstrak belakangan
 * (audit kelengkapan master data) supaya deleteCategoryWithDb -- penghapusan
 * PERMANEN, satu-satunya operasi tak bisa diurungkan di seluruh sistem --
 * punya harness test sungguhan, bukan cuma dipercaya lewat pembacaan kode.
 */

type Db = UserDbHandle["db"];

const saveCategorySchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, strings.common.requiredField),
  color: z.string().trim().optional(),
  sortOrder: z.coerce.number().int(),
});

export type CategoryActionResult = {
  error?: string;
  success?: { categoryId: string };
};

export async function saveCategoryWithDb(
  db: Db,
  businessId: string,
  rawInput: unknown
): Promise<CategoryActionResult> {
  const parsed = saveCategorySchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const data = parsed.data;

  if (data.id) {
    // business_id difilter eksplisit juga -- RLS lapisan terakhir, bukan
    // satu-satunya (CLAUDE.md §3.4).
    await db
      .update(categories)
      .set({ name: data.name, color: data.color ?? null, sortOrder: data.sortOrder })
      .where(and(eq(categories.id, data.id), eq(categories.businessId, businessId)));
    return { success: { categoryId: data.id } };
  }

  const categoryId = generateId();
  await db.insert(categories).values({
    id: categoryId,
    businessId,
    name: data.name,
    color: data.color ?? null,
    sortOrder: data.sortOrder,
  });
  return { success: { categoryId } };
}

const setActiveSchema = z.object({ id: z.string().uuid(), isActive: z.boolean() });

/**
 * Kategori TIDAK PERNAH dihapus (master data, CLAUDE.md §3.2), cuma
 * disembunyikan dari chip filter di layar kasir (get-pos-catalog.ts sudah
 * filter isActive).
 */
export async function setCategoryActiveWithDb(
  db: Db,
  businessId: string,
  rawInput: unknown
): Promise<CategoryActionResult> {
  const parsed = setActiveSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const { id, isActive } = parsed.data;

  await db
    .update(categories)
    .set({ isActive })
    .where(and(eq(categories.id, id), eq(categories.businessId, businessId)));

  return { success: { categoryId: id } };
}

const deleteSchema = z.object({ id: z.string().uuid() });

/**
 * Hapus permanen -- HANYA untuk kategori yang belum pernah dipakai (audit
 * kelengkapan master data). Cek referensi + delete dalam SATU transaksi
 * (bukan dua round-trip terpisah) supaya tidak ada celah balapan antara
 * cek dan hapus. Kalau masih dipakai, DeleteBlockedError membatalkan
 * transaksi dan pesannya (menyebutkan apa yang menghalangi) dikirim balik
 * ke user apa adanya.
 */
export async function deleteCategoryWithDb(
  db: Db,
  businessId: string,
  rawInput: unknown
): Promise<CategoryActionResult> {
  const parsed = deleteSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const { id } = parsed.data;

  try {
    await db.transaction(async (tx) => {
      const [productCount] = await tx
        .select({ n: count() })
        .from(products)
        .where(eq(products.categoryId, id));
      if (productCount && productCount.n > 0) {
        throw new DeleteBlockedError(
          strings.categories.deleteBlockedProducts.replace("{count}", String(productCount.n))
        );
      }

      const [childCount] = await tx
        .select({ n: count() })
        .from(categories)
        .where(eq(categories.parentId, id));
      if (childCount && childCount.n > 0) {
        throw new DeleteBlockedError(
          strings.categories.deleteBlockedChildren.replace("{count}", String(childCount.n))
        );
      }

      await tx
        .delete(categories)
        .where(and(eq(categories.id, id), eq(categories.businessId, businessId)));
    });
  } catch (err) {
    if (err instanceof DeleteBlockedError) {
      return { error: err.message };
    }
    throw err;
  }

  return { success: { categoryId: id } };
}
