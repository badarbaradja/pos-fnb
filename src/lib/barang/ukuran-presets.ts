/**
 * lib/barang/ukuran-presets.ts — instruksi CEO 11 September 2026: preset
 * ukuran harus menyesuaikan kategori (XS-XXL untuk pakaian, 36-46 untuk
 * sepatu), bukan selalu huruf. Kategori adalah teks bebas (admin bisa
 * menambah kapan saja lewat "+ Kategori baru", lihat quick-add-category-
 * dialog.tsx) -- BUKAN enum tertutup -- jadi pemetaannya lewat pencocokan
 * kata kunci nama kategori, bukan lookup id yang kaku. Kategori yang tidak
 * cocok kata kunci mana pun (Tas, Topi, dll) jatuh ke preset pakaian
 * sebagai default yang paling umum dipakai.
 */
export function getUkuranPresets(categoryName: string | null | undefined): string[] {
  const lower = (categoryName ?? "").toLowerCase();
  if (lower.includes("sepatu") || lower.includes("sandal")) {
    return ["36", "37", "38", "39", "40", "41", "42", "43", "44", "45", "46"];
  }
  return ["XS", "S", "M", "L", "XL", "XXL"];
}

export const KONDISI_PRESETS = ["Sangat baik", "Baik", "Cukup"];
