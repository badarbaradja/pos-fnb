import { Decimal } from "decimal.js";

/**
 * Struktur abstrak struk -- fungsi murni, tidak menyentuh DB (sama seperti
 * lib/calc/). Kenapa dipisah dari renderer: nanti produksi butuh renderer
 * ESC/POS (printer thermal) di samping renderer HTML (T14) -- keduanya
 * konsumsi struktur `Receipt` yang SAMA, cuma cara menampilkannya beda.
 * Jangan taruh logika tampilan (HTML/markup) di sini.
 *
 * Semua data di sini SNAPSHOT dari order tersimpan (order_items,
 * order_item_modifiers, payments) -- BUKAN dari katalog. Struk yang
 * dicetak ulang bulan depan harus menampilkan harga saat transaksi, bukan
 * harga produk sekarang (CLAUDE.md §3.2).
 */

export type ReceiptLineModifier = {
  name: string;
  price: Decimal; // per unit, snapshot dari order_item_modifiers.price
};

export type ReceiptLine = {
  productName: string;
  variantName: string | null;
  qty: Decimal;
  unitPrice: Decimal;
  modifiers: ReceiptLineModifier[];
  note: string | null;
  netAmount: Decimal; // sudah termasuk alokasi diskon transaksi baris ini
};

export type ReceiptPayment = {
  methodName: string;
  amount: Decimal;
  receivedAmount: Decimal | null;
  changeAmount: Decimal;
  reference: string | null;
};

export type Receipt = {
  businessName: string;
  businessTimezone: string; // dipakai renderer untuk format tanggal/jam, bukan zona server (CLAUDE.md §3.3)
  outletName: string;
  outletAddress: string | null;
  outletPhone: string | null;
  orderNumber: string;
  channel: string; // order_channel mentah -- label ditentukan renderer lewat lib/pos/channel-labels.ts
  businessDate: string; // "yyyy-MM-dd"
  paidAt: Date | null;
  printedAt: Date;
  isReprint: boolean;
  cashierName: string | null; // null = belum ada data kasir (lihat T13/T15)
  lines: ReceiptLine[];
  subtotal: Decimal;
  itemDiscountTotal: Decimal;
  orderDiscount: Decimal;
  serviceCharge: Decimal;
  taxAmount: Decimal;
  rounding: Decimal;
  total: Decimal;
  payments: ReceiptPayment[];
  totalReceived: Decimal; // jumlah semua payments.receivedAmount
  totalChange: Decimal; // jumlah semua payments.changeAmount
};

/**
 * Bentuk data mentah yang sudah di-fetch dari DB (order + relasi-nya) --
 * angka uang sebagai string (numeric Postgres), dikonversi ke Decimal di
 * buildReceipt(). Pengambilan data sesungguhnya ada di
 * app/(pos)/receipt/[orderId]/get-order-for-receipt.ts, bukan di sini.
 */
export type OrderForReceipt = {
  business: { name: string; timezone: string };
  outlet: { name: string; address: string | null; phone: string | null };
  order: {
    number: string;
    channel: string;
    businessDate: string;
    paidAt: Date | null;
    subtotal: string;
    itemDiscount: string;
    orderDiscount: string;
    serviceCharge: string;
    taxAmount: string;
    rounding: string;
    total: string;
  };
  cashierName: string | null;
  items: {
    productName: string;
    variantName: string | null;
    qty: string;
    unitPrice: string;
    netAmount: string;
    note: string | null;
    modifiers: { modifierName: string; price: string }[];
  }[];
  payments: {
    methodName: string;
    amount: string;
    receivedAmount: string | null;
    changeAmount: string;
    reference: string | null;
  }[];
};

export function buildReceipt(
  data: OrderForReceipt,
  printedAt: Date,
  isReprint: boolean
): Receipt {
  const lines: ReceiptLine[] = data.items.map((item) => ({
    productName: item.productName,
    variantName: item.variantName,
    qty: new Decimal(item.qty),
    unitPrice: new Decimal(item.unitPrice),
    modifiers: item.modifiers.map((m) => ({
      name: m.modifierName,
      price: new Decimal(m.price),
    })),
    note: item.note,
    netAmount: new Decimal(item.netAmount),
  }));

  const payments: ReceiptPayment[] = data.payments.map((p) => ({
    methodName: p.methodName,
    amount: new Decimal(p.amount),
    receivedAmount: p.receivedAmount != null ? new Decimal(p.receivedAmount) : null,
    changeAmount: new Decimal(p.changeAmount),
    reference: p.reference,
  }));

  const totalReceived = payments.reduce(
    (sum, p) => sum.plus(p.receivedAmount ?? p.amount),
    new Decimal(0)
  );
  const totalChange = payments.reduce((sum, p) => sum.plus(p.changeAmount), new Decimal(0));

  return {
    businessName: data.business.name,
    businessTimezone: data.business.timezone,
    outletName: data.outlet.name,
    outletAddress: data.outlet.address,
    outletPhone: data.outlet.phone,
    orderNumber: data.order.number,
    channel: data.order.channel,
    businessDate: data.order.businessDate,
    paidAt: data.order.paidAt,
    printedAt,
    isReprint,
    cashierName: data.cashierName,
    lines,
    subtotal: new Decimal(data.order.subtotal),
    itemDiscountTotal: new Decimal(data.order.itemDiscount),
    orderDiscount: new Decimal(data.order.orderDiscount),
    serviceCharge: new Decimal(data.order.serviceCharge),
    taxAmount: new Decimal(data.order.taxAmount),
    rounding: new Decimal(data.order.rounding),
    total: new Decimal(data.order.total),
    payments,
    totalReceived,
    totalChange,
  };
}
