"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { createBrandWithDb } from "@/lib/brands/manage";
import {
  confirmDayCutoffWithDb,
  createOutletWithDb,
  updateOutletWithDb,
  type OutletActionResult,
} from "@/lib/outlets/manage";

export type { OutletActionResult };

export type OutletFormState = {
  error?: string;
};

const NEW_BRAND_VALUE = "__new__";

/**
 * Pembungkus Server Action tipis -- logika sesungguhnya ada di
 * lib/outlets/manage.ts (pola sama dengan employees/devices).
 *
 * Izin BEDA tergantung create vs update: membuat outlet baru digerbang
 * "settings.business" (owner-only), mengubah outlet yang sudah ada
 * digerbang "outlet.manage" (owner+manajer) -- lihat catatan di
 * lib/outlets/manage.ts dan permissions.ts. Membuat BRAND baru (lewat opsi
 * "+ Brand baru" inline di select) SELALU butuh "settings.business" juga,
 * walau sedang mengubah outlet yang sudah ada -- brand baru sama
 * strukturalnya dengan outlet baru (dashboard TIDAK menampilkan opsi ini
 * ke manajer sama sekali, ini lapisan pertahanan server-nya).
 */
export async function saveOutlet(
  _prevState: OutletFormState,
  formData: FormData
): Promise<OutletFormState> {
  const supabase = await createServerSupabaseClient();
  const id = formData.get("id");
  const isCreate = !(typeof id === "string" && id);
  const creatingNewBrand = formData.get("brandId") === NEW_BRAND_VALUE;

  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    isCreate || creatingNewBrand ? "settings.business" : "outlet.manage"
  );

  try {
    let brandId: FormDataEntryValue | null = formData.get("brandId");
    if (creatingNewBrand) {
      const brandResult = await createBrandWithDb(db, businessId, {
        name: formData.get("newBrandName"),
      });
      if (brandResult.error) {
        return { error: brandResult.error };
      }
      brandId = brandResult.success!.brandId;
    }

    const sharedFields = {
      brandId,
      name: formData.get("name"),
      address: formData.get("address"),
      phone: formData.get("phone"),
      dayCutoffTime: formData.get("dayCutoffTime"),
      isCentralKitchen: formData.get("isCentralKitchen") === "on",
      taxPercent: formData.get("taxPercent"),
      taxInclusive: formData.get("taxInclusive") === "on",
      serviceChargePercent: formData.get("serviceChargePercent"),
      serviceChargeInTaxBase: formData.get("serviceChargeInTaxBase") === "on",
      roundingTo: formData.get("roundingTo"),
      cashVarianceTolerance: formData.get("cashVarianceTolerance"),
      cashEnabled: formData.get("cashEnabled") === "on",
      varianceAlertPercent: formData.get("varianceAlertPercent"),
      varianceAlertValue: formData.get("varianceAlertValue"),
    };

    let result: OutletActionResult;
    if (isCreate) {
      result = await createOutletWithDb(db, businessId, {
        code: formData.get("code"),
        ...sharedFields,
      });
    } else {
      result = await updateOutletWithDb(db, businessId, {
        id,
        ...sharedFields,
        isActive: formData.get("isActive") === "on",
      });
    }

    if (result.error) {
      return { error: result.error };
    }
  } finally {
    await closeDb();
  }

  revalidatePath("/outlets");
  return {};
}

/**
 * TT11 -- konfirmasi manusia bahwa dayCutoffTime outlet ini benar.
 * Gerbang sama "outlet.manage" (owner+manajer) -- keputusan operasional
 * tentang outlet yang sudah ada, sama kelas dengan mengubah pajak/service
 * charge-nya. TIDAK mengubah dayCutoffTime sama sekali.
 */
export async function confirmDayCutoff(outletId: string): Promise<OutletActionResult> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "outlet.manage");

  try {
    const result = await confirmDayCutoffWithDb(db, businessId, outletId);
    if (result.error) {
      return { error: result.error };
    }
    revalidatePath("/outlets");
    revalidatePath("/reports/bagi-hasil");
    return result;
  } finally {
    await closeDb();
  }
}
