/**
 * lib/pos/shift-report.ts — Rencana Revisi 24 September 2026: laporan
 * Prepare (buka shift) dan Closing (tutup shift). Menempel ke layar
 * buka/tutup shift yang SUDAH ADA (bukan halaman/aplikasi terpisah --
 * instruksi eksplisit klien) lewat kolom langsung di `shifts`, BUKAN
 * tabel/sesi terpisah seperti stock_opnames -- satu shift = tepat satu
 * laporan prepare + tepat satu laporan closing, tidak ada draft
 * bertahap yang perlu diedit ulang, jadi cukup UPDATE satu baris sekali
 * jalan per tahap.
 *
 * Foto: TEPAT SATU dari {photoPath, photoMissingReason} wajib per tahap,
 * pola PERSIS sama lib/stock-transfers/manage.ts transferPhotoSchema --
 * `photoMissingReason` diisi OTOMATIS oleh UI (CameraCapture.onUnavailable)
 * saat kamera gagal dibuka/izin ditolak, BUKAN diketik manual, dan itulah
 * yang membuat "boleh lanjut tanpa foto" tetap punya jejak jujur (bukan
 * lolos diam-diam) -- dipakai getShiftsNeedingReview untuk menandai shift
 * itu di layar manajer.
 */

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { UserDbHandle } from "@/lib/db/client";
import { shifts } from "@/lib/db/schema";
import { id as strings } from "@/lib/i18n/id";

type Db = UserDbHandle["db"];

const photoSchema = z
  .object({
    photoPath: z.string().min(1).optional(),
    photoMissingReason: z.string().min(1).optional(),
  })
  .refine((val) => Boolean(val.photoPath) !== Boolean(val.photoMissingReason), {
    message: strings.shiftReport.photoRequiredError,
  });

export type ShiftReportPhotoInput = { photoPath?: string; photoMissingReason?: string };

/**
 * Baris minimal dari `shifts` yang dibutuhkan untuk menentukan status
 * selesai/belum -- dipakai lib/pos/shift.ts (gerbang sellability) dan
 * lib/pos/shift-report.ts sendiri (gerbang tutup). Diekspor sebagai tipe
 * terpisah (bukan full row shifts) supaya pemanggil yang cuma SELECT
 * sebagian kolom tetap bisa memakai kedua fungsi cek di bawah tanpa
 * query tambahan.
 */
export type PrepareReportFields = {
  preparePhotoPath: string | null;
  preparePhotoMissingReason: string | null;
  prepareHasEvent: boolean | null;
};

export type ClosingReportFields = {
  closingPhotoPath: string | null;
  closingPhotoMissingReason: string | null;
  closingCleanlinessNote: string | null;
};

/**
 * "Prepare selesai" = pertanyaan event SUDAH DIJAWAB (bukan cuma foto
 * ada) -- prepareHasEvent nullable justru supaya "sudah difoto tapi
 * belum menjawab ya/tidak" tetap terhitung belum selesai. Dicek di
 * checkShiftSellability (lib/pos/shift.ts): kalau false, kasir tidak
 * bisa transaksi (Rencana Revisi §7, "prepare belum diisi -> kasir
 * tidak bisa transaksi").
 */
export function isPrepareReportComplete(shift: PrepareReportFields): boolean {
  return (
    shift.prepareHasEvent !== null &&
    (shift.preparePhotoPath !== null || shift.preparePhotoMissingReason !== null)
  );
}

/** Simetris dengan isPrepareReportComplete, dicek sebelum shift boleh benar-benar closed. */
export function isClosingReportComplete(shift: ClosingReportFields): boolean {
  return (
    (shift.closingPhotoPath !== null || shift.closingPhotoMissingReason !== null) &&
    Boolean(shift.closingCleanlinessNote && shift.closingCleanlinessNote.trim() !== "")
  );
}

const submitPrepareReportSchema = z.object({
  shiftId: z.string().uuid(),
  photo: photoSchema,
  hasEvent: z.boolean(),
  // WAJIB (non-kosong) HANYA kalau hasEvent=true -- refine gabungan di
  // bawah (bukan di sini) supaya pesan errornya spesifik "event ya tanpa
  // keterangan", bukan pesan generik z.string().min(1).
  eventNote: z.string().trim().optional(),
});

