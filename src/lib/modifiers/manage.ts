import { z } from "zod";
import { and, count, eq } from "drizzle-orm";
import type { UserDbHandle } from "@/lib/db/client";
import { modifierGroups, modifiers, orderItemModifiers } from "@/lib/db/schema";
import { DeleteBlockedError } from "@/lib/db/errors";
import { generateId } from "@/lib/utils/id";
import { id as strings } from "@/lib/i18n/id";

/**
 * lib/modifiers/manage.ts — pola thin-wrapper sama lib/employees/manage.ts/
 * lib/devices/manage.ts. Diekstrak belakangan (audit kelengkapan master
 * data) supaya deleteModifierWithDb -- penghapusan PERMANEN, tak bisa
 * diurungkan -- punya harness test sungguhan.
 *
 * Modifiers TIDAK punya business_id sendiri (anak modifier_groups, lihat
 * docs/04-CATATAN-TEKNIS.md §7) -- setiap fungsi di sini verifikasi
 * kepemilikan modifierGroupId ke businessId secara eksplisit, RLS lapisan
 * terakhir bukan satu-satunya (CLAUDE.md §3.4).
 */

type Db = UserDbHandle["db"];

const saveModifierSchema = z.object({
  id: z.string().uuid().optional(),
  modifierGroupId: z.string().uuid(),
  name: z.string().trim().min(1, strings.common.requiredField),
  price: z.coerce.number(),
  sortOrder: z.coerce.number().int(),
});

export type ModifierActionResult = {
  error?: string;
  success?: { modifierId: string };
};

async function assertOwnsModifierGroup(
  db: Db,
  businessId: string,
  modifierGroupId: string
): Promise<boolean> {
  const [group] = await db
    .select({ id: modifierGroups.id })
    .from(modifierGroups)
    .where(and(eq(modifierGroups.id, modifierGroupId), eq(modifierGroups.businessId, businessId)));
  return Boolean(group);
}

export async function saveModifierWithDb(
  db: Db,
  businessId: string,
  rawInput: unknown
): Promise<ModifierActionResult> {
  const parsed = saveModifierSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const data = parsed.data;

  if (!(await assertOwnsModifierGroup(db, businessId, data.modifierGroupId))) {
    return { error: strings.common.unexpectedError };
  }

  if (data.id) {
    await db
      .update(modifiers)
      .set({ name: data.name, price: String(data.price), sortOrder: data.sortOrder })
      .where(and(eq(modifiers.id, data.id), eq(modifiers.modifierGroupId, data.modifierGroupId)));
    return { success: { modifierId: data.id } };
  }

  const modifierId = generateId();
  await db.insert(modifiers).values({
    id: modifierId,
    modifierGroupId: data.modifierGroupId,
    name: data.name,
    price: String(data.price),
    sortOrder: data.sortOrder,
  });
  return { success: { modifierId } };
}

const setActiveSchema = z.object({
  id: z.string().uuid(),
  modifierGroupId: z.string().uuid(),
  isActive: z.boolean(),
});

/**
 * Modifier TIDAK PERNAH dihapus (master data, CLAUDE.md §3.2), cuma
 * disembunyikan dari dialog pilih modifier di layar kasir
 * (get-pos-catalog.ts sudah filter isActive).
 */
export async function setModifierActiveWithDb(
  db: Db,
  businessId: string,
  rawInput: unknown
): Promise<ModifierActionResult> {
  const parsed = setActiveSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const { id, modifierGroupId, isActive } = parsed.data;

  if (!(await assertOwnsModifierGroup(db, businessId, modifierGroupId))) {
    return { error: strings.common.unexpectedError };
  }

  await db
    .update(modifiers)
    .set({ isActive })
    .where(and(eq(modifiers.id, id), eq(modifiers.modifierGroupId, modifierGroupId)));

  return { success: { modifierId: id } };
}

const deleteSchema = z.object({ id: z.string().uuid(), modifierGroupId: z.string().uuid() });

/**
 * Hapus permanen -- HANYA untuk item modifier yang belum pernah dipesan
 * (audit kelengkapan master data). Cek + delete dalam SATU transaksi.
 */
export async function deleteModifierWithDb(
  db: Db,
  businessId: string,
  rawInput: unknown
): Promise<ModifierActionResult> {
  const parsed = deleteSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const { id, modifierGroupId } = parsed.data;

  try {
    await db.transaction(async (tx) => {
      const [group] = await tx
        .select({ id: modifierGroups.id })
        .from(modifierGroups)
        .where(
          and(eq(modifierGroups.id, modifierGroupId), eq(modifierGroups.businessId, businessId))
        );
      if (!group) {
        throw new DeleteBlockedError(strings.common.unexpectedError);
      }

      const [orderedCount] = await tx
        .select({ n: count() })
        .from(orderItemModifiers)
        .where(eq(orderItemModifiers.modifierId, id));
      if (orderedCount && orderedCount.n > 0) {
        throw new DeleteBlockedError(
          strings.modifiers.deleteBlockedOrders.replace("{count}", String(orderedCount.n))
        );
      }

      await tx
        .delete(modifiers)
        .where(and(eq(modifiers.id, id), eq(modifiers.modifierGroupId, modifierGroupId)));
    });
  } catch (err) {
    if (err instanceof DeleteBlockedError) {
      return { error: err.message };
    }
    throw err;
  }

  return { success: { modifierId: id } };
}
