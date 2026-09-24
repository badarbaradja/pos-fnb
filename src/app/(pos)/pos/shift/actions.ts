"use server";

import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import {
  addCashMovementWithDb,
  closeAndReopenShiftWithDb,
  closeCashlessShiftWithDb,
  confirmShiftCloseWithDb,
  openShiftWithDb,
  submitCountedCashWithDb,
  type AddCashMovementResult,
  type CloseAndReopenShiftResult,
  type CloseCashlessShiftResult,
  type ConfirmShiftCloseResult,
  type OpenShiftResult,
  type SubmitCountedCashResult,
} from "@/lib/pos/shift";
import {
  submitOpnameWithDb,
  upsertOpnameItemsBulkWithDb,
  type UpsertOpnameItemPayload,
} from "@/lib/stock-opnames/manage";
import { id as strings } from "@/lib/i18n/id";

export type {
  AddCashMovementResult,
  CloseAndReopenShiftResult,
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

export async function closeAndReopenShift(input: unknown): Promise<CloseAndReopenShiftResult> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "shift.open_close");
  try {
    return await closeAndReopenShiftWithDb(db, businessId, input);
  } finally {
    await closeDb();
  }
}

// ---------------------------------------------------------------------
// Rencana Revisi 24 September 2026 §7 poin 4 -- opname terikat shift
// ('buka'/'tutup'). Pembungkus tipis di atas lib/stock-opnames/manage.ts,
// sama pola dengan wrapper lain di berkas ini -- logika/validasi
// sesungguhnya (termasuk gerbang alasan wajib) ada di sana.
// ---------------------------------------------------------------------

export async function saveShiftOpnameItems(input: {
  opnameId: string;
  outletId: string;
  items: UpsertOpnameItemPayload[];
}): Promise<{ error?: string; success?: { saved: number } }> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "shift.open_close");
  try {
    const result = await upsertOpnameItemsBulkWithDb(db, {
      businessId,
      outletId: input.outletId,
      opnameId: input.opnameId,
      items: input.items,
    });
    return { success: result };
  } catch (err) {
    console.error("saveShiftOpnameItems gagal:", err);
    return { error: err instanceof Error ? err.message : strings.common.unexpectedError };
  } finally {
    await closeDb();
  }
}

export async function submitShiftOpname(input: {
  opnameId: string;
  outletId: string;
  businessDate: string;
}): Promise<{ error?: string; success?: boolean }> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "shift.open_close");
  try {
    await submitOpnameWithDb(db, {
      businessId,
      outletId: input.outletId,
      opnameId: input.opnameId,
      businessDate: input.businessDate,
    });
    return { success: true };
  } catch (err) {
    console.error("submitShiftOpname gagal:", err);
    return { error: err instanceof Error ? err.message : strings.common.unexpectedError };
  } finally {
    await closeDb();
  }
}
