import { Decimal, round2 } from "../utils/money";

/**
 * lib/calc/consignment-split.ts — TT07. Fungsi murni (tanpa akses DB),
 * dipanggil dari lib/pos/sell-barang.ts SETIAP kali barang titipan terjual,
 * hasilnya dibekukan langsung ke order_items (pemilikBagiPercentAtSale,
 * pemilikShareAmount, tokoShareAmount) — kalau pemilik.persenBagi diubah
 * BULAN DEPAN, transaksi bulan ini TIDAK ikut berubah (CLAUDE.md §3.2,
 * jawaban CEO §7 SPESIFIKASI-THRIFTING.md: "simpan angkanya di baris
 * transaksi, jangan dihitung ulang belakangan").
 *
 * HANYA dipanggil untuk barang yang punya pemilik (barang.pemilikId bukan
 * null) — barang milik toko sendiri tidak pernah lewat fungsi ini sama
 * sekali, pemanggil (sell-barang.ts) menetapkan tokoShareAmount = harga
 * penuh dan pemilikShareAmount = null langsung, tanpa pemanggilan ke sini.
 *
 * pemilikBagiPercent adalah PECAHAN (0.60 = 60%), bukan angka persen (60)
 * — konversi dari pemilik.persenBagi (kolom yang menyimpan angka persen,
 * sama konvensi outlets.taxPercent) dilakukan di layer pemanggil, BUKAN di
 * sini. Ini konvensi yang sama persis dengan lib/calc/order-calculator.ts
 * (orderDiscountPercent, serviceChargePercent, taxPercent semua pecahan).
 */

export type ConsignmentSplitResult = {
  pemilikShareAmount: Decimal;
  tokoShareAmount: Decimal;
};

/**
 * Sisa pembulatan SELALU diserap toko, bukan pemilik — pemilikShareAmount
 * dibulatkan dulu (round2 langsung dari harga jual), tokoShareAmount
 * dihitung dari SISA (salePrice - pemilikShareAmount), bukan dibulatkan
 * independen dari (1-persen)*salePrice. Ini menjamin pemilikShareAmount +
 * tokoShareAmount SELALU PERSIS SAMA DENGAN salePrice, tidak pernah lebih
 * atau kurang 1 sen akibat dua pembulatan independen (prinsip sama dengan
 * "baris terakhir menyerap sisa pembulatan" di order-calculator.ts A.3
 * langkah 5) — dan pemilik dijamin dapat angka yang murni proporsional ke
 * persentasenya, tidak pernah dikurangi/ditambah karena sisa pembulatan.
 */
export function consignmentSplit(
  salePrice: Decimal,
  pemilikBagiPercent: Decimal
): ConsignmentSplitResult {
  const pemilikShareAmount = round2(salePrice.times(pemilikBagiPercent));
  const tokoShareAmount = salePrice.minus(pemilikShareAmount);
  return { pemilikShareAmount, tokoShareAmount };
}
