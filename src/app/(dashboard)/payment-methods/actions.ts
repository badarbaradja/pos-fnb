"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import {
  deletePaymentMethodWithDb,
  savePaymentMethodWithDb,
  setPaymentMethodActiveWithDb,
  type PaymentMethodActionResult,
} from "@/lib/payment-methods/manage";

export type { PaymentMethodActionResult };

export type PaymentMethodFormState = {
  error?: string;
};

/**
 * Pembungkus Server Action tipis -- logika sesungguhnya ada di
 * lib/payment-methods/manage.ts (pola sama dengan
 * app/(dashboard)/employees/actions.ts). Halaman ini SENGAJA baru ada
 * sekarang -- sebelumnya metode pembayaran cuma bisa dibuat sekali lewat
 * scripts/bootstrap-production.ts.
 */
export async function savePaymentMethod(
  _prevState: PaymentMethodFormState,
  formData: FormData
): Promise<PaymentMethodFormState> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "price.manage"
  );

  try {
    const result = await savePaymentMethodWithDb(db, businessId, {
      id: formData.get("id") || undefined,
      code: formData.get("code"),
      name: formData.get("name"),
      type: formData.get("type"),
      mdrPercent: formData.get("mdrPercent") || 0,
      isCashDrawer: formData.get("isCashDrawer") === "on",
      requiresRef: formData.get("requiresRef") === "on",
      sortOrder: formData.get("sortOrder") || 0,
    });
    if (result.error) {
      return { error: result.error };
    }
  } finally {
    await closeDb();
  }

  revalidatePath("/payment-methods");
  return {};
}

export async function setPaymentMethodActive(
  id: string,
  isActive: boolean
): Promise<PaymentMethodActionResult> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "price.manage"
  );

  try {
    const result = await setPaymentMethodActiveWithDb(db, businessId, { id, isActive });
    if (!result.error) {
      revalidatePath("/payment-methods");
    }
    return result;
  } finally {
    await closeDb();
  }
}

export async function deletePaymentMethod(id: string): Promise<PaymentMethodActionResult> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "price.manage"
  );

  try {
    const result = await deletePaymentMethodWithDb(db, businessId, { id });
    if (!result.error) {
      revalidatePath("/payment-methods");
    }
    return result;
  } finally {
    await closeDb();
  }
}
