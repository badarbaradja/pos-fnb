import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { and, eq } from "drizzle-orm";
import { getAdminDb } from "../src/lib/db/client";
import { barang, businesses, categories, devices, outlets, paymentMethods } from "../src/lib/db/schema";
import { generateId } from "../src/lib/utils/id";
import { generateBarangKode } from "../src/lib/barang/kode";
import { openShiftWithDb, closeCashlessShiftWithDb, getOpenShiftsForBusiness } from "../src/lib/pos/shift";
import { getSalesByCashier } from "../src/lib/db/queries/sales-report";
import { sellBarangWithDb } from "../src/lib/pos/sell-barang";
import { findSellableBarangByKode } from "../src/lib/barang/lookup";
import { businessDate } from "../src/lib/utils/business-date";

/**
 * scripts/demo-thrift-guest-account.ts — pembuktian TERPISAH "Selesai
 * kalau" TT09b (RENCANA-PEMBANGUNAN-KASIR-THRIFTING.md §4), tidak
 * digabung ke demo-thrift-checkpoint.ts karena butuh device KEDUA (satu
 * device cuma bisa punya satu shift terbuka -- device Kasir Thrifting 1
 * masih dipakai shift Ita dari demo sebelumnya).
 */
async function main() {
  const db = getAdminDb();
  const [business] = await db.select({ id: businesses.id }).from(businesses);
  const businessId = business!.id;
  const [outlet] = await db
    .select()
    .from(outlets)
    .where(and(eq(outlets.businessId, businessId), eq(outlets.code, "BTHR")));

  let [device2] = await db
    .select()
    .from(devices)
    .where(and(eq(devices.businessId, businessId), eq(devices.serialNumber, "THRIFT2")));
  if (!device2) {
    const id = generateId();
    await db.insert(devices).values({
      id,
      businessId,
      outletId: outlet!.id,
      serialNumber: "THRIFT2",
      name: "Kasir Thrifting 2 (uji akun tamu)",
      deviceType: "pos",
    });
    [device2] = await db.select().from(devices).where(eq(devices.id, id));
    console.log("[devices] dibuat: Kasir Thrifting 2 (THRIFT2)");
  }

  // --- 1. Buka shift akun TAMU TANPA nama -- HARUS ditolak server ---
  const rejectResult = await openShiftWithDb(db, businessId, {
    id: generateId(),
    outletId: outlet!.id,
    deviceId: device2!.id,
    employeeCode: "TAMU",
    pin: process.env["SEED_EMPLOYEE_PIN"] || "123456",
    openingCash: "0",
    servedByName: "",
  });
  console.log(`\n[uji 1] Buka shift TAMU tanpa nama: ${rejectResult.error ? `DITOLAK -- "${rejectResult.error}"` : "!!! LOLOS, INI BUG !!!"}`);
  if (!rejectResult.error) {
    throw new Error("BUG: shift akun tamu tanpa nama seharusnya ditolak server");
  }

  // --- 2. Buka shift akun TAMU DENGAN nama "Rani" -- harus berhasil ---
  const openResult = await openShiftWithDb(db, businessId, {
    id: generateId(),
    outletId: outlet!.id,
    deviceId: device2!.id,
    employeeCode: "TAMU",
    pin: process.env["SEED_EMPLOYEE_PIN"] || "123456",
    openingCash: "0",
    servedByName: "Rani",
  });
  if (openResult.error || !openResult.success) {
    throw new Error(`Gagal buka shift Rani: ${openResult.error}`);
  }
  console.log(`[uji 2] Buka shift TAMU dengan nama "Rani": BERHASIL -- tampil sebagai "${openResult.success.employeeName}"`);

  // Pelajaran 11 September 2026 (CEO): shift yang dibuka skrip ini WAJIB
  // ditutup lewat finally, BUKAN pernyataan biasa di akhir fungsi -- kalau
  // salah satu langkah di bawah melempar error, shift Rani akan tertinggal
  // terbuka permanen di THRIFT2 (sama kelas masalah yang ditemukan CEO di
  // demo-thrift-checkpoint.ts, pola sama insiden password Qasim-Ryan).
  try {
    await runGuestAccountChecks();
  } finally {
    await closeCashlessShiftWithDb(db, businessId, { shiftId: openResult.success.shiftId });
    console.log("\n[selesai] Shift uji Rani ditutup.");
  }

  async function runGuestAccountChecks() {
  // Bukti dashboard "siapa bertugas" (getOpenShiftsForBusiness) menyebut Rani
  const openShifts = await getOpenShiftsForBusiness(db, businessId);
  const raniRow = openShifts.find((s) => s.employeeName === "Rani");
  console.log(`[uji 2b] getOpenShiftsForBusiness menyebut "Rani": ${raniRow ? "YA" : "!!! TIDAK, BUG !!!"}`);

  // --- 3. Satu penjualan di bawah shift Rani, lalu cek getSalesByCashier ---
  let [category] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.businessId, businessId), eq(categories.name, "Pakaian")));
  const [transferMethod] = await db
    .select()
    .from(paymentMethods)
    .where(and(eq(paymentMethods.businessId, businessId), eq(paymentMethods.code, "TRANSFER")));

  const barangId = generateId();
  const kode = generateBarangKode(outlet!.code);
  await db.insert(barang).values({
    id: barangId,
    businessId,
    outletId: outlet!.id,
    kode,
    categoryId: category?.id,
    nama: "Barang Uji Akun Tamu",
    hargaModal: "0",
    hargaJual: "50000",
    status: "siap_jual",
  });
  const lookup = await findSellableBarangByKode(db, businessId, kode);
  if (!lookup.success) throw new Error(`Lookup gagal: ${lookup.error}`);

  const sellResult = await sellBarangWithDb(db, businessId, {
    orderId: generateId(),
    outletId: outlet!.id,
    deviceId: device2!.id,
    lines: [{ barangId: lookup.success.id }],
    payments: [{ id: generateId(), paymentMethodId: transferMethod!.id, amount: "50000", reference: "DEMO-TAMU-001" }],
  });
  if (sellResult.error || !sellResult.success) {
    throw new Error(`Penjualan gagal: ${sellResult.error}`);
  }
  console.log(`[uji 3] Penjualan di bawah shift Rani: BERHASIL -- struk ${sellResult.success.orderNumber}`);

  const [businessRow] = await db.select({ timezone: businesses.timezone }).from(businesses).where(eq(businesses.id, businessId));
  const today = businessDate(new Date(), businessRow!.timezone, "04:00:00");
  const salesByCashier = await getSalesByCashier(db, {
    businessId,
    outletId: null,
    startDate: today,
    endDate: today,
  });
  const raniSales = salesByCashier.find((r) => r.cashierName === "Rani");
  console.log(
    `[uji 3b] getSalesByCashier menyebut "Rani" (bukan "Akun Tamu -- Bestie Thrift"): ${raniSales ? `YA -- ${raniSales.orderCount} order, Rp${raniSales.netAmount}` : "!!! TIDAK, BUG !!!"}`
  );

  // --- 4. Karyawan bernama biasa (Ita) tetap tidak terpengaruh ---
  console.log(`\n[uji 4] Karyawan biasa (Ita) tidak diwajibkan servedByName -- sudah dibuktikan lewat demo-thrift-checkpoint.ts (shift Ita dibuka dengan servedByName kosong, tidak ditolak).`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
