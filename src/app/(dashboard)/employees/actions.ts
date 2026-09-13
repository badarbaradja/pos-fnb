"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import {
  createEmployeeWithDb,
  resetPinWithDb,
  unlockEmployeeWithDb,
  updateEmployeeWithDb,
  type EmployeeActionResult,
} from "@/lib/employees/manage";

export type { EmployeeActionResult };

export type EmployeeFormState = {
  error?: string;
};

/**
 * Pembungkus Server Action tipis -- logika sesungguhnya ada di
 * lib/employees/manage.ts, dipisah supaya bisa dites langsung tanpa
 * request Next.js (pola sama dengan lib/pos/shift.ts, lib/pos/void-refund.ts).
 */
export async function saveEmployee(
  _prevState: EmployeeFormState,
  formData: FormData
): Promise<EmployeeFormState> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId, allowedOutletIds } = await requirePermissionDb(supabase, "employee.manage");

  const id = formData.get("id");
  const outletIdRaw = formData.get("outletId");

  try {
    let result: EmployeeActionResult;
    if (typeof id === "string" && id) {
      result = await updateEmployeeWithDb(db, businessId, allowedOutletIds, {
        id,
        fullName: formData.get("fullName"),
        role: formData.get("role"),
        outletId: outletIdRaw ? outletIdRaw : null,
        isActive: formData.get("isActive") === "on",
      });
    } else {
      result = await createEmployeeWithDb(db, businessId, allowedOutletIds, {
        code: formData.get("code"),
        fullName: formData.get("fullName"),
        role: formData.get("role"),
        outletId: outletIdRaw ? outletIdRaw : null,
        pin: formData.get("pin"),
      });
    }

    if (result.error) {
      return { error: result.error };
    }
  } finally {
    await closeDb();
  }

  revalidatePath("/employees");
  return {};
}

export async function resetEmployeePin(input: unknown): Promise<EmployeeActionResult> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId, allowedOutletIds } = await requirePermissionDb(supabase, "employee.manage");
  try {
    const result = await resetPinWithDb(db, businessId, allowedOutletIds, input);
    if (!result.error) {
      revalidatePath("/employees");
    }
    return result;
  } finally {
    await closeDb();
  }
}

export async function unlockEmployee(input: unknown): Promise<EmployeeActionResult> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId, allowedOutletIds } = await requirePermissionDb(supabase, "employee.manage");
  try {
    const result = await unlockEmployeeWithDb(db, businessId, allowedOutletIds, input);
    if (!result.error) {
      revalidatePath("/employees");
    }
    return result;
  } finally {
    await closeDb();
  }
}
