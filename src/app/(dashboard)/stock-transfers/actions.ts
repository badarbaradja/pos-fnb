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
import { getStockTransferPhotoPath } from "@/lib/stock-transfers/photo";
import { id as strings } from "@/lib/i18n/id";

export type { StockTransferActionResult, CancelStockTransferResult, ReceiveStockTransferResult };

export type StockTransferFormState = {
  error?: string;
};

type TransferPhotoResolution = { photoPath?: string; photoMissingReason?: string; error?: string };

/**
 * Langkah D (17 September 2026) -- upload foto lewat sesi USER (bukan
 * admin), sama pola image upload produk (T09c): supaya RLS Storage
 * bucket 'stock-transfers' (migration 0039) benar-benar dilewati jalur
 * produksi, bukan cuma ada tapi tidak pernah teruji. Tepat SATU dari
 * `photoFile`/`photoMissingReason` WAJIB ada di FormData -- server tidak
 * pernah percaya klien sudah memvalidasi ini (CLAUDE.md §3.4), diperiksa
 * ULANG di sini sebelum diteruskan ke manage.ts yang menegakkannya lagi
 * lewat Zod.
 */
async function resolveTransferPhoto(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  businessId: string,
  transferId: string,
  step: "send" | "receive",
  formData: FormData
): Promise<TransferPhotoResolution> {
  const photoFile = formData.get("photoFile");
  const missingReason = formData.get("photoMissingReason");
  const hasFile = photoFile instanceof File && photoFile.size > 0;
  const hasReason = typeof missingReason === "string" && missingReason.trim().length > 0;

  if (hasFile === hasReason) {
    // Keduanya kosong ATAU keduanya terisi -- klien seharusnya mencegah
    // ini, tapi server tidak pernah percaya itu.
    return { error: strings.stockTransfers.photoRequiredError };
  }

  if (hasReason) {
    return { photoMissingReason: (missingReason as string).trim() };
  }

  const path = getStockTransferPhotoPath(businessId, transferId, step);
  const { error: uploadError } = await supabase.storage
    .from("stock-transfers")
    .upload(path, photoFile as File, { upsert: true, contentType: "image/jpeg" });
  if (uploadError) {
    console.error("Upload foto transfer stok gagal:", uploadError);
    return { error: strings.common.unexpectedError };
  }
  return { photoPath: path };
}

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

  const transferId = String(formData.get("transferId") ?? "");

  try {
    const photo = await resolveTransferPhoto(supabase, businessId, transferId, "send", formData);
    if (photo.error) {
      return { error: photo.error };
    }

    const result = await sendStockTransferWithDb(db, businessId, allowedOutletIds, {
      transferId: formData.get("transferId"),
      sentBy: formData.get("sentBy"),
      number: formData.get("number") || undefined,
      lines: linesRaw,
      photo: { photoPath: photo.photoPath, photoMissingReason: photo.photoMissingReason },
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

  const transferId = String(formData.get("transferId") ?? "");

  try {
    const photo = await resolveTransferPhoto(supabase, businessId, transferId, "receive", formData);
    if (photo.error) {
      return { error: photo.error };
    }

    const result = await receiveStockTransferWithDb(db, businessId, allowedOutletIds, {
      transferId: formData.get("transferId"),
      receivedBy: formData.get("receivedBy"),
      lines: linesRaw,
      photo: { photoPath: photo.photoPath, photoMissingReason: photo.photoMissingReason },
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
