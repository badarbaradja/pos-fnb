"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import {
  saveBarangWithDb,
  setBarangStatusWithDb,
  type BarangActionResult,
} from "@/lib/barang/manage";
import { getBarangImagePath, validateBarangImage } from "@/lib/barang/image";
import { id as strings } from "@/lib/i18n/id";

export type { BarangActionResult };

export type BarangFormState = {
  error?: string;
  success?: { barangId: string; kode: string };
};

const initialState: BarangFormState = {};
export { initialState as barangFormInitialState };

/**
 * Pembungkus Server Action -- logika inti di lib/barang/manage.ts, gambar
 * ditangani di sini (pola SAMA app/(dashboard)/products/actions.ts#saveProduct,
 * lihat komentar di sana). Gerbang "barang.manage" (owner+manajer saja --
 * `na` untuk kasir/akun tamu, lihat lib/auth/permissions.ts).
 */
export async function saveBarang(
  _prevState: BarangFormState,
  formData: FormData
): Promise<BarangFormState> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "barang.manage"
  );

  try {
    const result = await saveBarangWithDb(db, businessId, {
      id: formData.get("id") || undefined,
      outletId: formData.get("outletId"),
      categoryId: formData.get("categoryId") || undefined,
      nama: formData.get("nama"),
      merek: formData.get("merek") || undefined,
      ukuran: formData.get("ukuran") || undefined,
      warna: formData.get("warna") || undefined,
      kondisi: formData.get("kondisi") || undefined,
      hargaModal: formData.get("hargaModal") || 0,
      hargaJual: formData.get("hargaJual"),
      pemilikId: formData.get("pemilikId") || undefined,
    });
    if (result.error || !result.success) {
      return { error: result.error };
    }

    const imageFile = formData.get("imageFile");
    const imageRemoved = formData.get("imageRemoved") === "1";
    if (imageFile instanceof File && imageFile.size > 0) {
      const validationError = validateBarangImage(imageFile);
      if (validationError) {
        return { error: validationError };
      }
      const path = getBarangImagePath(businessId, result.success.barangId);
      const { error: uploadError } = await supabase.storage
        .from("barang")
        .upload(path, imageFile, { upsert: true, contentType: "image/jpeg" });
      if (uploadError) {
        console.error("Upload gambar barang gagal:", uploadError);
        return { error: strings.common.unexpectedError };
      }
    } else if (imageRemoved) {
      const path = getBarangImagePath(businessId, result.success.barangId);
      await supabase.storage.from("barang").remove([path]);
    }

    revalidatePath("/barang");
    return { success: result.success };
  } finally {
    await closeDb();
  }
}

export async function setBarangStatus(
  id: string,
  status: "baru_masuk" | "siap_jual" | "rusak"
): Promise<BarangActionResult> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "barang.manage"
  );

  try {
    const result = await setBarangStatusWithDb(db, businessId, { id, status });
    if (!result.error) {
      revalidatePath("/barang");
    }
    return result;
  } finally {
    await closeDb();
  }
}
