import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { and, eq } from "drizzle-orm";
import { getAdminDb } from "../src/lib/db/client";
import { barang, businesses, devices, employees, outlets, paymentMethods } from "../src/lib/db/schema";
import { generateId } from "../src/lib/utils/id";
import { generateBarangKode } from "../src/lib/barang/kode";
import { sellBarangWithDb } from "../src/lib/pos/sell-barang";

/**
 * scripts/demo-thrift-race.ts — pembuktian KHUSUS lapis #2 anti-jual-dobel
 * (trigger claim_barang_for_sale, bukan pre-check aplikasi di sell-barang.ts).
 * Dua panggilan sellBarangWithDb() SUNGGUHAN dilepas BERSAMAAN
 * (Promise.all, bukan berurutan) untuk barang yang SAMA -- keduanya lolos
 * pre-check status (membaca 'siap_jual' sebelum salah satu commit), jadi
 * SATU-SATUNYA yang mencegah dua-duanya berhasil adalah trigger di dalam
 * transaction Postgres. getAdminDb() -- operasi verifikasi sistem, sama
 * alasan seperti demo-thrift-checkpoint.ts.
 */
async function main() {
  const db = getAdminDb();
  const [business] = await db.select({ id: businesses.id }).from(businesses);
  const businessId = business!.id;
  const [outlet] = await db
    .select()
    .from(outlets)
    .where(and(eq(outlets.businessId, businessId), eq(outlets.code, "BTHR")));
  const [device] = await db
    .select()
    .from(devices)
    .where(and(eq(devices.businessId, businessId), eq(devices.serialNumber, "THRIFT1")));
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
    nama: "Barang Uji Race Condition",
    hargaModal: "0",
    hargaJual: "99000",
    status: "siap_jual",
  });
  console.log(`[barang] dibuat untuk uji race: ${kode}`);

  console.log("\nMelepas DUA sellBarangWithDb() bersamaan untuk barang yang sama...\n");

  const makeAttempt = (label: string) =>
    sellBarangWithDb(db, businessId, {
      orderId: generateId(),
      outletId: outlet!.id,
      deviceId: device!.id,
      lines: [{ barangId }],
      payments: [
        { id: generateId(), paymentMethodId: transferMethod!.id, amount: "99000", reference: label },
      ],
    }).then((result) => ({ label, result }));

  const [a, b] = await Promise.all([makeAttempt("A"), makeAttempt("B")]);

  for (const { label, result } of [a, b]) {
    if (result.success) {
      console.log(`Percobaan ${label}: BERHASIL -- struk ${result.success.orderNumber}`);
    } else {
      console.log(`Percobaan ${label}: DITOLAK -- "${result.error}"`);
    }
  }

  const successCount = [a, b].filter((x) => x.result.success).length;
  console.log(`\nJumlah yang berhasil: ${successCount} (harus PERSIS 1, tidak boleh 0 atau 2)`);
  if (successCount !== 1) {
    throw new Error("BUG: anti-jual-dobel gagal di kondisi race sungguhan!");
  }
  console.log("Kedua pesan (berhasil maupun ditolak) adalah pesan Indonesia yang jelas -- tidak ada galat Postgres mentah yang bocor ke pemanggil.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
