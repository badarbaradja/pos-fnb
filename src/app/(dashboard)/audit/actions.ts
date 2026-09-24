"use server";

import { eq } from "drizzle-orm";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requireAuditAccessDb } from "@/lib/audit/access";
import { markAuditReviewedWithDb, type MarkAuditReviewedResult } from "@/lib/audit/reviews";
import { profiles } from "@/lib/db/schema";
import { revalidatePath } from "next/cache";

export type { MarkAuditReviewedResult };

/**
 * Pembungkus Server Action tipis -- logika sesungguhnya ada di
 * lib/audit/reviews.ts. reviewedByName diambil dari profil PEMANGGIL
 * sendiri (query terpisah di sini, bukan dikirim lewat form) -- siapa
 * yang menandai tidak boleh dipalsukan lewat input.
 */
export async function markAuditReviewed(input: {
  outletId: string;
  businessDate: string;
  note?: string;
}): Promise<MarkAuditReviewedResult> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, userId, businessId } = await requireAuditAccessDb(supabase);

  try {
    const [profile] = await db.select({ fullName: profiles.fullName }).from(profiles).where(eq(profiles.id, userId));
    const reviewerName = profile?.fullName ?? "Tidak diketahui";

    const result = await markAuditReviewedWithDb(db, businessId, userId, reviewerName, input);
    if (!result.error) {
      revalidatePath("/audit");
    }
    return result;
  } finally {
    await closeDb();
  }
}
