"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import {
  createDeviceWithDb,
  updateDeviceWithDb,
  type DeviceActionResult,
} from "@/lib/devices/manage";

export type { DeviceActionResult };

export type DeviceFormState = {
  error?: string;
};

/**
 * Pembungkus Server Action tipis -- logika sesungguhnya ada di
 * lib/devices/manage.ts (pola sama dengan app/(dashboard)/employees/actions.ts).
 * Permission "employee.manage" dipakai apa adanya -- BLUEPRINT §7 tidak
 * punya key khusus device, dan BLUEPRINT mengelompokkan device satu modul
 * dengan employee/tenancy ("M01 -- Tenancy, Auth & Device").
 */
export async function saveDevice(
  _prevState: DeviceFormState,
  formData: FormData
): Promise<DeviceFormState> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId, allowedOutletIds } = await requirePermissionDb(supabase, "employee.manage");

  const id = formData.get("id");

  try {
    let result: DeviceActionResult;
    if (typeof id === "string" && id) {
      result = await updateDeviceWithDb(db, businessId, allowedOutletIds, {
        id,
        name: formData.get("name"),
        outletId: formData.get("outletId"),
        isActive: formData.get("isActive") === "on",
      });
    } else {
      result = await createDeviceWithDb(db, businessId, allowedOutletIds, {
        name: formData.get("name"),
        outletId: formData.get("outletId"),
        serialNumber: formData.get("serialNumber"),
        deviceType: formData.get("deviceType"),
      });
    }

    if (result.error) {
      return { error: result.error };
    }
  } finally {
    await closeDb();
  }

  revalidatePath("/devices");
  return {};
}
