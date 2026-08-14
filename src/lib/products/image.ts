import { id as strings } from "@/lib/i18n/id";

/**
 * lib/products/image.ts — konstanta dan validasi gambar produk (T09c).
 * Fungsi murni, dipakai di SERVER (Server Action) sebagai penegakan
 * sungguhan -- kompresi/resize client-side (product-image-field.tsx)
 * cuma kenyamanan, bukan satu-satunya lapisan pertahanan.
 */

export const PRODUCT_IMAGE_MAX_BYTES = 500_000; // 500KB
export const PRODUCT_IMAGE_MAX_DIMENSION = 800; // px, sisi terpanjang
export const PRODUCT_IMAGE_ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export function validateProductImage(file: { type: string; size: number }): string | null {
  if (!PRODUCT_IMAGE_ALLOWED_TYPES.includes(file.type as (typeof PRODUCT_IMAGE_ALLOWED_TYPES)[number])) {
    return strings.products.imageTypeError;
  }
  if (file.size > PRODUCT_IMAGE_MAX_BYTES) {
    return strings.products.imageSizeError;
  }
  return null;
}

/**
 * Path objek DETERMINISTIK di bucket 'products' -- selalu {businessId}/{productId}.jpg
 * (kompresi client selalu menghasilkan JPEG). Upload ulang pakai
 * upsert:true ke path yang SAMA, jadi mengganti gambar = menimpa
 * langsung, tidak pernah ada file lama tertinggal di storage. Satu
 * tempat definisi supaya upload dan pembuatan signed URL selalu sinkron.
 */
export function getProductImagePath(businessId: string, productId: string): string {
  return `${businessId}/${productId}.jpg`;
}
