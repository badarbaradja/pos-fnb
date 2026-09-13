"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import {
  approveStockTransferWithDb,
  cancelStockTransferWithDb,
  rejectStockTransferWithDb,
  receiveStockTransferWithDb,
  requestStockTransferWithDb,
  sendStockTransferWithDb,
  type CancelStockTransferResult,
  type ReceiveStockTransferResult,
  type StockTransferActionResult,
} from "@/lib/stock-transfers/manage";

export type { StockTransferActionResult, CancelStockTransferResult, ReceiveStockTransferResult };

export type StockTransferFormState = {
  error?: string;
};

/**
 * Pembungkus Server Action tipis -- logika sesungguhnya ada di
 * lib/stock-transfers/manage.ts. Form mengirim `linesJson` (bukan field
 * FormData terpisah per baris) karena jumlah baris dinamis.
 */
export async function requestStockTransfer(
  _prevState: StockTransferFormState,
  formData: FormData
): Promise<StockTransferFormState> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId, allowedOutletIds } = await requirePermissionDb(supabase, "stock.transfer");

  let linesRaw: unknown;
  try {
    linesRaw = JSON.parse(String(formData.get("linesJson") ?? "[]"));
  } catch {
    return { error: "Data baris tidak valid" };
  }

  try {
    const result = await requestStockTransferWithDb(db, businessId, allowedOutletIds, {
      toOutletId: formData.get("toOutletId"),
      note: formData.get("note") || undefined,
      requestedBy: formData.get("requestedBy"),
      lines: linesRaw,
    });
    if (result.error) {
      return { error: result.error };
    }
  } finally {
    await closeDb();
  }

  revalidatePath("/stock-transfers");
  return {};
}

export async function approveStockTransfer(
  transferId: string,
  actorId: string
): Promise<StockTransferActionResult> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId, allowedOutletIds } = await requirePermissionDb(supabase, "stock.transfer_approve");

  try {
    const result = await approveStockTransferWithDb(db, businessId, allowedOutletIds, { transferId, actorId });
    if (!result.error) {
      revalidatePath("/stock-transfers");
    }
    return result;
  } finally {
    await closeDb();
  }
}

export async function rejectStockTransfer(
  transferId: string,
  actorId: string,
  reason: string
): Promise<StockTransferActionResult> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId, allowedOutletIds } = await requirePermissionDb(supabase, "stock.transfer_approve");

  try {
    const result = await rejectStockTransferWithDb(db, businessId, allowedOutletIds, { transferId, actorId, reason });
    if (!result.error) {
      revalidatePath("/stock-transfers");
    }
    return result;
  } finally {
    await closeDb();
  }
}

export async function sendStockTransfer(
  _prevState: StockTransferFormState,
  formData: FormData
): Promise<StockTransferFormState> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId, allowedOutletIds } = await requirePermissionDb(supabase, "stock.transfer");

  let linesRaw: unknown;
  try {
    linesRaw = JSON.parse(String(formData.get("linesJson") ?? "[]"));
  } catch {
    return { error: "Data baris tidak valid" };
  }

  try {
    const result = await sendStockTransferWithDb(db, businessId, allowedOutletIds, {
      transferId: formData.get("transferId"),
      sentBy: formData.get("sentBy"),
      number: formData.get("number") || undefined,
      lines: linesRaw,
    });
    if (result.error) {
      return { error: result.error };
    }
  } finally {
    await closeDb();
  }

  revalidatePath("/stock-transfers");
  return {};
}

export async function receiveStockTransfer(
  _prevState: StockTransferFormState,
  formData: FormData
): Promise<StockTransferFormState> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId, allowedOutletIds } = await requirePermissionDb(supabase, "stock.transfer");

  let linesRaw: unknown;
  try {
    linesRaw = JSON.parse(String(formData.get("linesJson") ?? "[]"));
  } catch {
    return { error: "Data baris tidak valid" };
  }

  try {
    const result = await receiveStockTransferWithDb(db, businessId, allowedOutletIds, {
      transferId: formData.get("transferId"),
      receivedBy: formData.get("receivedBy"),
      lines: linesRaw,
    });
    if (result.error) {
      return { error: result.error };
    }
  } finally {
    await closeDb();
  }

  revalidatePath("/stock-transfers");
  return {};
}

export async function cancelStockTransfer(
  transferId: string,
  reason: string,
  cancelledBy: string
): Promise<CancelStockTransferResult> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId, allowedOutletIds } = await requirePermissionDb(supabase, "stock.transfer");

  try {
    const result = await cancelStockTransferWithDb(db, businessId, allowedOutletIds, {
      transferId,
      reason,
      cancelledBy,
    });
    if (!result.error) {
      revalidatePath("/stock-transfers");
    }
    return result;
  } finally {
    await closeDb();
  }
}
