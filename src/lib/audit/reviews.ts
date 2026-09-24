/**
 * lib/audit/reviews.ts — tanda "sudah ditinjau" per outlet per hari bisnis
 * (Halaman Auditor, 24 September 2026). Tabel audit_reviews RLS-nya
 * business-scoped biasa (lihat schema.ts) -- gerbang ke fitur ini adalah
 * requireAuditAccess(), bukan RLS tabel ini sendiri (menulis "outlet X
 * sudah ditinjau" tidak membocorkan angka apa pun dari outlet lain).
 */
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { UserDbHandle } from "@/lib/db/client";
import { auditReviews } from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";
import { id as strings } from "@/lib/i18n/id";
import type { AuditReviewInfo } from "./report";

type Db = UserDbHandle["db"];

export async function getAuditReviewsForBusinessDate(
  db: Db,
  businessId: string,
  outletIds: string[],
  businessDate: string
): Promise<Map<string, AuditReviewInfo>> {
  const map = new Map<string, AuditReviewInfo>();
  if (outletIds.length === 0) return map;

  const rows = await db
    .select({
      outletId: auditReviews.outletId,
      reviewedByName: auditReviews.reviewedByName,
      reviewedAt: auditReviews.reviewedAt,
      note: auditReviews.note,
    })
    .from(auditReviews)
    .where(
      and(
        eq(auditReviews.businessId, businessId),
        eq(auditReviews.businessDate, businessDate),
        inArray(auditReviews.outletId, outletIds)
      )
    );

  for (const row of rows) {
    map.set(row.outletId, {
      reviewedByName: row.reviewedByName,
      reviewedAt: row.reviewedAt,
      note: row.note,
    });
  }
  return map;
}

const markReviewedSchema = z.object({
  outletId: z.string().uuid(),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().optional(),
});

export type MarkAuditReviewedResult = { error?: string; success?: true };

/**
 * Menandai (atau MENIMPA tanda sebelumnya, lihat komentar unique
 * constraint di schema.ts) satu outlet+hari sebagai "sudah ditinjau".
 * `reviewedByName` diambil dari PROFIL pemanggil sendiri (bukan input
 * form) -- siapa yang menandai tidak boleh dipalsukan lewat FormData.
 */
export async function markAuditReviewedWithDb(
  db: Db,
  businessId: string,
  reviewerUserId: string,
  reviewerName: string,
  rawInput: unknown
): Promise<MarkAuditReviewedResult> {
  const parsed = markReviewedSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const { outletId, businessDate, note } = parsed.data;

  await db
    .insert(auditReviews)
    .values({
      id: generateId(),
      businessId,
      outletId,
      businessDate,
      reviewedBy: reviewerUserId,
      reviewedByName: reviewerName,
      note: note?.trim() || null,
    })
    .onConflictDoUpdate({
      target: [auditReviews.outletId, auditReviews.businessDate],
      set: {
        reviewedBy: reviewerUserId,
        reviewedByName: reviewerName,
        reviewedAt: new Date(),
        note: note?.trim() || null,
      },
    });

  return { success: true };
}
