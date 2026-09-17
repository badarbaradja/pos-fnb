/**
 * lib/stock-transfers/photo.ts — Langkah D (17 September 2026).
 * Path objek DETERMINISTIK di bucket privat 'stock-transfers' -- selalu
 * {businessId}/{transferId}/{step}.jpg (kompresi client selalu
 * menghasilkan JPEG, sama konvensi lib/products/image.ts). Upload ulang
 * pakai upsert:true ke path yang sama supaya tidak pernah ada file lama
 * tertinggal. Satu tempat definisi supaya upload dan signed URL selalu
 * sinkron -- pola sama getProductImagePath.
 */
export type TransferPhotoStep = "send" | "receive";

export function getStockTransferPhotoPath(
  businessId: string,
  transferId: string,
  step: TransferPhotoStep
): string {
  return `${businessId}/${transferId}/${step}.jpg`;
}
