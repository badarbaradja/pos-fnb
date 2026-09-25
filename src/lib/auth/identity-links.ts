import { and, eq } from "drizzle-orm";
import { getAdminDb } from "@/lib/db/client";
import { memberships, profiles, reportIdentityLinks } from "@/lib/db/schema";

/**
 * lib/auth/identity-links.ts — pengelolaan `report_identity_links` dari
 * halaman /team (owner-only). Lihat lib/auth/handoff.ts untuk pemakaian
 * baca saat handoff sungguhan, dan komentar tabelnya di lib/db/schema.ts
 * untuk kenapa tidak ada policy RLS sama sekali.
 *
 * SEMUA fungsi di sini PENGECUALIAN TERTULIS CLAUDE.md §3.4: tabel ini
 * tidak bisa disentuh lewat getUserDb() oleh siapa pun (RLS deny-all
 * disengaja). Pemanggil (app/(dashboard)/team/actions.ts) WAJIB sudah
 * lolos requirePermissionDb(supabase, "membership.manage") SEBELUM
 * memanggil salah satu fungsi ini -- gerbang izin ada di app layer.
 */

export type IdentityLinkRow = {
  id: string;
  reportEmail: string;
  posProfileId: string;
  posFullName: string;
  createdAt: Date;
};

/** Ditapis ke anggota BISNIS INI saja lewat join ke memberships. */
export async function listIdentityLinksForBusiness(businessId: string): Promise<IdentityLinkRow[]> {
  const db = getAdminDb();
  return db
    .select({
      id: reportIdentityLinks.id,
      reportEmail: reportIdentityLinks.reportEmail,
      posProfileId: reportIdentityLinks.posProfileId,
      posFullName: profiles.fullName,
      createdAt: reportIdentityLinks.createdAt,
    })
    .from(reportIdentityLinks)
    .innerJoin(profiles, eq(profiles.id, reportIdentityLinks.posProfileId))
    .innerJoin(memberships, eq(memberships.userId, profiles.id))
    .where(eq(memberships.businessId, businessId));
}

export type CreateIdentityLinkResult = { error: string } | { success: true };

/**
 * posProfileId WAJIB anggota businessId ini (dicek lewat memberships) --
 * owner tidak boleh menautkan email ke profil di bisnis lain lewat
 * halaman ini, walau secara teori posProfileId bisa jadi UUID valid di
 * bisnis manapun.
 */
export async function createIdentityLink(params: {
  businessId: string;
  reportEmail: string;
  posProfileId: string;
  createdBy: string;
}): Promise<CreateIdentityLinkResult> {
  const db = getAdminDb();

  const [member] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.businessId, params.businessId), eq(memberships.userId, params.posProfileId)));
  if (!member) {
    return { error: "Anggota tim tidak ditemukan di bisnis ini." };
  }

  try {
    await db.insert(reportIdentityLinks).values({
      reportEmail: params.reportEmail,
      posProfileId: params.posProfileId,
      createdBy: params.createdBy,
    });
    return { success: true };
  } catch {
    // Unique constraint report_email -- sudah ada tautan untuk email ini.
    return { error: "duplicate" };
  }
}

/** id WAJIB milik bisnis ini (dicek via join yang sama seperti list). */
export async function deleteIdentityLink(businessId: string, id: string): Promise<void> {
  const db = getAdminDb();
  const rows = await listIdentityLinksForBusiness(businessId);
  if (!rows.some((r) => r.id === id)) {
    return;
  }
  await db.delete(reportIdentityLinks).where(eq(reportIdentityLinks.id, id));
}
