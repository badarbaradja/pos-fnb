import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentBusinessFromClient, getSessionFromClient } from "@/lib/auth/session";
import { getUserDb, type UserDbHandle } from "@/lib/db/client";

/**
 * lib/audit/access.ts — Halaman Auditor (24 September 2026). Gerbang
 * TERPISAH dari requirePermission()/PermissionKey (lib/auth/permissions.ts)
 * dengan sengaja -- izin ini bukan default per ROLE (owner/manajer/dst),
 * tapi grant SEMPIT per MEMBERSHIP INDIVIDU (memberships.audit_all_outlets),
 * pola sama allowedOutletIds, bukan pola PERMISSIONS matrix. Owner/akuntan
 * SELALU lolos (mereka sudah unrestricted lewat auth_outlet_ids() juga,
 * lihat lib/auth/outlet-scope.ts) tanpa perlu audit_all_outlets=true.
 *
 * Jaring KEDUA ada di database: fungsi SQL auth_can_audit()/
 * audit_shifts_for_business_date() (migrasi 24 September 2026) menegakkan
 * pengecekan yang SAMA lagi, independen dari kode ini -- kalau app layer
 * ini entah bagaimana dilewati/salah, data lintas outlet tetap tidak akan
 * pernah keluar dari database.
 */
export type AuditAccessContext = {
  userId: string;
  businessId: string;
};

export async function requireAuditAccess(supabase: SupabaseClient): Promise<AuditAccessContext> {
  const session = await getSessionFromClient(supabase);
  if (!session) {
    throw new Error("Unauthorized: tidak ada sesi login");
  }

  const business = await getCurrentBusinessFromClient(supabase, session.userId);
  if (!business) {
    throw new Error("Unauthorized: tidak ada membership aktif");
  }

  const isUnrestrictedRole = business.role === "owner" || business.role === "accountant";
  if (!isUnrestrictedRole && !business.auditAllOutlets) {
    throw new Error("Forbidden: tidak punya izin meninjau laporan lintas outlet");
  }

  return { userId: session.userId, businessId: business.businessId };
}

export async function requireAuditAccessDb(
  supabase: SupabaseClient
): Promise<AuditAccessContext & { db: UserDbHandle["db"]; closeDb: UserDbHandle["close"] }> {
  const context = await requireAuditAccess(supabase);

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) {
    throw new Error("Unauthorized: access token tidak ditemukan di sesi");
  }

  const { db, close } = await getUserDb(accessToken);
  return { ...context, db, closeDb: close };
}
