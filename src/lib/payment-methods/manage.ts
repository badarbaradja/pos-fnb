import { z } from "zod";
import { and, count, eq } from "drizzle-orm";
import type { UserDbHandle } from "@/lib/db/client";
import { paymentMethods, payments } from "@/lib/db/schema";
import { assertRowsAffected, DeleteBlockedError, isUniqueViolation } from "@/lib/db/errors";
import { generateId } from "@/lib/utils/id";
import { id as strings } from "@/lib/i18n/id";

/**
 * lib/payment-methods/manage.ts — pola thin-wrapper sama lib/employees/
 * manage.ts/lib/devices/manage.ts. Diekstrak belakangan (audit kelengkapan
 * master data) supaya deletePaymentMethodWithDb -- penghapusan PERMANEN,
 * tak bisa diurungkan -- punya harness test sungguhan.
 */

type Db = UserDbHandle["db"];

export const paymentMethodTypeValues = [
  "cash",
  "card",
  "ewallet",
  "qris",
  "transfer",
  "voucher",
  "credit",
] as const;

const savePaymentMethodSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().trim().min(1, strings.common.requiredField),
  name: z.string().trim().min(1, strings.common.requiredField),
  type: z.enum(paymentMethodTypeValues),
  mdrPercent: z.coerce.number().min(0),
  isCashDrawer: z.coerce.boolean(),
  requiresRef: z.coerce.boolean(),
  sortOrder: z.coerce.number().int(),
});

export type PaymentMethodActionResult = {
  error?: string;
  success?: { paymentMethodId: string };
};

export async function savePaymentMethodWithDb(
  db: Db,
  businessId: string,
  rawInput: unknown
): Promise<PaymentMethodActionResult> {
  const parsed = savePaymentMethodSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const data = parsed.data;

  try {
    if (data.id) {
      // business_id difilter eksplisit juga -- RLS lapisan terakhir, bukan
      // satu-satunya (CLAUDE.md §3.4).
      const updated = await db
        .update(paymentMethods)
        .set({
          code: data.code,
          name: data.name,
          type: data.type,
          mdrPercent: String(data.mdrPercent),
          isCashDrawer: data.isCashDrawer,
          requiresRef: data.requiresRef,
          sortOrder: data.sortOrder,
        })
        .where(and(eq(paymentMethods.id, data.id), eq(paymentMethods.businessId, businessId)))
        .returning({ id: paymentMethods.id });
      assertRowsAffected(updated, "metode pembayaran");
      return { success: { paymentMethodId: data.id } };
    }

    const paymentMethodId = generateId();
    await db.insert(paymentMethods).values({
      id: paymentMethodId,
      businessId,
      code: data.code,
      name: data.name,
      type: data.type,
      mdrPercent: String(data.mdrPercent),
      isCashDrawer: data.isCashDrawer,
      requiresRef: data.requiresRef,
      sortOrder: data.sortOrder,
    });
    return { success: { paymentMethodId } };
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { error: strings.paymentMethods.duplicateCode };
    }
    throw err;
  }
}

const setActiveSchema = z.object({ id: z.string().uuid(), isActive: z.boolean() });

/**
 * Tombol nonaktifkan/aktifkan terpisah dari form edit -- metode pembayaran
 * TIDAK PERNAH dihapus (master data, CLAUDE.md §3.2), cuma disembunyikan
 * dari dialog pembayaran kasir (get-pos-catalog.ts sudah filter isActive).
 */
export async function setPaymentMethodActiveWithDb(
  db: Db,
  businessId: string,
  rawInput: unknown
): Promise<PaymentMethodActionResult> {
  const parsed = setActiveSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const { id, isActive } = parsed.data;

  const updated = await db
    .update(paymentMethods)
    .set({ isActive })
    .where(and(eq(paymentMethods.id, id), eq(paymentMethods.businessId, businessId)))
    .returning({ id: paymentMethods.id });
  assertRowsAffected(updated, "metode pembayaran");

  return { success: { paymentMethodId: id } };
}

const deleteSchema = z.object({ id: z.string().uuid() });

/**
 * Hapus permanen -- HANYA untuk metode yang belum pernah dipakai (audit
 * kelengkapan master data). Cek + delete dalam SATU transaksi.
 */
export async function deletePaymentMethodWithDb(
  db: Db,
  businessId: string,
  rawInput: unknown
): Promise<PaymentMethodActionResult> {
  const parsed = deleteSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const { id } = parsed.data;

  try {
    await db.transaction(async (tx) => {
      const [paymentCount] = await tx
        .select({ n: count() })
        .from(payments)
        .where(eq(payments.paymentMethodId, id));
      if (paymentCount && paymentCount.n > 0) {
        throw new DeleteBlockedError(
          strings.paymentMethods.deleteBlockedPayments.replace(
            "{count}",
            String(paymentCount.n)
          )
        );
      }

      const deleted = await tx
        .delete(paymentMethods)
        .where(and(eq(paymentMethods.id, id), eq(paymentMethods.businessId, businessId)))
        .returning({ id: paymentMethods.id });
      assertRowsAffected(deleted, "metode pembayaran");
    });
  } catch (err) {
    if (err instanceof DeleteBlockedError) {
      return { error: err.message };
    }
    throw err;
  }

  return { success: { paymentMethodId: id } };
}
