import { id as strings } from "@/lib/i18n/id";

/**
 * Label tampilan untuk order_channel -- dipakai di struk (T14) dan daftar
 * transaksi kasir (pos/receipt/page.tsx). Satu sumber supaya labelnya tidak
 * berbeda-beda antar halaman.
 */
const channelLabels: Record<string, string> = {
  dine_in: strings.receipt.channelDineIn,
  takeaway: strings.receipt.channelTakeaway,
  delivery: strings.receipt.channelDelivery,
  gofood: strings.receipt.channelGofood,
  grabfood: strings.receipt.channelGrabfood,
  shopeefood: strings.receipt.channelShopeefood,
  online_store: strings.receipt.channelOnlineStore,
  reservation: strings.receipt.channelReservation,
};

export function getChannelLabel(channel: string): string {
  return channelLabels[channel] ?? channel;
}
