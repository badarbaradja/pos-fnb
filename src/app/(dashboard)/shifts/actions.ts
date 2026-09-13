"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import {
  confirmForceClosedReconciliationWithDb,
  forceCloseShiftWithDb,
  reconcileForceClosedShiftWithDb,
  type ConfirmForceClosedReconciliationResult,
  type ForceCloseShiftResult,
  type ReconcileForceClosedShiftResult,
} from "@/lib/pos/shift";

/**
 * app/(dashboard)/shifts/actions.ts — §14 prasyarat shift (13 September
 * 2026). Digerbang "shift.reconcile" (owner/manajer/akuntan, izin yang
 * SUDAH ADA di matriks RBAC, belum pernah dipasang ke mana pun sebelum
 * ini) -- BEDA dari "shift.open_close" yang dipakai kasir untuk shift
 * MILIK SENDIRI. Menutup/merekonsiliasi shift ORANG LAIN adalah
 * tindakan pengawasan, bukan operasional kasir sehari-hari.
 */
export async function forceCloseShift(
  shiftId: string,
  reason: string
): Promise<ForceCloseShiftResult> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId, userId } = await requirePermissionDb(supabase, "shift.reconcile");

  try {
    const result = await forceCloseShiftWithDb(db, businessId, userId, { shiftId, reason });
    if (result.error) {
      return { error: result.error };
    }
    revalidatePath("/");
    return result;
  } finally {
    await closeDb();
  }
}

export async function reconcileForceClosedShift(
  shiftId: string,
  countedCash: string
): Promise<ReconcileForceClosedShiftResult> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "shift.reconcile");

  try {
    const result = await reconcileForceClosedShiftWithDb(db, businessId, { shiftId, countedCash });
    if (result.error) {
      return { error: result.error };
    }
    revalidatePath("/");
    return result;
  } finally {
    await closeDb();
  }
}

export async function confirmForceClosedReconciliation(
  shiftId: string,
  reason: string
): Promise<ConfirmForceClosedReconciliationResult> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "shift.reconcile");

  try {
    const result = await confirmForceClosedReconciliationWithDb(db, businessId, { shiftId, reason });
    if (result.error) {
      return { error: result.error };
    }
    revalidatePath("/");
    return result;
  } finally {
    await closeDb();
  }
}
