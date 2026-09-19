/**
 * Test integrasi endpoint omzet harian untuk sistem laporan (19 September
 * 2026). Butuh koneksi Supabase sungguhan (DATABASE_URL +
 * NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) -- di-skip otomatis
 * kalau env belum diisi, bukan hijau palsu. Pola fixture sama dengan
 * src/lib/db/queries/__tests__/sales-report.test.ts.
 *
 * Yang diuji BUKAN sekadar "bentuk JSON benar" tapi PARITAS angka dengan
 * laporan POS sendiri (getSalesSummary / getSalesByPaymentMethod) -- kalau
 * definisi bergeser, tes ini merah.
 *
 * getAdminDb() dipakai di sini SENGAJA (test, bukan kode aplikasi): fixture
 * business/outlet/device dibuat dari nol. Data uji berprefiks
 * TEST_OMZETINT_ dan dibersihkan di afterAll.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
import { eq } from "drizzle-orm";
import { Decimal } from "decimal.js";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { getAdminDb } from "@/lib/db/client";
import {
  brands,
  businesses,
  devices,
  employees,
  orders,
  outlets,
  paymentMethods,
  priceTiers,
  productPrices,
  products,
  refunds,
  shifts,
} from "@/lib/db/schema";
import { hashPin } from "@/lib/auth/pin";
import { generateId } from "@/lib/utils/id";
import { businessDate } from "@/lib/utils/business-date";
import { openShiftWithDb } from "@/lib/pos/shift";
import { payOrderWithDb } from "@/lib/pos/pay-order";
import { refundOrderWithDb, voidOrderWithDb } from "@/lib/pos/void-refund";
import { getSalesByPaymentMethod, getSalesSummary } from "@/lib/db/queries/sales-report";
import { getOmzetHarian, RentangTidakValid } from "../omzet-harian";
import { GET } from "@/app/api/integrasi/omzet-harian/route";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

describe.skipIf(!hasEnv)("integrasi -- omzet harian", () => {
  const db = getAdminDb();
  const PREFIX = `TEST_OMZETINT_${Date.now()}`;
  const PIN = "246813";
  const EMPLOYEE_CODE = "OMZKASIR";
  const TOKEN = "u".repeat(40);

  let businessId: string;
  let otherBusinessId: string;
  let brandId: string;
  let outletId: string;
  let outletKosongId: string;
  let outletNonaktifKosongId: string;
  let otherOutletId: string;
  let deviceId: string;
  let qrisMethodId: string;
  let priceTierId: string;
  let productId: string;
  let today: string;
  let zona: string;

  async function payOrder(qty: string) {
    const orderId = generateId();
    const lineId = generateId();
    const result = await payOrderWithDb(db, businessId, {
      orderId,
      outletId,
      deviceId,
      priceTierId,
      lines: [{ id: lineId, productId, variantId: null, modifierIds: [], qty, itemDiscount: "0", note: "" }],
      discountType: "none",
      orderDiscountAmount: "0",
      orderDiscountPercentInput: "0",
      payments: [{ id: generateId(), paymentMethodId: qrisMethodId, amount: "999999", reference: "REF123" }],
    });
    expect(result.success).toBeTruthy();
    return { orderId, lineId };
  }

  async function omzet(extra: { sekarang?: Date } = {}) {
    return getOmzetHarian(db, { businessId, dari: today, sampai: today, ...extra });
  }

  async function baris() {
    const hasil = await omzet();
    const o = hasil.outlet.find((x) => x.outlet_id === outletId);
    return { hasil, outlet: o, hari: o?.hari.find((h) => h.tanggal === today) };
  }

  async function paritasDenganLaporanPos() {
    const filter = { businessId, outletId, startDate: today, endDate: today };
    const ringkasan = await getSalesSummary(db, filter);
    const metode = await getSalesByPaymentMethod(db, filter);
    const uang = metode.reduce((t, m) => t.plus(m.amount), new Decimal(0));
    return {
      netSales: new Decimal(ringkasan.netSales),
      uang,
      orderCount: ringkasan.orderCount,
      refund: new Decimal(ringkasan.refundTotal),
    };
  }

  const bulat = (d: Decimal) => d.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();

  beforeAll(async () => {
    const [business] = await db
      .insert(businesses)
      .values({ name: `${PREFIX}_business` })
      .returning({ id: businesses.id, timezone: businesses.timezone });
    businessId = business!.id;
    zona = business!.timezone;

    const [other] = await db.insert(businesses).values({ name: `${PREFIX}_bisnis_lain` }).returning({ id: businesses.id });
    otherBusinessId = other!.id;
    const [otherBrand] = await db
      .insert(brands)
      .values({ businessId: otherBusinessId, name: `${PREFIX}_brand_lain` })
      .returning({ id: brands.id });
    const [otherOutlet] = await db
      .insert(outlets)
      .values({ businessId: otherBusinessId, brandId: otherBrand!.id, code: "OL1", name: `${PREFIX}_outlet_bisnis_lain` })
      .returning({ id: outlets.id });
    otherOutletId = otherOutlet!.id;

    const [brand] = await db.insert(brands).values({ businessId, name: `${PREFIX}_brand` }).returning({ id: brands.id });
    brandId = brand!.id;

    const [outlet] = await db
      .insert(outlets)
      .values({ businessId, brandId, code: "OM1", name: `${PREFIX}_outlet` })
      .returning({ id: outlets.id, dayCutoffTime: outlets.dayCutoffTime });
    outletId = outlet!.id;
    today = businessDate(new Date(), zona, outlet!.dayCutoffTime);

    const [kosong] = await db
      .insert(outlets)
      .values({ businessId, brandId, code: "OM2", name: `${PREFIX}_outlet_kosong` })
      .returning({ id: outlets.id });
    outletKosongId = kosong!.id;
    const [nonaktif] = await db
      .insert(outlets)
      .values({ businessId, brandId, code: "OM3", name: `${PREFIX}_outlet_nonaktif_kosong`, isActive: false })
      .returning({ id: outlets.id });
    outletNonaktifKosongId = nonaktif!.id;

    const [device] = await db
      .insert(devices)
      .values({ businessId, outletId, serialNumber: "OMDEV1", name: "Kasir Uji OM" })
      .returning({ id: devices.id });
    deviceId = device!.id;

    await db.insert(employees).values({
      businessId,
      outletId,
      code: EMPLOYEE_CODE,
      fullName: `${PREFIX}_employee`,
      role: "cashier",
      pinHash: await hashPin(PIN),
    });

    const [qris] = await db
      .insert(paymentMethods)
      .values({ businessId, code: "QRIS", name: "QRIS", type: "qris", isCashDrawer: false })
      .returning({ id: paymentMethods.id });
    qrisMethodId = qris!.id;

    const [tier] = await db
      .insert(priceTiers)
      .values({ businessId, code: "DINEIN", name: "Dine In", isDefault: true })
      .returning({ id: priceTiers.id });
    priceTierId = tier!.id;

    const [product] = await db
      .insert(products)
      .values({ businessId, name: `${PREFIX}_product`, isTaxable: false })
      .returning({ id: products.id });
    productId = product!.id;
    await db.insert(productPrices).values({ productId, priceTierId, price: "50000" });

    const openResult = await openShiftWithDb(db, businessId, {
      id: generateId(),
      outletId,
      deviceId,
      employeeCode: EMPLOYEE_CODE,
      pin: PIN,
      openingCash: "0",
    });
    expect(openResult.success).toBeTruthy();
  });

  afterAll(async () => {
    for (const id of [businessId, otherBusinessId]) {
      if (!id) continue;
      const orderRows = await db.select({ id: orders.id }).from(orders).where(eq(orders.businessId, id));
      for (const o of orderRows) await db.delete(refunds).where(eq(refunds.orderId, o.id));
      await db.delete(orders).where(eq(orders.businessId, id));
      await db.delete(shifts).where(eq(shifts.businessId, id));
      await db.delete(businesses).where(eq(businesses.id, id));
    }
  });

  it("fixture benar-benar terbentuk (bukan hijau karena kosong)", () => {
    for (const v of [
      businessId,
      otherBusinessId,
      outletId,
      outletKosongId,
      outletNonaktifKosongId,
      otherOutletId,
      deviceId,
      qrisMethodId,
      productId,
      today,
    ]) {
      expect(v).toBeTruthy();
    }
  });

  it("outlet aktif tanpa order tetap muncul dengan hari kosong; nonaktif tanpa data dan outlet bisnis lain TIDAK muncul", async () => {
    const { hasil } = await baris();
    const kosong = hasil.outlet.find((o) => o.outlet_id === outletKosongId);
    expect(kosong).toBeDefined();
    expect(kosong!.hari).toEqual([]);
    expect(hasil.outlet.find((o) => o.outlet_id === outletNonaktifKosongId)).toBeUndefined();
    expect(hasil.outlet.find((o) => o.outlet_id === otherOutletId)).toBeUndefined();
  });

  it("outlet tanpa order sama sekali: baris hari TIDAK ada (bukan baris bernilai 0) -- sisi laporan menampilkan 'Belum ada transaksi POS'", async () => {
    const { outlet, hari } = await baris();
    expect(outlet).toBeDefined();
    expect(hari).toBeUndefined();
  });

  it("dua order paid: jumlah, penjualan_bersih, dan uang_diterima sama persis dengan laporan POS sendiri", async () => {
    await payOrder("1");
    await payOrder("1");
    const { hari } = await baris();
    const pos = await paritasDenganLaporanPos();
    expect(hari).toBeDefined();
    expect(hari!.jumlah_order).toBe(2);
    expect(hari!.jumlah_order).toBe(pos.orderCount);
    expect(hari!.penjualan_bersih).toBe(100000);
    expect(hari!.penjualan_bersih).toBe(bulat(pos.netSales));
    expect(hari!.uang_diterima).toBe(bulat(pos.uang));
    expect(hari!.refund).toBe(0);
    // Produk tidak kena pajak, jadi uang yang masuk = penjualan bersih (dua angka BOLEH sama, tapi dihitung dari sumber berbeda).
    expect(hari!.uang_diterima).toBe(100000);
  });

  it("order void tidak masuk hitungan", async () => {
    const sebelum = (await baris()).hari!;
    const { orderId } = await payOrder("1");
    const setelahBayar = (await baris()).hari!;
    expect(setelahBayar.jumlah_order).toBe(sebelum.jumlah_order + 1);
    const voided = await voidOrderWithDb(db, businessId, null, { orderId, reason: "uji integrasi -- void", restock: false });
    expect(voided.success).toBeTruthy();
    const setelahVoid = (await baris()).hari!;
    expect(setelahVoid.jumlah_order).toBe(sebelum.jumlah_order);
    expect(setelahVoid.penjualan_bersih).toBe(sebelum.penjualan_bersih);
    expect(setelahVoid.uang_diterima).toBe(sebelum.uang_diterima);
  });

  it("refund: penjualan_bersih turun sebesar refund (paritas getSalesSummary), uang_diterima TIDAK ikut turun, refund tercatat", async () => {
    const sebelum = (await baris()).hari!;
    const { orderId, lineId } = await payOrder("1");
    const refundResult = await refundOrderWithDb(db, businessId, null, {
      id: generateId(),
      orderId,
      paymentMethodId: qrisMethodId,
      reference: "",
      restock: false,
      reason: "uji integrasi -- refund",
      lines: [{ orderItemId: lineId, qty: "1" }],
    });
    expect(refundResult.success).toBeTruthy();

    const setelah = (await baris()).hari!;
    const pos = await paritasDenganLaporanPos();
    // Order baru +50000 lalu direfund penuh -> penjualan_bersih kembali seperti sebelum;
    // uang_diterima naik 50000 (uang sempat masuk, refund tidak mengurangi angka ini).
    expect(setelah.penjualan_bersih).toBe(sebelum.penjualan_bersih);
    expect(setelah.penjualan_bersih).toBe(bulat(pos.netSales));
    expect(setelah.uang_diterima).toBe(sebelum.uang_diterima + 50000);
    expect(setelah.refund).toBe(sebelum.refund + 50000);
    expect(setelah.refund).toBe(bulat(pos.refund));
  });

  it("hari_bisnis_berjalan mengikuti batas hari 04:00 di zona bisnis (bukan tanggal kalender UTC atau server)", async () => {
    // Asia/Jakarta = UTC+7. 03:59 WIB tanggal 19 masih hari bisnis 18; 04:00 WIB sudah 19.
    expect(zona).toBe("Asia/Jakarta");
    const sebelumBatas = await omzet({ sekarang: new Date("2026-09-18T20:59:00Z") });
    const sesudahBatas = await omzet({ sekarang: new Date("2026-09-18T21:00:00Z") });
    const o1 = sebelumBatas.outlet.find((o) => o.outlet_id === outletId)!;
    const o2 = sesudahBatas.outlet.find((o) => o.outlet_id === outletId)!;
    expect(o1.hari_bisnis_berjalan).toBe("2026-09-18");
    expect(o2.hari_bisnis_berjalan).toBe("2026-09-19");
    expect(o1.batas_hari).toBe("04:00");
    expect(typeof o1.batas_hari_terkonfirmasi).toBe("boolean");
  });

  it("rentang tidak valid dilempar sebagai RentangTidakValid (route -> 400)", async () => {
    await expect(getOmzetHarian(db, { businessId, dari: "2026-09-19", sampai: "2026-09-01" })).rejects.toBeInstanceOf(
      RentangTidakValid
    );
    await expect(getOmzetHarian(db, { businessId, dari: "2026-08-01", sampai: "2026-09-19" })).rejects.toBeInstanceOf(
      RentangTidakValid
    );
    await expect(getOmzetHarian(db, { businessId, dari: "bukan-tanggal", sampai: "2026-09-19" })).rejects.toBeInstanceOf(
      RentangTidakValid
    );
  });

  it("outlet yang DINONAKTIFKAN tapi masih punya data pada rentang tetap dikirim (aktif=false), penjualannya tidak lenyap", async () => {
    await db.update(outlets).set({ isActive: false }).where(eq(outlets.id, outletId));
    try {
      const { outlet, hari } = await baris();
      expect(outlet).toBeDefined();
      expect(outlet!.aktif).toBe(false);
      expect(hari).toBeDefined();
    } finally {
      await db.update(outlets).set({ isActive: true }).where(eq(outlets.id, outletId));
    }
  });

  describe("route GET /api/integrasi/omzet-harian", () => {
    const asli = { token: process.env["INTEGRASI_LAPORAN_TOKEN"], bisnis: process.env["INTEGRASI_BUSINESS_ID"] };
    afterEach(() => {
      if (asli.token === undefined) delete process.env["INTEGRASI_LAPORAN_TOKEN"];
      else process.env["INTEGRASI_LAPORAN_TOKEN"] = asli.token;
      if (asli.bisnis === undefined) delete process.env["INTEGRASI_BUSINESS_ID"];
      else process.env["INTEGRASI_BUSINESS_ID"] = asli.bisnis;
    });

    const minta = (query = "", token: string | null = TOKEN) =>
      GET(
        new Request(`http://localhost/api/integrasi/omzet-harian${query}`, {
          headers: token === null ? {} : { Authorization: `Bearer ${token}` },
        })
      );

    it("503 kalau belum dikonfigurasi", async () => {
      delete process.env["INTEGRASI_LAPORAN_TOKEN"];
      delete process.env["INTEGRASI_BUSINESS_ID"];
      const res = await minta();
      expect(res.status).toBe(503);
    });

    it("401 tanpa token atau token salah, dan jawabannya tidak memuat data apa pun", async () => {
      process.env["INTEGRASI_LAPORAN_TOKEN"] = TOKEN;
      process.env["INTEGRASI_BUSINESS_ID"] = businessId;
      expect((await minta("", null)).status).toBe(401);
      const salah = await minta("", "z".repeat(40));
      expect(salah.status).toBe(401);
      expect(salah.headers.get("WWW-Authenticate")).toBe("Bearer");
      expect(await salah.text()).not.toContain(businessId);
    });

    it("400 untuk parameter tanggal buruk", async () => {
      process.env["INTEGRASI_LAPORAN_TOKEN"] = TOKEN;
      process.env["INTEGRASI_BUSINESS_ID"] = businessId;
      expect((await minta("?dari=2026-02-30&sampai=2026-03-01")).status).toBe(400);
      expect((await minta("?dari=2026-01-01&sampai=2026-09-19")).status).toBe(400);
    });

    it("200 dengan token benar: bentuk kontrak, no-store, dan hanya bisnis yang dikonfigurasi", async () => {
      process.env["INTEGRASI_LAPORAN_TOKEN"] = TOKEN;
      process.env["INTEGRASI_BUSINESS_ID"] = businessId;
      const res = await minta(`?dari=${today}&sampai=${today}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      const json = await res.json();
      expect(json.versi).toBe(1);
      expect(json.zona_waktu).toBe("Asia/Jakarta");
      expect(json.dari).toBe(today);
      expect(json.sampai).toBe(today);
      expect(typeof json.dihitung_pada).toBe("string");
      const ids = json.outlet.map((o: { outlet_id: string }) => o.outlet_id);
      expect(ids).toContain(outletId);
      expect(ids).not.toContain(otherOutletId);
      const punyaKita = json.outlet.find((o: { outlet_id: string }) => o.outlet_id === outletId);
      expect(punyaKita.hari[0]).toEqual(
        expect.objectContaining({
          tanggal: today,
          jumlah_order: expect.any(Number),
          uang_diterima: expect.any(Number),
          penjualan_bersih: expect.any(Number),
          refund: expect.any(Number),
        })
      );
      // Tidak ada data individual yang bocor.
      expect(JSON.stringify(json)).not.toMatch(/employee|pin|customer|product/i);
    });

    it("terikat ke SATU bisnis: business id bisnis lain hanya melihat outlet bisnis itu", async () => {
      process.env["INTEGRASI_LAPORAN_TOKEN"] = TOKEN;
      process.env["INTEGRASI_BUSINESS_ID"] = otherBusinessId;
      const json = await (await minta(`?dari=${today}&sampai=${today}`)).json();
      const ids = json.outlet.map((o: { outlet_id: string }) => o.outlet_id);
      expect(ids).toEqual([otherOutletId]);
    });
  });
});
