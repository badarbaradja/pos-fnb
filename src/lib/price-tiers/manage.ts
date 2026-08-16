import { z } from "zod";
import { and, count, eq } from "drizzle-orm";
import type { UserDbHandle } from "@/lib/db/client";
import { orders, priceTiers, productPrices } from "@/lib/db/schema";
import { DeleteBlockedError, isUniqueViolation } from "@/lib/db/errors";
import { generateId } from "@/lib/utils/id";
import { id as strings } from "@/lib/i18n/id";

/**
 * lib/price-tiers/manage.ts — pola thin-wrapper sama lib/employees/
 * manage.ts/lib/devices/manage.ts. Diekstrak belakangan (audit kelengkapan
 * master data) supaya deletePriceTierWithDb -- penghapusan PERMANEN, tak
 * bisa diurungkan -- punya harness test sungguhan.
 */

type Db = UserDbHandle["db"];

const savePriceTierSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().trim().min(1, strings.common.requiredField),
  name: z.string().trim().min(1, strings.common.requiredField),
  channel: z.string().trim().optional(),
  markupPercent: z.coerce.number(),
  isDefault: z.coerce.boolean(),
});

export type PriceTierActionResult = {
  error?: string;
  success?: { priceTierId: string };
};

export async function savePriceTierWithDb(
  db: Db,
  businessId: string,
  rawInput: unknown
): Promise<PriceTierActionResult> {
  const parsed = savePriceTierSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const data = parsed.data;

  try {
    if (data.id) {
      // business_id difilter eksplisit juga -- RLS lapisan terakhir, bukan
      // satu-satunya (CLAUDE.md §3.4).
      await db
        .update(priceTiers)
        .set({
          code: data.code,
          name: data.name,
          channel: data.channel ?? null,
          markupPercent: String(data.markupPercent),
          isDefault: data.isDefault,
        })
        .where(and(eq(priceTiers.id, data.id), eq(priceTiers.businessId, businessId)));
      return { success: { priceTierId: data.id } };
    }

    const priceTierId = generateId();
    await db.insert(priceTiers).values({
      id: priceTierId,
      businessId,
      code: data.code,
      name: data.name,
      channel: data.channel ?? null,
      markupPercent: String(data.markupPercent),
      isDefault: data.isDefault,
    });
    return { success: { priceTierId } };
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { error: strings.priceTiers.duplicateCode };
    }
    throw err;
  }
}

const setActiveSchema = z.object({ id: z.string().uuid(), isActive: z.boolean() });

/**
 * Tier TIDAK PERNAH dihapus (master data, CLAUDE.md §3.2), cuma
 * disembunyikan dari selector kasir (get-pos-catalog.ts) supaya bisa
 * diaktifkan lagi kalau nanti dipakai lagi (mis. mulai jualan GoFood).
 */
export async function setPriceTierActiveWithDb(
  db: Db,
  businessId: string,
  rawInput: unknown
): Promise<PriceTierActionResult> {
  const parsed = setActiveSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const { id, isActive } = parsed.data;

  await db
    .update(priceTiers)
    .set({ isActive })
    .where(and(eq(priceTiers.id, id), eq(priceTiers.businessId, businessId)));

  return { success: { priceTierId: id } };
}

const deleteSchema = z.object({ id: z.string().uuid() });

/**
 * Hapus permanen -- HANYA untuk tier yang belum pernah dipakai (audit
 * kelengkapan master data). Dua pengecualian: belum ada harga produk di
 * tier ini, DAN belum pernah dipakai di order manapun (product_prices
 * CASCADE ikut terhapus, jadi kalau tier-nya sudah pernah dipakai jualan
 * itu harus dicegah lebih dulu, bukan dibiarkan CASCADE diam-diam). Cek +
 * delete dalam SATU transaksi.
 */
export async function deletePriceTierWithDb(
  db: Db,
  businessId: string,
  rawInput: unknown
): Promise<PriceTierActionResult> {
  const parsed = deleteSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const { id } = parsed.data;

  try {
    await db.transaction(async (tx) => {
      const [priceCount] = await tx
        .select({ n: count() })
        .from(productPrices)
        .where(eq(productPrices.priceTierId, id));
      if (priceCount && priceCount.n > 0) {
        throw new DeleteBlockedError(
          strings.priceTiers.deleteBlockedPrices.replace("{count}", String(priceCount.n))
        );
      }

      const [orderCount] = await tx
        .select({ n: count() })
        .from(orders)
        .where(eq(orders.priceTierId, id));
      if (orderCount && orderCount.n > 0) {
        throw new DeleteBlockedError(
          strings.priceTiers.deleteBlockedOrders.replace("{count}", String(orderCount.n))
        );
      }

      await tx
        .delete(priceTiers)
        .where(and(eq(priceTiers.id, id), eq(priceTiers.businessId, businessId)));
    });
  } catch (err) {
    if (err instanceof DeleteBlockedError) {
      return { error: err.message };
    }
    throw err;
  }

  return { success: { priceTierId: id } };
}
