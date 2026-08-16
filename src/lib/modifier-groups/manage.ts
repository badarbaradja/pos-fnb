import { z } from "zod";
import { and, count, eq } from "drizzle-orm";
import type { UserDbHandle } from "@/lib/db/client";
import { modifierGroups, modifiers, orderItemModifiers, productModifierGroups } from "@/lib/db/schema";
import { DeleteBlockedError } from "@/lib/db/errors";
import { generateId } from "@/lib/utils/id";
import { id as strings } from "@/lib/i18n/id";

/**
 * lib/modifier-groups/manage.ts — pola thin-wrapper sama lib/employees/
 * manage.ts/lib/devices/manage.ts. Diekstrak belakangan (audit kelengkapan
 * master data) supaya deleteModifierGroupWithDb -- penghapusan PERMANEN,
 * tak bisa diurungkan -- punya harness test sungguhan.
 */

type Db = UserDbHandle["db"];

const saveModifierGroupSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, strings.common.requiredField),
  minSelect: z.coerce.number().int().min(0),
  maxSelect: z.coerce.number().int().min(0),
  isRequired: z.coerce.boolean(),
});

export type ModifierGroupActionResult = {
  error?: string;
  success?: { modifierGroupId: string };
};

export async function saveModifierGroupWithDb(
  db: Db,
  businessId: string,
  rawInput: unknown
): Promise<ModifierGroupActionResult> {
  const parsed = saveModifierGroupSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const data = parsed.data;

  if (data.id) {
    // business_id difilter eksplisit juga -- RLS lapisan terakhir, bukan
    // satu-satunya (CLAUDE.md §3.4).
    await db
      .update(modifierGroups)
      .set({
        name: data.name,
        minSelect: data.minSelect,
        maxSelect: data.maxSelect,
        isRequired: data.isRequired,
      })
      .where(and(eq(modifierGroups.id, data.id), eq(modifierGroups.businessId, businessId)));
    return { success: { modifierGroupId: data.id } };
  }

  const modifierGroupId = generateId();
  await db.insert(modifierGroups).values({
    id: modifierGroupId,
    businessId,
    name: data.name,
    minSelect: data.minSelect,
    maxSelect: data.maxSelect,
    isRequired: data.isRequired,
  });
  return { success: { modifierGroupId } };
}

const setActiveSchema = z.object({ id: z.string().uuid(), isActive: z.boolean() });

/**
 * Grup modifier TIDAK PERNAH dihapus (master data, CLAUDE.md §3.2), cuma
 * disembunyikan dari dialog pilih modifier di layar kasir
 * (get-pos-catalog.ts sudah filter isActive).
 */
export async function setModifierGroupActiveWithDb(
  db: Db,
  businessId: string,
  rawInput: unknown
): Promise<ModifierGroupActionResult> {
  const parsed = setActiveSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const { id, isActive } = parsed.data;

  await db
    .update(modifierGroups)
    .set({ isActive })
    .where(and(eq(modifierGroups.id, id), eq(modifierGroups.businessId, businessId)));

  return { success: { modifierGroupId: id } };
}

const deleteSchema = z.object({ id: z.string().uuid() });

/**
 * Hapus permanen -- HANYA untuk grup yang belum pernah dipakai (audit
 * kelengkapan master data). Dua pengecualian: belum ditempel ke produk
 * manapun, DAN belum ada item modifier di dalamnya yang pernah dipesan
 * (modifiers CASCADE ikut terhapus, jadi kalau ada yang sudah dipesan itu
 * harus dicegah lebih dulu, bukan dibiarkan CASCADE diam-diam). Cek +
 * delete dalam SATU transaksi.
 */
export async function deleteModifierGroupWithDb(
  db: Db,
  businessId: string,
  rawInput: unknown
): Promise<ModifierGroupActionResult> {
  const parsed = deleteSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const { id } = parsed.data;

  try {
    await db.transaction(async (tx) => {
      const [assignedCount] = await tx
        .select({ n: count() })
        .from(productModifierGroups)
        .where(eq(productModifierGroups.modifierGroupId, id));
      if (assignedCount && assignedCount.n > 0) {
        throw new DeleteBlockedError(
          strings.modifierGroups.deleteBlockedProducts.replace(
            "{count}",
            String(assignedCount.n)
          )
        );
      }

      const [orderedCount] = await tx
        .select({ n: count() })
        .from(orderItemModifiers)
        .innerJoin(modifiers, eq(modifiers.id, orderItemModifiers.modifierId))
        .where(eq(modifiers.modifierGroupId, id));
      if (orderedCount && orderedCount.n > 0) {
        throw new DeleteBlockedError(
          strings.modifierGroups.deleteBlockedOrders.replace(
            "{count}",
            String(orderedCount.n)
          )
        );
      }

      await tx
        .delete(modifierGroups)
        .where(and(eq(modifierGroups.id, id), eq(modifierGroups.businessId, businessId)));
    });
  } catch (err) {
    if (err instanceof DeleteBlockedError) {
      return { error: err.message };
    }
    throw err;
  }

  return { success: { modifierGroupId: id } };
}
