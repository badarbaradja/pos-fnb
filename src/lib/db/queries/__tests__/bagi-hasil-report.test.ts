/**
 * TT11 — Test integrasi laporan bagi hasil bulanan PENUH. Butuh koneksi
 * Supabase sungguhan, pola sama sales-report.test.ts -- di-skip otomatis
 * kalau env belum diisi.
 *
 * Penjualan dibuat lewat sellBarangWithDb() SUNGGUHAN (bukan insert
 * manual order_items) -- supaya pemilikShareAmount/tokoShareAmount yang
 * diuji benar-benar hasil consignmentSplit() asli, bukan angka yang kita
 * karang sendiri di test.
 *
 * Data uji diberi prefix TEST_BAGIHASIL_ dan dibersihkan di afterAll.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
import { eq } from "drizzle-orm";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { getAdminDb } from "@/lib/db/client";
import { createSupabaseAdminClient } from "@/lib/auth/supabase";
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
  pemilikPayouts,
  profiles,
  shifts,
} from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";
import { hashPin } from "@/lib/auth/pin";
import { openShiftWithDb } from "@/lib/pos/shift";
import { sellBarangWithDb } from "@/lib/pos/sell-barang";
import { getBagiHasilLaporan } from "../bagi-hasil-report";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

describe.skipIf(!hasEnv)("TT11 — laporan bagi hasil bulanan penuh", () => {
  const db = getAdminDb();
  const PREFIX = `TEST_BAGIHASIL_${Date.now()}`;
  const TIMEZONE = "Asia/Jakarta";
  const TODAY = new Date().toISOString().slice(0, 10);

  let businessId: string;
  let outletId: string;
  let deviceId: string;
  let cashMethodId: string;
  let pemilikAId: string; // 60% -- akan jual barang
  let pemilikBId: string; // 50% -- TIDAK akan jual apa pun bulan ini
  let pemilikCId: string; // 70% -- barang laku SESUDAH endDate periode lama (uji terjualPada)
  let pemilikDId: string; // 80% -- jual di periode LAMA dan periode INI (uji terjualPeriode vs terjualKumulatif)
  let recorderProfileId: string; // akun dashboard yang "mencatat" pembayaran

  async function jualBarang(hargaJual: string, pemilikId: string) {
    // slice(-8) -- BUKAN slice(0, 8). UUID v7 8 karakter PERTAMA berasal
    // dari bit tinggi timestamp milidetik, nyaris konstan untuk beberapa
    // menit -- dua pemanggilan jualBarang() dalam file test yang sama
    // (proses cuma berjalan detik) menghasilkan STRING SAMA, menabrak
    // unique constraint (ditemukan 13 September 2026 saat menambah test
    // kedua yang memanggil helper ini). 8 karakter TERAKHIR berasal dari
    // rand_b (bagian acak sungguhan), aman dipakai berkali-kali.
    const kode = `${PREFIX}-${generateId().slice(-8)}`;
    const [item] = await db
      .insert(barang)
      .values({
        businessId,
        outletId,
        kode,
        nama: "Barang Uji",
        hargaJual,
        status: "siap_jual",
        pemilikId,
      })
      .returning({ id: barang.id });

    const result = await sellBarangWithDb(db, businessId, {
      orderId: generateId(),
      outletId,
      deviceId,
      lines: [{ barangId: item!.id }],
      payments: [{ id: generateId(), paymentMethodId: cashMethodId, amount: hargaJual, reference: "" }],
    });
    if (result.error || !result.success) {
      throw new Error(`Gagal jual barang uji: ${result.error}`);
    }
    return item!.id;
  }

  beforeAll(async () => {
    const [business] = await db
      .insert(businesses)
      .values({ name: `${PREFIX}_business`, timezone: TIMEZONE })
      .returning({ id: businesses.id });
    businessId = business!.id;

    const [brand] = await db
      .insert(brands)
      .values({ businessId, name: `${PREFIX}_brand` })
      .returning({ id: brands.id });

    const [outlet] = await db
      .insert(outlets)
      .values({
        businessId,
        brandId: brand!.id,
        code: "BH1",
        name: `${PREFIX}_outlet`,
        posMode: "thrifting",
        taxPercent: "0",
        serviceChargePercent: "0",
      })
      .returning({ id: outlets.id });
    outletId = outlet!.id;

    const [device] = await db
      .insert(devices)
      .values({ businessId, outletId, serialNumber: "BHDEV1", name: "Kasir Uji Bagi Hasil" })
      .returning({ id: devices.id });
    deviceId = device!.id;

    const [cashMethod] = await db
      .insert(paymentMethods)
      .values({ businessId, code: "CASH", name: "Tunai", type: "cash", isCashDrawer: true })
      .returning({ id: paymentMethods.id });
    cashMethodId = cashMethod!.id;

    // sellBarangWithDb() butuh shift terbuka untuk device ini -- Ita
    // biasanya, di sini cukup satu karyawan uji.
    const pinHash = await hashPin("135791");
    await db.insert(employees).values({
      businessId,
      outletId,
      code: "BHMGR",
      fullName: `${PREFIX}_manager`,
      role: "manager",
      pinHash,
    });
    const shiftResult = await openShiftWithDb(db, businessId, {
      id: generateId(),
      outletId,
      deviceId,
      employeeCode: "BHMGR",
      pin: "135791",
      openingCash: "0",
    });
    if (!shiftResult.success) {
      throw new Error("Gagal buka shift untuk fixture test bagi hasil");
    }

    const [pA] = await db
      .insert(pemilik)
      .values({ businessId, nama: `${PREFIX}_PemilikA`, persenBagi: "60" })
      .returning({ id: pemilik.id });
    pemilikAId = pA!.id;

    const [pB] = await db
      .insert(pemilik)
      .values({ businessId, nama: `${PREFIX}_PemilikB`, persenBagi: "50" })
      .returning({ id: pemilik.id });
    pemilikBId = pB!.id;

    const [pC] = await db
      .insert(pemilik)
      .values({ businessId, nama: `${PREFIX}_PemilikC`, persenBagi: "70" })
      .returning({ id: pemilik.id });
    pemilikCId = pC!.id;

    const [pD] = await db
      .insert(pemilik)
      .values({ businessId, nama: `${PREFIX}_PemilikD`, persenBagi: "80" })
      .returning({ id: pemilik.id });
    pemilikDId = pD!.id;

    // Titipan pemilikB yang BELUM terjual -- membuktikan "belum terjual"
    // dan "dititipkan" terhitung walau tidak ada penjualan bulan ini.
    await db.insert(barang).values({
      businessId,
      outletId,
      kode: `${PREFIX}-BELUM-JUAL`,
      nama: "Barang Belum Laku",
      hargaJual: "40000",
      status: "siap_jual",
      pemilikId: pemilikBId,
    });

    // Satu barang rusak milik pemilikA -- membuktikan identitas
    // dititipkan = terjual + belumTerjual + rusak.
    await db.insert(barang).values({
      businessId,
      outletId,
      kode: `${PREFIX}-RUSAK`,
      nama: "Barang Rusak",
      hargaJual: "20000",
      status: "rusak",
      pemilikId: pemilikAId,
    });

    // Penjualan sungguhan pemilikA: Rp1.850.000 @ 60% (contoh persis
    // SPESIFIKASI-THRIFTING.md §7 -> pemilik Rp1.110.000, toko Rp740.000).
    await jualBarang("1850000", pemilikAId);

    // Akun dashboard yang "mencatat" pembayaran -- pemilikPayouts.
    // recordedByUserId FK ke profiles.id, dan profiles.id sendiri FK ke
    // auth.users -- tidak bisa diisi UUID acak, perlu akun Supabase Auth
    // sungguhan (throwaway, dihapus di afterAll).
    const admin = createSupabaseAdminClient();
    const { data: authUser, error: authError } = await admin.auth.admin.createUser({
      email: `${PREFIX.toLowerCase()}-recorder@example.com`,
      password: "T3st-BagiHasilRecorder-P@ssw0rd!",
      email_confirm: true,
    });
    if (authError || !authUser.user) {
      throw authError ?? new Error("Gagal membuat akun uji recorder");
    }
    recorderProfileId = authUser.user.id;
    await db.insert(profiles).values({ id: recorderProfileId, fullName: `${PREFIX}_recorder` });
  });

  afterAll(async () => {
    if (businessId) {
      await db.delete(pemilikPayouts).where(eq(pemilikPayouts.businessId, businessId));
      // orders.shift_id FK ke shifts -- hapus dulu sebelum shifts, sama
      // pola sales-report.test.ts.
      await db.delete(orders).where(eq(orders.businessId, businessId));
      await db.delete(shifts).where(eq(shifts.businessId, businessId));
      await db.delete(businesses).where(eq(businesses.id, businessId));
    }
    if (recorderProfileId) {
      await db.delete(profiles).where(eq(profiles.id, recorderProfileId));
      const admin = createSupabaseAdminClient();
      await admin.auth.admin.deleteUser(recorderProfileId).catch(() => {});
    }
  });

  it("data uji benar-benar terbentuk sebelum diuji", () => {
    expect(businessId).toBeTruthy();
    expect(pemilikAId).toBeTruthy();
    expect(pemilikBId).toBeTruthy();
  });

  it("pemilik yang TIDAK jual apa pun bulan ini TETAP tampil dengan angka nol, bukan hilang dari daftar", async () => {
    const rows = await getBagiHasilLaporan(db, {
      businessId,
      outletId,
      businessTimezone: TIMEZONE,
      startDate: "2000-01-01",
      endDate: TODAY,
    });
    const rowB = rows.find((r) => r.pemilikId === pemilikBId);
    expect(rowB).toBeTruthy();
    expect(rowB!.terjualPeriode).toBe(0);
    expect(rowB!.totalPenjualan).toBe("0.00");
    expect(rowB!.bagianPemilik).toBe("0.00");
    expect(rowB!.dititipkan).toBe(1); // barang belum laku tetap terhitung dititipkan
    expect(rowB!.belumTerjual).toBe(1);
  });

  it("penjualan sungguhan cocok persis contoh SPESIFIKASI-THRIFTING.md §7 -- Rp1.850.000 @ 60% -> pemilik Rp1.110.000, toko Rp740.000", async () => {
    const rows = await getBagiHasilLaporan(db, {
      businessId,
      outletId,
      businessTimezone: TIMEZONE,
      startDate: "2000-01-01",
      endDate: TODAY,
    });
    const rowA = rows.find((r) => r.pemilikId === pemilikAId);
    expect(rowA).toBeTruthy();
    expect(rowA!.totalPenjualan).toBe("1850000.00");
    expect(rowA!.bagianPemilik).toBe("1110000.00");
    expect(rowA!.bagianToko).toBe("740000.00");
  });

  it("identitas tertutup: dititipkan = terjualKumulatif + belumTerjual + rusak (pemilikA: 1 terjual + 0 belum + 1 rusak = 2 dititipkan)", async () => {
    const rows = await getBagiHasilLaporan(db, {
      businessId,
      outletId,
      businessTimezone: TIMEZONE,
      startDate: "2000-01-01",
      endDate: TODAY,
    });
    const rowA = rows.find((r) => r.pemilikId === pemilikAId)!;
    expect(rowA.dititipkan).toBe(rowA.terjualKumulatif + rowA.belumTerjual + rowA.rusak);
    expect(rowA.dititipkan).toBe(2);
    expect(rowA.terjualKumulatif).toBe(1);
    expect(rowA.rusak).toBe(1);
  });

  it("SNAPSHOT, BUKAN HITUNG ULANG: ubah persen_bagi pemilik SESUDAH penjualan, laporan bulan itu tetap sama persis (SYARAT 1 TT11)", async () => {
    const before = await getBagiHasilLaporan(db, {
      businessId,
      outletId,
      businessTimezone: TIMEZONE,
      startDate: "2000-01-01",
      endDate: TODAY,
    });
    const rowABefore = before.find((r) => r.pemilikId === pemilikAId)!;
    expect(rowABefore.bagianPemilik).toBe("1110000.00"); // 60% dari 1.850.000

    // Ubah persen_bagi dari 60% jadi 90% SESUDAH transaksi tercatat.
    await db.update(pemilik).set({ persenBagi: "90" }).where(eq(pemilik.id, pemilikAId));

    const after = await getBagiHasilLaporan(db, {
      businessId,
      outletId,
      businessTimezone: TIMEZONE,
      startDate: "2000-01-01",
      endDate: TODAY,
    });
    const rowAAfter = after.find((r) => r.pemilikId === pemilikAId)!;
    // HARUS TETAP Rp1.110.000 (60% lama) -- BUKAN Rp1.665.000 (90% baru).
    expect(rowAAfter.bagianPemilik).toBe("1110000.00");
    expect(rowAAfter.totalPenjualan).toBe(rowABefore.totalPenjualan);

    // Kembalikan supaya tidak memengaruhi test lain di file ini.
    await db.update(pemilik).set({ persenBagi: "60" }).where(eq(pemilik.id, pemilikAId));
  });

  it("barang yang BARU LAKU SESUDAH endDate periode lama tetap terhitung belumTerjual di laporan periode itu, bukan terjualKumulatif -- sejajar dengan SYARAT 1: laporan periode lama tidak boleh berubah gara-gara sesuatu yang terjadi setelahnya", async () => {
    // masukPada sengaja jauh di masa lalu supaya pasti <= endDate periode
    // lama mana pun yang dipakai test ini.
    const pastMasukPada = new Date("2020-01-01T00:00:00.000Z");
    const [item] = await db
      .insert(barang)
      .values({
        businessId,
        outletId,
        kode: `${PREFIX}-POST-PERIODE`,
        nama: "Barang Laku Sesudah Periode",
        hargaJual: "50000",
        status: "siap_jual",
        pemilikId: pemilikCId,
        masukPada: pastMasukPada,
      })
      .returning({ id: barang.id });

    // "Periode lama" yang SUDAH BERAKHIR sebelum barang ini laku -- endDate
    // kemarin (business date, jauh sebelum penjualan yang akan dilakukan
    // detik ini juga).
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const beforeSale = await getBagiHasilLaporan(db, {
      businessId,
      outletId,
      businessTimezone: TIMEZONE,
      startDate: "2000-01-01",
      endDate: yesterday,
    });
    const rowCBeforeSale = beforeSale.find((r) => r.pemilikId === pemilikCId)!;
    expect(rowCBeforeSale.dititipkan).toBe(1);
    expect(rowCBeforeSale.belumTerjual).toBe(1);
    expect(rowCBeforeSale.terjualKumulatif).toBe(0);

    // Jual SEKARANG (real-time, sesudah endDate "kemarin" di atas).
    const result = await sellBarangWithDb(db, businessId, {
      orderId: generateId(),
      outletId,
      deviceId,
      lines: [{ barangId: item!.id }],
      payments: [{ id: generateId(), paymentMethodId: cashMethodId, amount: "50000", reference: "" }],
    });
    if (result.error || !result.success) {
      throw new Error(`Gagal jual barang uji post-periode: ${result.error}`);
    }

    // Laporan periode LAMA (endDate kemarin, sama seperti di atas) HARUS
    // TETAP SAMA PERSIS -- barang ini masih belumTerjual per endDate itu,
    // walau SEKARANG statusnya sudah 'terjual' sungguhan di database.
    const afterSale = await getBagiHasilLaporan(db, {
      businessId,
      outletId,
      businessTimezone: TIMEZONE,
      startDate: "2000-01-01",
      endDate: yesterday,
    });
    const rowCAfterSale = afterSale.find((r) => r.pemilikId === pemilikCId)!;
    expect(rowCAfterSale.dititipkan).toBe(1);
    expect(rowCAfterSale.belumTerjual).toBe(1);
    expect(rowCAfterSale.terjualKumulatif).toBe(0);

    // Sebaliknya, laporan sampai HARI INI harus mencerminkan penjualan itu.
    const today = await getBagiHasilLaporan(db, {
      businessId,
      outletId,
      businessTimezone: TIMEZONE,
      startDate: "2000-01-01",
      endDate: TODAY,
    });
    const rowCToday = today.find((r) => r.pemilikId === pemilikCId)!;
    expect(rowCToday.terjualKumulatif).toBe(1);
    expect(rowCToday.belumTerjual).toBe(0);
  });

  it("SUDAH DIBAYAR bisa SEBAGIAN dari beberapa baris pembayaran, dijumlahkan (SYARAT 2 TT11)", async () => {
    await db.insert(pemilikPayouts).values([
      {
        businessId,
        outletId,
        pemilikId: pemilikAId,
        startDate: "2000-01-01",
        endDate: TODAY,
        jumlah: "300000",
        tanggalBayar: TODAY,
        recordedByUserId: recorderProfileId,
        catatan: "Cicilan pertama",
      },
      {
        businessId,
        outletId,
        pemilikId: pemilikAId,
        startDate: "2000-01-01",
        endDate: TODAY,
        jumlah: "500000",
        tanggalBayar: TODAY,
        recordedByUserId: recorderProfileId,
        catatan: "Cicilan kedua",
      },
    ]);

    const rows = await getBagiHasilLaporan(db, {
      businessId,
      outletId,
      businessTimezone: TIMEZONE,
      startDate: "2000-01-01",
      endDate: TODAY,
    });
    const rowA = rows.find((r) => r.pemilikId === pemilikAId)!;
    // 300.000 + 500.000 = 800.000, cocok persis contoh §7.
    expect(rowA.sudahDibayar).toBe("800000.00");
  });

  it("PENYAJIAN GANDA (keputusan CEO 13 September 2026): terjualPeriode (dibatasi startDate..endDate) BERBEDA dari terjualKumulatif (sepanjang waktu) untuk pemilik yang jual di periode LAMA dan periode INI -- kalau keduanya selalu sama, tidak ada yang diuji", async () => {
    const kodeLama = `${PREFIX}-PERIODE-LAMA`;
    const [itemLama] = await db
      .insert(barang)
      .values({
        businessId,
        outletId,
        kode: kodeLama,
        nama: "Barang Periode Lama",
        hargaJual: "100000",
        status: "siap_jual",
        pemilikId: pemilikDId,
      })
      .returning({ id: barang.id });

    // Jual SUNGGUHAN lewat sellBarangWithDb (bukan insert order_items
    // manual) -- tapi businessDate order ini dipaksa mundur ke masa lalu
    // SESUDAH insert, karena sellBarangWithDb menghitungnya dari waktu
    // sungguhan saat dipanggil (tidak bisa disuntik lewat parameter).
    // terjualPada (kolom barang, TIDAK disentuh) tetap waktu sungguhan
    // hari ini -- itu yang membuat item ini TETAP terhitung di
    // terjualKumulatif (filter <= endOfPeriodInstant hari ini, lihat
    // komentar ASUMSI PENAFSIRAN di bagi-hasil-report.ts), walau
    // businessDate-nya sudah di luar rentang startDate laporan periode
    // ini di bawah.
    const orderIdLama = generateId();
    const jualLama = await sellBarangWithDb(db, businessId, {
      orderId: orderIdLama,
      outletId,
      deviceId,
      lines: [{ barangId: itemLama!.id }],
      payments: [{ id: generateId(), paymentMethodId: cashMethodId, amount: "100000", reference: "" }],
    });
    if (jualLama.error || !jualLama.success) {
      throw new Error(`Gagal jual barang uji periode lama: ${jualLama.error}`);
    }
    await db.update(orders).set({ businessDate: "2000-06-15" }).where(eq(orders.id, orderIdLama));

    // Barang KEDUA, dijual SEKARANG -- businessDate = TODAY, di DALAM
    // rentang periode "hari ini" yang diuji di bawah.
    await jualBarang("150000", pemilikDId);

    const rows = await getBagiHasilLaporan(db, {
      businessId,
      outletId,
      businessTimezone: TIMEZONE,
      startDate: TODAY, // periode HANYA hari ini -- sengaja mengecualikan "2000-06-15"
      endDate: TODAY,
    });
    const rowD = rows.find((r) => r.pemilikId === pemilikDId)!;

    expect(rowD.terjualKumulatif).toBe(2); // kedua barang sudah terjual per hari ini (terjualPada sungguhan)
    expect(rowD.terjualPeriode).toBe(1); // cuma yang businessDate-nya jatuh di periode "hari ini"
    expect(rowD.terjualKumulatif).toBeGreaterThan(rowD.terjualPeriode);
  });
});