export type SubmitPrepareReportResult = { error?: string; success?: true };

/**
 * Satu kali submit, seluruh laporan prepare (foto + jawaban event)
 * sekaligus -- BEDA dari opname yang draft-bertahap, di sini tidak ada
 * yang perlu disimpan sebagian dulu. WRITE-ONCE secara alami: begitu
 * kolom-kolomnya terisi, checkShiftSellability tidak lagi mengarahkan
 * kasir kembali ke layar ini, jadi tidak ada jalur UI yang memanggil ini
 * dua kali untuk shift yang sama (kalaupun dipanggil lagi, ini cuma
 * menimpa dengan nilai baru -- tidak berbahaya, laporan prepare bukan
 * ledger keuangan yang butuh jaminan write-once berlapis).
 */
export async function submitPrepareReportWithDb(
  db: Db,
  businessId: string,
  rawInput: unknown
): Promise<SubmitPrepareReportResult> {
  const parsed = submitPrepareReportSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const { shiftId, photo, hasEvent, eventNote } = parsed.data;

  if (hasEvent && (!eventNote || eventNote === "")) {
    return { error: strings.shiftReport.eventNoteRequiredError };
  }

  const [shift] = await db
    .select({ status: shifts.status })
    .from(shifts)
    .where(and(eq(shifts.id, shiftId), eq(shifts.businessId, businessId)));
  if (!shift) {
    return { error: strings.common.unexpectedError };
  }
  if (shift.status !== "open") {
    return { error: strings.shift.alreadyClosedError };
  }

  const updated = await db
    .update(shifts)
    .set({
      preparePhotoPath: photo.photoPath ?? null,
      preparePhotoMissingReason: photo.photoMissingReason ?? null,
      prepareHasEvent: hasEvent,
      prepareEventNote: hasEvent ? (eventNote as string) : null,
    })
    .where(and(eq(shifts.id, shiftId), eq(shifts.status, "open")))
    .returning({ id: shifts.id });
  if (updated.length === 0) {
    return { error: strings.shift.alreadyClosedError };
  }

  return { success: true };
}

const submitClosingReportSchema = z.object({
  shiftId: z.string().uuid(),
  photo: photoSchema,
  cleanlinessNote: z.string().trim().min(1, strings.shiftReport.cleanlinessNoteRequiredError),
});

export type SubmitClosingReportResult = { error?: string; success?: true };

/**
 * Simetris submitPrepareReportWithDb, tapi untuk laporan closing.
 * DIPANGGIL TERPISAH dari tombol tutup shift itu sendiri (kasir mengisi
 * ini dulu di layar yang sama, BARU menekan "Setor Hitungan Kas"/"Tutup
 * Shift") -- lib/pos/shift.ts (submitCountedCashWithDb dkk) memvalidasi
 * ULANG lewat isClosingReportComplete() sebelum shift ditulis closed,
 * jadi urutan submit yang benar ditegakkan di server, bukan cuma di UI.
 */
export async function submitClosingReportWithDb(
  db: Db,
  businessId: string,
  rawInput: unknown
): Promise<SubmitClosingReportResult> {
  const parsed = submitClosingReportSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const { shiftId, photo, cleanlinessNote } = parsed.data;

  const [shift] = await db
    .select({ status: shifts.status })
    .from(shifts)
    .where(and(eq(shifts.id, shiftId), eq(shifts.businessId, businessId)));
  if (!shift) {
    return { error: strings.common.unexpectedError };
  }
  if (shift.status !== "open") {
    return { error: strings.shift.alreadyClosedError };
  }

  const updated = await db
    .update(shifts)
    .set({
      closingPhotoPath: photo.photoPath ?? null,
      closingPhotoMissingReason: photo.photoMissingReason ?? null,
      closingCleanlinessNote: cleanlinessNote,
    })
    .where(and(eq(shifts.id, shiftId), eq(shifts.status, "open")))
    .returning({ id: shifts.id });
  if (updated.length === 0) {
    return { error: strings.shift.alreadyClosedError };
  }

  return { success: true };
}
