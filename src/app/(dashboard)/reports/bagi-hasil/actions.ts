"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { recordPemilikPayoutWithDb, type RecordPayoutResult } from "@/lib/pemilik/payout-manage";
import { isOutletAllowed } from "@/lib/auth/outlet-scope";
import {
  getPemilikPayoutHistory,
  type PemilikPayoutHistoryRow,
} from "@/lib/db/queries/bagi-hasil-report";
import { id as strings } from "@/lib/i18n/id";

export type { RecordPayoutResult, PemilikPayoutHistoryRow };

/**
 * "Tandai sudah dibayar" -- digerbang "payroll.process" (owner+
 * akuntan SAJA, manajer eksplisit 'na' di matriks izin). Melihat laporan
 * ("report.sales" di page.tsx) lebih longgar daripada MENCATAT
 * pembayaran uang sungguhan ke pemilik -- dua keputusan berbeda kelas.
 */
export async function recordPemilikPayout(input: unknown): Promise<RecordPayoutResult> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId, userId, allowedOutletIds } = await requirePermissionDb(
    supabase,
    "payroll.process"
  );

  try {
    const result = await recordPemilikPayoutWithDb(db, businessId, userId, allowedOutletIds, input);
    if (result.error) {
      return { error: result.error };
    }
    revalidatePath("/reports/bagi-hasil");
    return result;
  } finally {
    await closeDb();
  }
}

/**
 * Pembatasan akses per outlet, Tahap 3 (13 September 2026, §26) --
 * DITAMBAHKAN PROAKTIF, tidak diminta CEO secara eksplisit lewat nama
 * fungsi ini, tapi risikonya sama persis dengan ekspor: outletId
 * datang langsung dari parameter panggilan (bukan dari tabel yang
 * sudah disaring), dipanggil lewat "report.sales" (izin longgar, bisa
 * dipegang role yang dibatasi). Ditolak dengan pesan generik yang SAMA
 * dengan error tak terduga lain -- tidak membedakan "outlet tidak ada"
 * dari "di luar cakupan", pola sama notFound() (koreksi CEO 13
 * September 2026).
 */
export async function fetchPayoutHistory(params: {
  outletId: string;
  pemilikId: string;
  startDate: string;
  endDate: string;
}): Promise<{ error?: string; success?: PemilikPayoutHistoryRow[] }> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId, allowedOutletIds } = await requirePermissionDb(supabase, "report.sales");

  try {
    if (!isOutletAllowed(allowedOutletIds, params.outletId)) {
      return { error: strings.common.unexpectedError };
    }
    const rows = await getPemilikPayoutHistory(db, { businessId, ...params });
    return { success: rows };
  } finally {
    await closeDb();
  }
}
