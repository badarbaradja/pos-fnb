"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import {
  cancelStockTransferWithDb,
  receiveStockTransferWithDb,
  type CancelStockTransferResult,
  type StockTransferActionResult,
} from "@/lib/stock-transfers/manage";

export type { StockTransferActionResult, CancelStockTransferResult };

export type ReceiveStockTransferFormState = {
  error?: string;
};

/**
 * Pembungkus Server Action tipis -- logika sesungguhnya ada di
 * lib/stock-transfers/manage.ts. Form mengirim `lines` sebagai JSON string
 * (bukan field FormData terpisah per baris) karena jumlah baris dinamis --
 * pola sama dipakai untuk kasus lain di dashboard ini yang punya daftar
 * baris dengan panjang berubah-ubah.
 */
export async function receiveStockTransfer(
  _prevState: ReceiveStockTransferFormState,
  formData: FormData
): Promise<ReceiveStockTransferFormState> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "stock.transfer");

  let linesRaw: unknown;
  try {
    linesRaw = JSON.parse(String(formData.get("linesJson") ?? "[]"));
  } catch {
    return { error: "Data baris tidak valid" };
  }

  try {
    const result = await receiveStockTransferWithDb(db, businessId, {
      toOutletId: formData.get("toOutletId"),
      number: formData.get("number"),
      note: formData.get("note") || undefined,
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
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "stock.transfer");

  try {
    const result = await cancelStockTransferWithDb(db, businessId, {
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
