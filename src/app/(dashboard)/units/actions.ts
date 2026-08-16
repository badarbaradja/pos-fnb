"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import {
  createUnitWithDb,
  deleteUnitWithDb,
  updateUnitWithDb,
  type UnitActionResult,
} from "@/lib/units/manage";

export type { UnitActionResult };

export type UnitFormState = {
  error?: string;
};

/**
 * Pembungkus Server Action tipis -- logika sesungguhnya ada di
 * lib/units/manage.ts (pola sama dengan app/(dashboard)/devices/actions.ts,
 * termasuk create/update TERPISAH supaya `code` tidak bisa ditulis ulang
 * lewat form edit). Permission "product.manage" dipakai apa adanya -- satuan
 * adalah master data katalog seperti produk/kategori, bukan operasi stok
 * harian (stock.purchase/opname/waste/transfer di permissions.ts), jadi
 * cocok memakai key yang sudah ada daripada menambah key baru.
 */
export async function saveUnit(
  _prevState: UnitFormState,
  formData: FormData
): Promise<UnitFormState> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "product.manage");

  const id = formData.get("id");

  try {
    let result: UnitActionResult;
    if (typeof id === "string" && id) {
      result = await updateUnitWithDb(db, businessId, {
        id,
        name: formData.get("name"),
        baseUnit: formData.get("baseUnit"),
        factor: formData.get("factor"),
      });
    } else {
      result = await createUnitWithDb(db, businessId, {
        code: formData.get("code"),
        name: formData.get("name"),
        baseUnit: formData.get("baseUnit"),
        factor: formData.get("factor"),
      });
    }

    if (result.error) {
      return { error: result.error };
    }
  } finally {
    await closeDb();
  }

  revalidatePath("/units");
  return {};
}

export async function deleteUnit(id: string): Promise<UnitActionResult> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "product.manage");

  try {
    const result = await deleteUnitWithDb(db, businessId, { id });
    if (!result.error) {
      revalidatePath("/units");
    }
    return result;
  } finally {
    await closeDb();
  }
}
