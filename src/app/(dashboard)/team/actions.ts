"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermission, requirePermissionDb } from "@/lib/auth/permissions";
import {
  inviteMembershipWithDb,
  updateMembershipWithDb,
  type MembershipActionResult,
} from "@/lib/memberships/manage";
import { createIdentityLink, deleteIdentityLink } from "@/lib/auth/identity-links";

export type { MembershipActionResult };

export type IdentityLinkFormState = {
  error?: string;
  // Dibedakan eksplisit dari "belum pernah submit" (state awal `{}`) --
  // kalau cuma `{}` dipakai untuk sukses juga, dialog tidak bisa tahu
  // kapan harus menutup diri sendiri (lihat identity-link-dialog.tsx).
  success?: boolean;
};

/**
 * requirePermission (BUKAN requirePermissionDb -- fungsi ini tidak
 * memakai `db`-nya, cuma gerbang izinnya) adalah SATU-SATUNYA pemeriksaan
 * sebelum createIdentityLink() menyentuh koneksi admin (tabel
 * report_identity_links tidak punya policy RLS, lihat komentarnya).
 */
export async function saveIdentityLink(
  _prevState: IdentityLinkFormState,
  formData: FormData
): Promise<IdentityLinkFormState> {
  const supabase = await createServerSupabaseClient();
  const { businessId, userId } = await requirePermission(supabase, "membership.manage");

  const reportEmail = formData.get("reportEmail");
  const posProfileId = formData.get("posProfileId");
  if (typeof reportEmail !== "string" || !reportEmail || typeof posProfileId !== "string" || !posProfileId) {
    return { error: "Wajib diisi" };
  }

  const result = await createIdentityLink({
    businessId,
    reportEmail: reportEmail.trim().toLowerCase(),
    posProfileId,
    createdBy: userId,
  });
  if ("error" in result) {
    return { error: result.error === "duplicate" ? "duplicate" : result.error };
  }

  revalidatePath("/team");
  return { success: true };
}

export async function deleteIdentityLinkAction(id: string): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const { businessId } = await requirePermission(supabase, "membership.manage");
  await deleteIdentityLink(businessId, id);
  revalidatePath("/team");
}

export type MembershipFormState = {
  error?: string;
  inviteLink?: string;
  inviteLinkGeneratedAt?: string;
};

function parseOutletIds(formData: FormData): string[] | null {
  if (formData.get("outletScope") === "all") {
    return null;
  }
  return formData.getAll("outletIds").map(String);
}

/**
 * Pembungkus Server Action tipis -- logika sesungguhnya ada di
 * lib/memberships/manage.ts, pola sama app/(dashboard)/employees/actions.ts.
 */
export async function saveMembership(
  _prevState: MembershipFormState,
  formData: FormData
): Promise<MembershipFormState> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId, userId } = await requirePermissionDb(supabase, "membership.manage");

  const id = formData.get("id");

  try {
    let result: MembershipActionResult;
    if (typeof id === "string" && id) {
      result = await updateMembershipWithDb(db, businessId, userId, {
        id,
        role: formData.get("role"),
        outletIds: parseOutletIds(formData),
        isActive: formData.get("isActive") === "on",
        auditAllOutlets: formData.get("auditAllOutlets") === "on",
      });
    } else {
      result = await inviteMembershipWithDb(db, businessId, userId, {
        email: formData.get("email"),
        fullName: formData.get("fullName"),
        role: formData.get("role"),
        outletIds: parseOutletIds(formData),
      });
    }

    if (result.error) {
      return { error: result.error };
    }

    revalidatePath("/team");
    return {
      inviteLink: result.success?.inviteLink,
      inviteLinkGeneratedAt: result.success?.inviteLinkGeneratedAt,
    };
  } finally {
    await closeDb();
  }
}
