import { id as strings } from "@/lib/i18n/id";

/**
 * lib/barang/image.ts — TT04. Konstanta dan validasi gambar barang titipan,
 * pola SAMA PERSIS lib/products/image.ts (T09c) -- lihat komentar di sana.
 * Bucket Storage terpisah ('barang', bukan 'products') karena keduanya
 * bucket privat berbeda dengan RLS masing-masing (migration 0026).
 */

export const BARANG_IMAGE_MAX_BYTES = 500_000; // 500KB
export const BARANG_IMAGE_MAX_DIMENSION = 800; // px, sisi terpanjang
export const BARANG_IMAGE_ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export function validateBarangImage(file: { type: string; size: number }): string | null {
  if (!BARANG_IMAGE_ALLOWED_TYPES.includes(file.type as (typeof BARANG_IMAGE_ALLOWED_TYPES)[number])) {
    return strings.barang.imageTypeError;
  }
  if (file.size > BARANG_IMAGE_MAX_BYTES) {
    return strings.barang.imageSizeError;
  }
  return null;
}

/**
 * Path objek deterministik di bucket 'barang' -- {businessId}/{barangId}.jpg.
 * Upload ulang pakai upsert:true ke path yang sama (lihat
 * getProductImagePath untuk alasan lengkap, sama persis di sini).
 */
export function getBarangImagePath(businessId: string, barangId: string): string {
  return `${businessId}/${barangId}.jpg`;
}
