import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { and, eq } from "drizzle-orm";
import { getAdminDb } from "../src/lib/db/client";
import {
  barang,
  brands,
  businesses,
  categories,
  devices,
  employees,
  orderItems,
  outlets,
  paymentMethods,
  pemilik,
} from "../src/lib/db/schema";
import { generateId } from "../src/lib/utils/id";
import { generateBarangKode } from "../src/lib/barang/kode";
import { hashPin } from "../src/lib/auth/pin";
import {
  openShiftWithDb,
  getOpenShiftForDevice,
  isShiftSellable,
  closeCashlessShiftWithDb,
} from "../src/lib/pos/shift";
import { findSellableBarangByKode } from "../src/lib/barang/lookup";
import { sellBarangWithDb } from "../src/lib/pos/sell-barang";
import { getOrderForReceiptById } from "../src/app/(pos)/pos/receipt/get-order-for-receipt";
import { buildReceipt } from "../src/lib/printing/receipt-template";

/**
 * scripts/demo-thrift-checkpoint.ts — TT09 + demonstrasi titik periksa
 * kedua (RENCANA-PEMBANGUNAN-KASIR-THRIFTING.md §5). Idempoten: aman
 * dijalankan ulang, upsert data setup, lalu SELALU membuat satu barang
 * demo BARU untuk benar-benar dijual (barang unik cuma bisa terjual
 * sekali -- re-run tidak bisa menjual ulang barang yang sama).
 *
 * Pakai getAdminDb() -- operasi sistem (seed data + verifikasi), bukan
 * atas nama satu user lewat request (CLAUDE.md §3.4, pola sama
 * scripts/seed-demo.ts). Fungsi bisnis yang dipanggil (openShiftWithDb,
 * sellBarangWithDb) adalah KODE SUNGGUHAN yang sama dipakai
 * Server Action produksi -- getAdminDb() di sini cuma menggantikan
 * getUserDb(accessToken) sebagai transport, TIDAK ADA logika bisnis yang
 * disimulasikan/dipalsukan.
 *
 * BUKAN pengukuran kecepatan manusia sungguhan (pindai fisik -> tap layar
 * -> lihat struk) -- pos-fnb tidak punya Playwright/harness browser,
 * jadi ini murni waktu eksekusi SERVER (lookup + sellBarangWithDb +
 * rakit struk) lewat kode produksi terhadap database dev sungguhan.
 * Dicatat apa adanya di output, bukan diklaim sebagai waktu UI.
 */

const OUTLET_CODE = "BTHR";
const OUTLET_NAME = "Bestie Thrift";
const DEVICE_SERIAL = "THRIFT1";
const DEVICE_NAME = "Kasir Thrifting 1";
const ITA_CODE = "ITA";
const TAMU_CODE = "TAMU";
const DEMO_PIN = process.env["SEED_EMPLOYEE_PIN"] || "123456";

async function resolveBusinessId(db: ReturnType<typeof getAdminDb>): Promise<string> {
  const argName = process.argv[2];
  const rows = await db.select({ id: businesses.id, name: businesses.name }).from(businesses);
  if (argName) {
    const match = rows.find((r) => r.name === argName);
    if (!match) {
      throw new Error(
        `Business "${argName}" tidak ditemukan. Business yang ada: ${rows.map((r) => r.name).join(", ") || "(kosong)"}`
      );
    }
    return match.id;
  }
  if (rows.length === 1) {
    return rows[0]!.id;
  }
  throw new Error(
    `Ada ${rows.length} business, harus pilih salah satu lewat argumen: npx tsx scripts/demo-thrift-checkpoint.ts -- "<nama business>"\nBusiness yang ada: ${rows.map((r) => r.name).join(", ") || "(kosong)"}`
  );
}

