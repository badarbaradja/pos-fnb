/**
 * Pembatasan akses per outlet -- Tahap 3 (13 September 2026, §26), halaman
 * TERAKHIR 6/6: Laporan Bagi Hasil. Satu-satunya dari enam halaman yang
 * menyentuh pembayaran ke pihak LUAR (pemilik titipan) -- CEO minta tiga
 * hal spesifik dibuktikan, bukan cuma pola generik tiga-kasus biasa:
 *
 * 1. Angka pemilik "Salma" untuk outlet "BTHR" IDENTIK sebelum dan
 *    sesudah gerbang outlet dipasang, DILIHAT OWNER (scope tak
 *    terbatas) -- dibuktikan lewat getBagiHasilLaporan() (dipakai
 *    tabel di layar, TIDAK berubah sama sekali) DAN buildBagiHasilExport()
 *    (yang BARU dapat gerbang outlet) menghasilkan angka SAMA PERSIS.
 *    Satu rupiah beda berarti gerbang baru ikut mengubah kalkulasi,
 *    bukan cuma menyaring akses.
 * 2. Manajer dibatasi ke outlet LAIN ("OTHER"): laporan BTHR tidak
 *    terlihat sama sekali -- lewat DUA jalur, daftar outlet (yang
 *    mengisi dropdown DAN jadi sumber selectedOutlet, pola sama
 *    Laporan Stok) dan buildBagiHasilExport (status not_found kalau
 *    outletId BTHR diminta paksa lewat URL ekspor).
 * 3. Ekspor Excel dan "Tandai Sudah Dibayar" adalah jalur TERPISAH dari
 *    tabel -- masing-masing dites di file ini/bagi-hasil-export.test.ts
 *    dan payout-manage.test.ts, bukan diasumsikan ikut aman karena
 *    tabelnya sudah benar.
 *
 * Penjualan dibuat lewat sellBarangWithDb() SUNGGUHAN (pola sama
 * bagi-hasil-report.test.ts) supaya angka bagianPemilik yang dibandingkan
 * adalah hasil consignmentSplit() asli, bukan angka yang dikarang di tes.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { and, eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import { getAdminDb } from "@/lib/db/client";
import {
  barang,
  brands,
  businesses,
  devices,
  employees,
  orders,
  outlets,
  paymentMethods,
  pemilik,
  shifts,
} from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";
import { hashPin } from "@/lib/auth/pin";
import { businessDate } from "@/lib/utils/business-date";
import { openShiftWithDb } from "@/lib/pos/shift";
import { sellBarangWithDb } from "@/lib/pos/sell-barang";
import { confirmDayCutoffWithDb } from "@/lib/outlets/manage";
import { outletScopeCondition } from "@/lib/auth/outlet-scope";
import type { OutletScope } from "@/lib/auth/outlet-scope";
import { getBagiHasilLaporan } from "@/lib/db/queries/bagi-hasil-report";
import { buildBagiHasilExport } from "../bagi-hasil-export";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

describe.skipIf(!hasEnv)("Pembatasan akses per outlet, Tahap 3 -- Laporan Bagi Hasil (halaman terakhir)", () => {
  const db = getAdminDb();
  const PREFIX = `TEST_BAGIHASILSCOPE_${Date.now()}`;

  let businessId: string;
  let bthrOutletId: string;
  let otherOutletId: string;
  let salmaId: string;
  let startDate: string;
  let endDate: string;

  async function listThriftOutlets(allowedOutletIds: OutletScope) {
    return db
      .select({ id: outlets.id })
      .from(outlets)
      .where(
        and(
          eq(outlets.businessId, businessId),
          eq(outlets.posMode, "thrifting"),
          eq(outlets.isActive, true),
          outletScopeCondition(allowedOutletIds, outlets.id)
        )
      );
  }

  beforeAll(async () => {
    const [business] = await db
      .insert(businesses)
      .values({ name: `${PREFIX}_business`, timezone: "Asia/Jakarta" })
      .returning({ id: businesses.id, timezone: businesses.timezone });
    businessId = business!.id;

    const [brand] = await db.insert(brands).values({ businessId, name: `${PREFIX}_brand` }).returning({ id: brands.id });

    const [bthr] = await db
      .insert(outlets)
      .values({
        businessId,
        brandId: brand!.id,
        code: "BTHR",
        name: "Bestie Thrift Harmoni",
        posMode: "thrifting",
        taxPercent: "0",
        serviceChargePercent: "0",
      })
      .returning({ id: outlets.id, dayCutoffTime: outlets.dayCutoffTime });
    bthrOutletId = bthr!.id;

    const [other] = await db
      .insert(outlets)
      .values({
        businessId,
        brandId: brand!.id,
        code: "OTHER",
        name: "Outlet Lain",
        posMode: "thrifting",
        taxPercent: "0",
        serviceChargePercent: "0",
      })
      .returning({ id: outlets.id });
    otherOutletId = other!.id;

    await confirmDayCutoffWithDb(db, businessId, null, bthrOutletId);

    const [device] = await db
      .insert(devices)
      .values({ businessId, outletId: bthrOutletId, serialNumber: "BTHR-DEV1", name: "Kasir BTHR" })
      .returning({ id: devices.id });

    const [cashMethod] = await db
      .insert(paymentMethods)
      .values({ businessId, code: "CASH", name: "Tunai", type: "cash", isCashDrawer: true })
      .returning({ id: paymentMethods.id });

    const pinHash = await hashPin("135791");
    await db.insert(employees).values({
      businessId,
      outletId: bthrOutletId,
      code: "BTHRKASIR",
      fullName: `${PREFIX}_kasir`,
      role: "cashier",
      pinHash,
    });

    await openShiftWithDb(db, businessId, {
      id: generateId(),
      outletId: bthrOutletId,
      deviceId: device!.id,
      employeeCode: "BTHRKASIR",
      pin: "135791",
      openingCash: "0",
    });

    const [salma] = await db
      .insert(pemilik)
      .values({ businessId, nama: "Salma", persenBagi: "60" })
      .returning({ id: pemilik.id });
    salmaId = salma!.id;

    // Satu barang, harga BULAT (100000) supaya bagianPemilik (60%) juga
    // bulat (60000) -- tidak ada pembulatan yang bisa menyamarkan
    // pergeseran satu rupiah kalau gerbang outlet baru ikut mengubah
    // kalkulasi.
    const [item] = await db
      .insert(barang)
      .values({
        businessId,
        outletId: bthrOutletId,
        kode: `${PREFIX}-SALMA1`,
        nama: "Blazer Salma",
        hargaJual: "100000",
        status: "siap_jual",
        pemilikId: salmaId,
      })
      .returning({ id: barang.id });

    const sellResult = await sellBarangWithDb(db, businessId, {
      orderId: generateId(),
      outletId: bthrOutletId,
      deviceId: device!.id,
      lines: [{ barangId: item!.id }],
      payments: [{ id: generateId(), paymentMethodId: cashMethod!.id, amount: "100000", reference: "" }],
    });
    if (sellResult.error || !sellResult.success) {
      throw new Error(`Gagal jual barang uji Salma: ${sellResult.error}`);
    }

    const today = businessDate(new Date(), business!.timezone, bthr!.dayCutoffTime);
    startDate = `${today.slice(0, 7)}-01`;
    endDate = today;
  });

  afterAll(async () => {
    // orders/shifts.business_id TIDAK cascade dari businesses (NO
    // ACTION, pola sama sales-report.test.ts) -- hapus dulu sebelum
    // businesses.
    if (businessId) {
      await db.delete(orders).where(eq(orders.businessId, businessId));
      await db.delete(shifts).where(eq(shifts.businessId, businessId));
      await db.delete(businesses).where(eq(businesses.id, businessId));
    }
  });

  it("data uji terbentuk (Salma jual 1 barang 100000 di BTHR)", () => {
    expect(bthrOutletId).toBeTruthy();
    expect(otherOutletId).toBeTruthy();
    expect(salmaId).toBeTruthy();
  });

  describe("1. Angka Salma IDENTIK sebelum/sesudah gerbang outlet, dilihat owner (scope tak terbatas)", () => {
    it("getBagiHasilLaporan (dipakai tabel di layar, TIDAK disentuh Tahap 3 -- signature tidak berubah): bagianPemilik Salma = 60000", async () => {
      const rows = await getBagiHasilLaporan(db, {
        businessId,
        outletId: bthrOutletId,
        businessTimezone: "Asia/Jakarta",
        startDate,
        endDate,
      });
      const salmaRow = rows.find((r) => r.pemilikNama === "Salma");
      expect(salmaRow).toBeTruthy();
      expect(Number(salmaRow!.bagianPemilik)).toBe(60000);
    });

    it("buildBagiHasilExport dengan allowedOutletIds NULL (owner): angka Salma di file Excel SAMA PERSIS (60000), gerbang baru tidak ikut mengubah kalkulasi", async () => {
      const result = await buildBagiHasilExport(db, {
        businessId,
        outletId: bthrOutletId,
        startDate,
        endDate,
        allowedOutletIds: null,
      });
      expect(result.status).toBe("ok");
      if (result.status !== "ok") throw new Error("harus ok");

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(result.buffer as unknown as ArrayBuffer);
      const sheet = workbook.worksheets[0]!;
      const headerRow = sheet.getRow(3).values as unknown[];
      const pemilikCol = headerRow.indexOf("Pemilik");
      const bagianPemilikCol = headerRow.indexOf("Bagian Pemilik");
      expect(pemilikCol).toBeGreaterThan(0);
      expect(bagianPemilikCol).toBeGreaterThan(0);

      let salmaRowValues: unknown[] | undefined;
      for (let r = 4; r <= sheet.rowCount; r++) {
        const rowValues = sheet.getRow(r).values as unknown[];
        if (rowValues[pemilikCol] === "Salma") {
          salmaRowValues = rowValues;
          break;
        }
      }
      expect(salmaRowValues).toBeTruthy();
      expect(Number(salmaRowValues![bagianPemilikCol])).toBe(60000);
    });
  });

  describe("2. Manajer dibatasi ke outlet LAIN: BTHR tidak terlihat sama sekali", () => {
    it("daftar outlet (dropdown + fallback selectedOutlet): scope [OTHER] TIDAK memuat BTHR sama sekali", async () => {
      const rows = await listThriftOutlets([otherOutletId]);
      expect(rows.map((r) => r.id)).toEqual([otherOutletId]);
    });

    it("scope null: KEDUA outlet (BTHR dan OTHER) muncul", async () => {
      const rows = await listThriftOutlets(null);
      expect(rows.map((r) => r.id).sort()).toEqual([bthrOutletId, otherOutletId].sort());
    });

    it("buildBagiHasilExport: outletId BTHR diminta paksa lewat URL dengan allowedOutletIds=[OTHER] -- status not_found, bukan data Salma bocor", async () => {
      const result = await buildBagiHasilExport(db, {
        businessId,
        outletId: bthrOutletId,
        startDate,
        endDate,
        allowedOutletIds: [otherOutletId],
      });
      expect(result.status).toBe("not_found");
    });
  });

  describe("3. Scope array KOSONG: sama sekali tidak ada outlet, termasuk BTHR", () => {
    it("daftar outlet: NOL outlet, bukan semua outlet", async () => {
      const rows = await listThriftOutlets([]);
      expect(rows).toHaveLength(0);
    });

    it("buildBagiHasilExport: status not_found, bukan tabel/file kosong yang terbaca sebagai 'belum ada penjualan'", async () => {
      const result = await buildBagiHasilExport(db, {
        businessId,
        outletId: bthrOutletId,
        startDate,
        endDate,
        allowedOutletIds: [],
      });
      expect(result.status).toBe("not_found");
    });
  });
});
