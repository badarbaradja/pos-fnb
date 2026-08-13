"use server";

import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import {
  addCashMovementWithDb,
  closeCashlessShiftWithDb,
  confirmShiftCloseWithDb,
  openShiftWithDb,
  submitCountedCashWithDb,
  type AddCashMovementResult,
  type CloseCashlessShiftResult,
  type ConfirmShiftCloseResult,
  type OpenShiftResult,
  type SubmitCountedCashResult,
} from "@/lib/pos/shift";

export type {
  AddCashMovementResult,
  CloseCashlessShiftResult,
  ConfirmShiftCloseResult,
  OpenShiftResult,
  SubmitCountedCashResult,
};

/**
 * Pembungkus Server Action tipis -- logika sesungguhnya ada di
 * lib/pos/shift.ts, dipisah supaya bisa dites langsung tanpa request
 * Next.js (pola sama dengan lib/pos/pay-order.ts + pos/actions.ts).
 */
export async function openShift(input: unknown): Promise<OpenShiftResult> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "shift.open_close");
  try {
    return await openShiftWithDb(db, businessId, input);
  } finally {
    await closeDb();
  }
}

export async function submitCountedCash(input: unknown): Promise<SubmitCountedCashResult> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "shift.open_close");
  try {
    return await submitCountedCashWithDb(db, businessId, input);
  } finally {
    await closeDb();
  }
}

export async function confirmShiftClose(input: unknown): Promise<ConfirmShiftCloseResult> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "shift.open_close");
  try {
    return await confirmShiftCloseWithDb(db, businessId, input);
  } finally {
    await closeDb();
  }
}

export async function addCashMovement(input: unknown): Promise<AddCashMovementResult> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "shift.open_close");
  try {
    return await addCashMovementWithDb(db, businessId, input);
  } finally {
    await closeDb();
  }
}

export async function closeCashlessShift(input: unknown): Promise<CloseCashlessShiftResult> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "shift.open_close");
  try {
    return await closeCashlessShiftWithDb(db, businessId, input);
  } finally {
    await closeDb();
  }
}
