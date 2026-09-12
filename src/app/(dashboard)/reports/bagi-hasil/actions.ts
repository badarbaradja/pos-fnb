"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { recordPemilikPayoutWithDb, type RecordPayoutResult } from "@/lib/pemilik/payout-manage";
import {
  getPemilikPayoutHistory,
  type PemilikPayoutHistoryRow,
} from "@/lib/db/queries/bagi-hasil-report";

export type { RecordPayoutResult, PemilikPayoutHistoryRow };

/**
 * "Tandai sudah dibayar" -- digerbang "payroll.process" (owner+
 * akuntan SAJA, manajer eksplisit 'na' di matriks izin). Melihat laporan
 * ("report.sales" di page.tsx) lebih longgar daripada MENCATAT
 * pembayaran uang sungguhan ke pemilik -- dua keputusan berbeda kelas.
 */
export async function recordPemilikPayout(input: unknown): Promise<RecordPayoutResult> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId, userId } = await requirePermissionDb(
    supabase,
    "payroll.process"
  );

  try {
    const result = await recordPemilikPayoutWithDb(db, businessId, userId, input);
    if (result.error) {
      return { error: result.error };
    }
    revalidatePath("/reports/bagi-hasil");
    return result;
  } finally {
    await closeDb();
  }
}

export async function fetchPayoutHistory(params: {
  outletId: string;
  pemilikId: string;
  startDate: string;
  endDate: string;
}): Promise<{ error?: string; success?: PemilikPayoutHistoryRow[] }> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "report.sales");

  try {
    const rows = await getPemilikPayoutHistory(db, { businessId, ...params });
    return { success: rows };
  } finally {
    await closeDb();
  }
}