async function main() {
  const db = getAdminDb();
  const businessId = await resolveBusinessId(db);
  console.log(`[business] ${businessId}`);

  // --- Brand ---
  let [brand] = await db
    .select()
    .from(brands)
    .where(and(eq(brands.businessId, businessId), eq(brands.name, OUTLET_NAME)));
  if (!brand) {
    const id = generateId();
    await db.insert(brands).values({ id, businessId, name: OUTLET_NAME });
    [brand] = await db.select().from(brands).where(eq(brands.id, id));
    console.log(`[brands] dibuat: ${OUTLET_NAME}`);
  } else {
    console.log(`[brands] sudah ada: ${OUTLET_NAME}`);
  }

  // --- Outlet (cashless, pajak nol, posMode=thrifting) ---
  let [outlet] = await db
    .select()
    .from(outlets)
    .where(and(eq(outlets.businessId, businessId), eq(outlets.code, OUTLET_CODE)));
  if (!outlet) {
    const id = generateId();
    await db.insert(outlets).values({
      id,
      businessId,
      brandId: brand!.id,
      code: OUTLET_CODE,
      name: OUTLET_NAME,
      posMode: "thrifting",
      cashEnabled: false,
      taxPercent: "0",
      taxInclusive: false,
      serviceChargePercent: "0",
    });
    [outlet] = await db.select().from(outlets).where(eq(outlets.id, id));
    console.log(`[outlets] dibuat: ${OUTLET_NAME} (${OUTLET_CODE}), cashEnabled=false, taxPercent=0`);
  } else {
    // Re-run juga menegakkan ulang setting inti -- kalau outlet ini
    // sempat diubah manual dari Admin ke arah yang salah, script ini
    // mengembalikannya (idempoten dalam arti "setting kritis", bukan cuma
    // "insert kalau belum ada").
    await db
      .update(outlets)
      .set({ posMode: "thrifting", cashEnabled: false, taxPercent: "0", serviceChargePercent: "0" })
      .where(eq(outlets.id, outlet.id));
    console.log(`[outlets] sudah ada: ${OUTLET_NAME} (${OUTLET_CODE}) -- setting inti ditegakkan ulang`);
  }

  // --- Metode pembayaran non-tunai (cashless) ---
  const NEEDED_PAYMENT_METHODS = [
    { code: "QRIS", name: "QRIS", type: "qris", isCashDrawer: false, requiresRef: true },
    { code: "TRANSFER", name: "Transfer Bank", type: "transfer", isCashDrawer: false, requiresRef: true },
  ] as const;
  for (const [index, pm] of NEEDED_PAYMENT_METHODS.entries()) {
    const [existing] = await db
      .select()
      .from(paymentMethods)
      .where(and(eq(paymentMethods.businessId, businessId), eq(paymentMethods.code, pm.code)));
    if (!existing) {
      await db.insert(paymentMethods).values({
        id: generateId(),
        businessId,
        code: pm.code,
        name: pm.name,
        type: pm.type,
        isCashDrawer: pm.isCashDrawer,
        requiresRef: pm.requiresRef,
        sortOrder: index,
      });
      console.log(`[payment_methods] dibuat: ${pm.name}`);
    } else {
      console.log(`[payment_methods] sudah ada: ${pm.name}`);
    }
  }
  const [transferMethod] = await db
    .select()
    .from(paymentMethods)
    .where(and(eq(paymentMethods.businessId, businessId), eq(paymentMethods.code, "TRANSFER")));

  // --- Karyawan: Ita (manager, akun pribadi) + TAMU (akun bersama, TT09b) ---
  const pinHash = await hashPin(DEMO_PIN);
  for (const emp of [
    { code: ITA_CODE, fullName: "Ita", role: "manager" as const, isSharedAccount: false },
    { code: TAMU_CODE, fullName: "Akun Tamu -- Bestie Thrift", role: "cashier" as const, isSharedAccount: true },
  ]) {
    const [existing] = await db
      .select()
      .from(employees)
      .where(and(eq(employees.businessId, businessId), eq(employees.code, emp.code)));
    if (!existing) {
      await db.insert(employees).values({
        id: generateId(),
        businessId,
        outletId: outlet!.id,
        code: emp.code,
        fullName: emp.fullName,
        role: emp.role,
        pinHash,
        isSharedAccount: emp.isSharedAccount,
      });
      console.log(`[employees] dibuat: ${emp.fullName} (${emp.code}, ${emp.role}), PIN: ${DEMO_PIN}`);
    } else {
      await db
        .update(employees)
        .set({
          outletId: outlet!.id,
          pinHash,
          isSharedAccount: emp.isSharedAccount,
          isActive: true,
          failedAttempts: 0,
          lockedUntil: null,
        })
        .where(eq(employees.id, existing.id));
      console.log(`[employees] sudah ada: ${emp.fullName} (${emp.code}) -- PIN direset ke ${DEMO_PIN}`);
    }
  }

  // --- Device kasir ---
  let [device] = await db
    .select()
    .from(devices)
    .where(and(eq(devices.businessId, businessId), eq(devices.serialNumber, DEVICE_SERIAL)));
  if (!device) {
    const id = generateId();
    await db.insert(devices).values({
      id,
      businessId,
      outletId: outlet!.id,
      serialNumber: DEVICE_SERIAL,
      name: DEVICE_NAME,
      deviceType: "pos",
    });
    [device] = await db.select().from(devices).where(eq(devices.id, id));
    console.log(`[devices] dibuat: ${DEVICE_NAME} (${DEVICE_SERIAL})`);
  } else {
    console.log(`[devices] sudah ada: ${DEVICE_NAME} (${DEVICE_SERIAL})`);
  }

  // --- Kategori contoh (scope=thrifting) ---
  let [category] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.businessId, businessId), eq(categories.name, "Pakaian")));
  if (!category) {
    const id = generateId();
    await db.insert(categories).values({ id, businessId, name: "Pakaian", scope: "thrifting" });
    [category] = await db.select().from(categories).where(eq(categories.id, id));
    console.log("[categories] dibuat: Pakaian (thrifting)");
  } else {
    console.log("[categories] sudah ada: Pakaian");
  }

  // --- Pemilik titipan contoh ---
  let [owner] = await db
    .select()
    .from(pemilik)
    .where(and(eq(pemilik.businessId, businessId), eq(pemilik.nama, "Titipan Contoh")));
  if (!owner) {
    const id = generateId();
    await db.insert(pemilik).values({ id, businessId, nama: "Titipan Contoh", persenBagi: "60" });
    [owner] = await db.select().from(pemilik).where(eq(pemilik.id, id));
    console.log("[pemilik] dibuat: Titipan Contoh (60%)");
  } else {
    console.log("[pemilik] sudah ada: Titipan Contoh");
  }

  // --- Barang demo BARU setiap run (barang unik cuma bisa terjual sekali) ---
  const barangId = generateId();
  const kode = generateBarangKode(outlet!.code);
  const HARGA_JUAL = "150000";
  const HARGA_MODAL = "50000";
  await db.insert(barang).values({
    id: barangId,
    businessId,
    outletId: outlet!.id,
    kode,
    categoryId: category!.id,
    nama: "Kaos Demo Checkpoint",
    ukuran: "M",
    warna: "Hitam",
    kondisi: "Sangat baik",
    hargaModal: HARGA_MODAL,
    hargaJual: HARGA_JUAL,
    status: "siap_jual",
    pemilikId: owner!.id,
  });
  console.log(`[barang] dibuat & langsung siap_jual: ${kode} -- Rp${HARGA_JUAL} (modal Rp${HARGA_MODAL}, pemilik 60%)`);

  // --- Buka shift Ita di device ini kalau belum ada shift terbuka ---
  // Pelajaran 11 September 2026 (CEO): skrip yang MEMBUKA shift WAJIB
  // menutupnya lagi di finally -- shift yang tertinggal terbuka dari
  // run sebelumnya membuat /pos/thrift bisa diakses tanpa PIN sama
  // sekali (bukan celah kode, tapi keadaan tidak dipulihkan, pola sama
  // insiden password Qasim-Ryan). `openedByThisRun` cuma true kalau
  // SKRIP INI yang membuka shiftnya -- shift yang sudah terbuka dari
  // luar (mis. CEO sedang mencoba manual) TIDAK PERNAH ditutup paksa.
  let shift = await getOpenShiftForDevice(db, businessId, device!.id);
  let openedByThisRun = false;
  if (!shift) {
    const openResult = await openShiftWithDb(db, businessId, {
      id: generateId(),
      outletId: outlet!.id,
      deviceId: device!.id,
      employeeCode: ITA_CODE,
      pin: DEMO_PIN,
      openingCash: "0",
      servedByName: "",
    });
    if (openResult.error) {
      throw new Error(`Gagal buka shift: ${openResult.error}`);
    }
    console.log(`[shift] dibuka untuk ${openResult.success!.employeeName}`);
    shift = await getOpenShiftForDevice(db, businessId, device!.id);
    openedByThisRun = true;
  } else {
    console.log(`[shift] sudah terbuka untuk ${shift.employeeName} -- dibiarkan terbuka (bukan milik skrip ini)`);
  }
  const [demoBusiness] = await db
    .select({ timezone: businesses.timezone })
    .from(businesses)
    .where(eq(businesses.id, businessId));
  if (!shift || !isShiftSellable(shift, demoBusiness?.timezone ?? "Asia/Jakarta", outlet!.dayCutoffTime)) {
    throw new Error("Shift tidak dalam kondisi bisa jualan (sedang proses tutup, atau basi?).");
  }
  const shiftId = shift.id;

  try {
    await runCheckpointSale();
  } finally {
    if (openedByThisRun) {
      await closeCashlessShiftWithDb(db, businessId, { shiftId });
      console.log(`[shift] ditutup lagi (dibuka oleh skrip ini) -- device siap minta PIN lagi.`);
    }
  }

  async function runCheckpointSale() {
  console.log("\n=== TITIK PERIKSA KEDUA: satu penjualan sungguhan, pindai sampai struk ===\n");
  const t0 = Date.now();

  // 1. "Pindai" -- lookup barang by kode, PERSIS fungsi yang dipanggil
  //    Server Action lookupBarangByKode() dari layar kasir sungguhan.
  const lookup = await findSellableBarangByKode(db, businessId, kode);
  if (lookup.error || !lookup.success) {
    throw new Error(`Lookup gagal: ${lookup.error}`);
  }
  console.log(`[pindai] ditemukan: ${lookup.success.nama} (${lookup.success.kode}) -- Rp${lookup.success.hargaJual}`);

  // 2. Bayar -- sellBarangWithDb() SUNGGUHAN, satu pembayaran non-tunai
  //    penuh (Transfer), TIDAK ADA baris tunai sama sekali.
  const orderId = generateId();
  const paymentId = generateId();
  const sellResult = await sellBarangWithDb(db, businessId, {
    orderId,
    outletId: outlet!.id,
    deviceId: device!.id,
    lines: [{ barangId: lookup.success.id }],
    payments: [
      { id: paymentId, paymentMethodId: transferMethod!.id, amount: HARGA_JUAL, reference: "DEMO-TRF-001" },
    ],
  });
  if (sellResult.error || !sellResult.success) {
    throw new Error(`Penjualan gagal: ${sellResult.error}`);
  }
  console.log(`[bayar] sukses -- struk ${sellResult.success.orderNumber}, total Rp${sellResult.success.total}, kembalian Rp${sellResult.success.change}`);

  // 3. Rakit struk -- fungsi produksi yang sama dipakai halaman
  //    /pos/receipt/[orderId].
  const orderData = await getOrderForReceiptById(db, businessId, sellResult.success.orderId);
  if (!orderData) {
    throw new Error("Order tidak ditemukan untuk struk");
  }
  const receipt = buildReceipt(orderData, new Date(), false);
  const t1 = Date.now();

  console.log(`\n[waktu] pindai -> struk siap: ${((t1 - t0) / 1000).toFixed(3)} detik (eksekusi server terhadap database dev sungguhan, BUKAN waktu ketuk layar manusia -- lihat catatan di atas file ini)`);

  console.log("\n--- Bukti struk (dirender dari data tersimpan, sama fungsi dipakai /pos/receipt) ---");
  console.log(`Outlet: ${receipt.outletName}`);
  console.log(`No. struk: ${receipt.orderNumber}`);
  console.log(`Kasir: ${receipt.cashierName}`);
  for (const line of receipt.lines) {
    console.log(`  ${line.productName} x${line.qty.toString()} = Rp${line.netAmount.toString()}`);
  }
  console.log(`Subtotal: Rp${receipt.subtotal.toString()}`);
  console.log(`Pajak (harus 0, harus TIDAK tampil di struk sungguhan): Rp${receipt.taxAmount.toString()} -- ${receipt.taxAmount.isZero() ? "baris disembunyikan otomatis oleh ReceiptView (isZero)" : "!! SEHARUSNYA NOL !!"}`);
  console.log(`Service charge: Rp${receipt.serviceCharge.toString()}`);
  console.log(`Total: Rp${receipt.total.toString()}`);
  for (const p of receipt.payments) {
    console.log(`  Bayar: ${p.methodName} Rp${p.amount.toString()}`);
  }

  // 4. Verifikasi baris order_items -- status barang + angka bagi hasil.
  const [itemRow] = await db.select().from(orderItems).where(eq(orderItems.id, lookup.success.id));
  const [barangRow] = await db.select().from(barang).where(eq(barang.id, lookup.success.id));
  console.log("\n--- Bukti baris transaksi (order_items) ---");
  console.log(`barang.status setelah terjual: ${barangRow!.status} (harus 'terjual')`);
  console.log(`pemilikBagiPercentAtSale (dipotret saat ini): ${itemRow!.pemilikBagiPercentAtSale}%`);
  console.log(`pemilikShareAmount: Rp${itemRow!.pemilikShareAmount}`);
  console.log(`tokoShareAmount: Rp${itemRow!.tokoShareAmount}`);
  console.log(
    `Cek: pemilikShareAmount + tokoShareAmount == netAmount? ${
      Number(itemRow!.pemilikShareAmount) + Number(itemRow!.tokoShareAmount) === Number(itemRow!.netAmount)
    }`
  );

  // 5. Bukti anti-jual-dobel -- coba jual barang YANG SAMA lagi, harus
  //    ditolak dengan pesan ramah (bukan galat Postgres mentah).
  console.log("\n--- Bukti anti-jual-dobel: mencoba menjual barang yang sama lagi ---");
  const secondAttempt = await sellBarangWithDb(db, businessId, {
    orderId: generateId(),
    outletId: outlet!.id,
    deviceId: device!.id,
    lines: [{ barangId: lookup.success.id }],
    payments: [
      { id: generateId(), paymentMethodId: transferMethod!.id, amount: HARGA_JUAL, reference: "DEMO-TRF-002" },
    ],
  });
  console.log(`Percobaan kedua ditolak: ${secondAttempt.error ?? "!!! TIDAK DITOLAK, INI BUG !!!"}`);

  console.log("\n=== SELESAI ===");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
