"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, count, eq } from "drizzle-orm";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { paymentMethods, payments } from "@/lib/db/schema";
import { DeleteBlockedError, isUniqueViolation } from "@/lib/db/errors";
import { generateId } from "@/lib/utils/id";
import { id as strings } from "@/lib/i18n/id";

export const paymentMethodTypeValues = [
  "cash",
  "card",
  "ewallet",
  "qris",
  "transfer",
  "voucher",
  "credit",
] as const;

const paymentMethodSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().trim().min(1, strings.common.requiredField),
  name: z.string().trim().min(1, strings.common.requiredField),
  type: z.enum(paymentMethodTypeValues),
  mdrPercent: z.coerce.number().min(0),
  isCashDrawer: z.coerce.boolean(),
  requiresRef: z.coerce.boolean(),
  sortOrder: z.coerce.number().int(),
});

export type PaymentMethodFormState = {
  error?: string;
};

/**
 * Halaman ini SENGAJA baru ada sekarang -- sebelumnya metode pembayaran
 * cuma bisa dibuat sekali lewat scripts/bootstrap-production.ts. Tanpa
 * halaman ini owner tidak bisa menambah metode bayar sendiri kalau nanti
 * mulai terima transfer bank/kartu.
 */
export async function savePaymentMethod(
  _prevState: PaymentMethodFormState,
  formData: FormData
): Promise<PaymentMethodFormState> {
  const parsed = paymentMethodSchema.safeParse({
    id: formData.get("id") || undefined,
    code: formData.get("code"),
    name: formData.get("name"),
    type: formData.get("type"),
    mdrPercent: formData.get("mdrPercent") || 0,
    isCashDrawer: formData.get("isCashDrawer") === "on",
    requiresRef: formData.get("requiresRef") === "on",
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
    "price.manage"
  );

  try {
    if (parsed.data.id) {
      // business_id difilter eksplisit juga -- RLS lapisan terakhir, bukan
      // satu-satunya (CLAUDE.md §3.4).
      await db
        .update(paymentMethods)
        .set({
          code: parsed.data.code,
          name: parsed.data.name,
          type: parsed.data.type,
          mdrPercent: String(parsed.data.mdrPercent),
          isCashDrawer: parsed.data.isCashDrawer,
          requiresRef: parsed.data.requiresRef,
          sortOrder: parsed.data.sortOrder,
        })
        .where(
          and(
            eq(paymentMethods.id, parsed.data.id),
            eq(paymentMethods.businessId, businessId)
          )
        );
    } else {
      await db.insert(paymentMethods).values({
        id: generateId(),
        businessId,
        code: parsed.data.code,
        name: parsed.data.name,
        type: parsed.data.type,
        mdrPercent: String(parsed.data.mdrPercent),
        isCashDrawer: parsed.data.isCashDrawer,
        requiresRef: parsed.data.requiresRef,
        sortOrder: parsed.data.sortOrder,
      });
    }
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { error: strings.paymentMethods.duplicateCode };
    }
    throw err;
  } finally {
    await closeDb();
  }

  revalidatePath("/payment-methods");
  return {};
}

export type DeletePaymentMethodResult = { error?: string };

/**
 * Hapus permanen -- HANYA untuk metode yang belum pernah dipakai (audit
 * kelengkapan master data). Cek + delete dalam SATU transaksi.
 */
export async function deletePaymentMethod(id: string): Promise<DeletePaymentMethodResult> {
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) {
    return { error: strings.common.unexpectedError };
  }

  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "price.manage"
  );

  try {
    await db.transaction(async (tx) => {
      const [paymentCount] = await tx
        .select({ n: count() })
        .from(payments)
        .where(eq(payments.paymentMethodId, parsed.data));
      if (paymentCount && paymentCount.n > 0) {
        throw new DeleteBlockedError(
          strings.paymentMethods.deleteBlockedPayments.replace(
            "{count}",
            String(paymentCount.n)
          )
        );
      }

      await tx
        .delete(paymentMethods)
        .where(
          and(eq(paymentMethods.id, parsed.data), eq(paymentMethods.businessId, businessId))
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

  revalidatePath("/payment-methods");
  return {};
}

export type SetPaymentMethodActiveResult = { error?: string };

/**
 * Tombol nonaktifkan/aktifkan terpisah dari form edit -- metode pembayaran
 * TIDAK PERNAH dihapus (master data, CLAUDE.md §3.2), cuma disembunyikan
 * dari dialog pembayaran kasir (get-pos-catalog.ts sudah filter isActive).
 */
export async function setPaymentMethodActive(
  id: string,
  isActive: boolean
): Promise<SetPaymentMethodActiveResult> {
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
    "price.manage"
  );

  try {
    await db
      .update(paymentMethods)
      .set({ isActive: parsed.data.isActive })
      .where(
        and(
          eq(paymentMethods.id, parsed.data.id),
          eq(paymentMethods.businessId, businessId)
        )
      );
  } finally {
    await closeDb();
  }

  revalidatePath("/payment-methods");
  return {};
}
