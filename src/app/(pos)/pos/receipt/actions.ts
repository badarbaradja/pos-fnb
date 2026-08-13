"use server";

import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import {
  getOrderItemsForRefund,
  refundOrderWithDb,
  resolveEmployeeIdForUser,
  voidOrderWithDb,
  type RefundableItem,
  type RefundOrderResult,
  type VoidOrderResult,
} from "@/lib/pos/void-refund";

export type { RefundableItem, RefundOrderResult, VoidOrderResult };

/**
 * Pembungkus Server Action tipis -- logika sesungguhnya ada di
 * lib/pos/void-refund.ts, dipisah supaya bisa dites langsung tanpa
 * request Next.js (pola sama dengan lib/pos/pay-order.ts, lib/pos/shift.ts).
 */
export async function voidOrder(input: unknown): Promise<VoidOrderResult> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId, userId } = await requirePermissionDb(
    supabase,
    "pos.void_after_send"
  );
  try {
    const employeeId = await resolveEmployeeIdForUser(db, businessId, userId);
    return await voidOrderWithDb(db, businessId, employeeId, input);
  } finally {
    await closeDb();
  }
}

export async function refundOrder(input: unknown): Promise<RefundOrderResult> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId, userId } = await requirePermissionDb(
    supabase,
    "pos.refund"
  );
  try {
    const employeeId = await resolveEmployeeIdForUser(db, businessId, userId);
    return await refundOrderWithDb(db, businessId, employeeId, input);
  } finally {
    await closeDb();
  }
}

export async function getRefundableItems(orderId: string): Promise<RefundableItem[]> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "pos.refund");
  try {
    return await getOrderItemsForRefund(db, businessId, orderId);
  } finally {
    await closeDb();
  }
}
