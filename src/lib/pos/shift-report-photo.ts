/**
 * lib/pos/shift-report-photo.ts — Laporan Prepare/Closing (24 September
 * 2026). Path objek DETERMINISTIK di bucket privat 'shift-reports' --
 * selalu {businessId}/{shiftId}/{step}.jpg (kompresi client selalu
 * menghasilkan JPEG). Upload ulang pakai upsert:true ke path yang sama.
 * Pola PERSIS sama lib/stock-transfers/photo.ts#getStockTransferPhotoPath.
 */
export type ShiftReportPhotoStep = "prepare" | "closing";

export function getShiftReportPhotoPath(
  businessId: string,
  shiftId: string,
  step: ShiftReportPhotoStep
): string {
  return `${businessId}/${shiftId}/${step}.jpg`;
}
