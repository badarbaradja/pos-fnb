"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import {
  inviteMembershipWithDb,
  updateMembershipWithDb,
  type MembershipActionResult,
} from "@/lib/memberships/manage";

export type { MembershipActionResult };

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
