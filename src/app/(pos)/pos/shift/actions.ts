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
import { submitClosingReportWithDb, submitPrepareReportWithDb } from "@/lib/pos/shift-report";
import { getShiftReportPhotoPath, type ShiftReportPhotoStep } from "@/lib/pos/shift-report-photo";
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

// ---------------------------------------------------------------------
// Rencana Revisi 24 September 2026 -- laporan Prepare/Closing. Upload
// foto lewat sesi USER (bukan admin), pola PERSIS sama
// app/(dashboard)/stock-transfers/actions.ts#resolveTransferPhoto --
// supaya RLS Storage bucket 'shift-reports' (migration 0041) benar-benar
// dilewati jalur produksi. Tepat SATU dari `photoFile`/`photoMissingReason`
// WAJIB ada di FormData, diperiksa ULANG di sini (server tidak pernah
// percaya klien, CLAUDE.md §3.4) sebelum diteruskan ke lib/pos/shift-
// report.ts yang menegakkannya lagi lewat Zod.
// ---------------------------------------------------------------------

type ShiftReportPhotoResolution = { photoPath?: string; photoMissingReason?: string; error?: string };

async function resolveShiftReportPhoto(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  businessId: string,
  shiftId: string,
  step: ShiftReportPhotoStep,
  formData: FormData
): Promise<ShiftReportPhotoResolution> {
  const photoFile = formData.get("photoFile");
  const missingReason = formData.get("photoMissingReason");
  const hasFile = photoFile instanceof File && photoFile.size > 0;
  const hasReason = typeof missingReason === "string" && missingReason.trim().length > 0;

  if (hasFile === hasReason) {
    return { error: strings.shiftReport.photoRequiredError };
  }

  if (hasReason) {
    return { photoMissingReason: (missingReason as string).trim() };
  }

  const path = getShiftReportPhotoPath(businessId, shiftId, step);
  const { error: uploadError } = await supabase.storage
    .from("shift-reports")
    .upload(path, photoFile as File, { upsert: true, contentType: "image/jpeg" });
  if (uploadError) {
    console.error("Upload foto laporan shift gagal:", uploadError);
    return { error: strings.common.unexpectedError };
  }
  return { photoPath: path };
}

export type ShiftReportFormState = { error?: string };

export async function submitPrepareReport(
  _prevState: ShiftReportFormState,
  formData: FormData
): Promise<ShiftReportFormState> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "shift.open_close");
  const shiftId = String(formData.get("shiftId") ?? "");

  try {
    const photo = await resolveShiftReportPhoto(supabase, businessId, shiftId, "prepare", formData);
    if (photo.error) {
      return { error: photo.error };
    }

    const eventNote = formData.get("eventNote");
    const result = await submitPrepareReportWithDb(db, businessId, {
      shiftId,
      photo: { photoPath: photo.photoPath, photoMissingReason: photo.photoMissingReason },
      hasEvent: formData.get("hasEvent") === "true",
      eventNote: typeof eventNote === "string" ? eventNote : undefined,
    });
    if (result.error) {
      return { error: result.error };
    }
  } finally {
    await closeDb();
  }

  return {};
}

export async function submitClosingReport(
  _prevState: ShiftReportFormState,
  formData: FormData
): Promise<ShiftReportFormState> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "shift.open_close");
  const shiftId = String(formData.get("shiftId") ?? "");

  try {
    const photo = await resolveShiftReportPhoto(supabase, businessId, shiftId, "closing", formData);
    if (photo.error) {
      return { error: photo.error };
    }

    const result = await submitClosingReportWithDb(db, businessId, {
      shiftId,
      photo: { photoPath: photo.photoPath, photoMissingReason: photo.photoMissingReason },
      cleanlinessNote: String(formData.get("cleanlinessNote") ?? ""),
    });
    if (result.error) {
      return { error: result.error };
    }
  } finally {
    await closeDb();
  }

  return {};
}
