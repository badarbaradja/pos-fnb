/**
 * TT11 — Test integrasi gerbang SYARAT 3 (dayCutoffTime belum
 * dikonfirmasi -> ekspor Excel TERKUNCI) dan pembuktian file .xlsx yang
 * dihasilkan SUNGGUHAN valid, bukan cuma "kodenya ditulis". Butuh
 * koneksi Supabase sungguhan, di-skip otomatis kalau env belum diisi.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
import { eq } from "drizzle-orm";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import ExcelJS from "exceljs";
import { getAdminDb } from "@/lib/db/client";
import { brands, businesses, pemilik } from "@/lib/db/schema";
import { confirmDayCutoffWithDb, createOutletWithDb } from "@/lib/outlets/manage";
import { buildBagiHasilExport } from "../bagi-hasil-export";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

describe.skipIf(!hasEnv)("TT11 — buildBagiHasilExport (gerbang SYARAT 3)", () => {
  const db = getAdminDb();
  const PREFIX = `TEST_EXPORT_${Date.now()}`;

  let businessId: string;
  let outletId: string;

  beforeAll(async () => {
    const [business] = await db
      .insert(businesses)
      .values({ name: `${PREFIX}_business` })
      .returning({ id: businesses.id });
    businessId = business!.id;

    const [brand] = await db
      .insert(brands)
      .values({ businessId, name: `${PREFIX}_brand` })
      .returning({ id: brands.id });

    const created = await createOutletWithDb(db, businessId, {
      code: "EX1",
      brandId: brand!.id,
      name: `${PREFIX}_outlet`,
      dayCutoffTime: "04:00:00",
      taxPercent: 0,
      serviceChargePercent: 0,
      roundingTo: 100,
      cashVarianceTolerance: "20000",
      varianceAlertPercent: 3,
      varianceAlertValue: "100000",
    });
    outletId = created.success!.outletId;

    await db.insert(pemilik).values({ businessId, nama: `${PREFIX}_Pemilik`, persenBagi: "60" });
  });

  afterAll(async () => {
    if (businessId) {
      await db.delete(businesses).where(eq(businesses.id, businessId));
    }
  });

  it("SYARAT 3 TT11 -- ekspor DITOLAK (status locked) selama dayCutoffTime outlet ini belum dikonfirmasi", async () => {
    const result = await buildBagiHasilExport(db, {
      businessId,
      outletId,
      startDate: "2026-09-01",
      endDate: "2026-09-30",
    });
    expect(result.status).toBe("locked");
    if (result.status === "locked") {
      expect(result.error).toContain("belum dikonfirmasi");
    }
  });

  it("outlet baru (dayCutoffConfirmed bawaan false) tetap TERKUNCI walau outlet baru saja dibuat -- bukan cuma outlet lama yang belum sempat dikonfirmasi", async () => {
    // Pengulangan sengaja -- membuktikan gerbang aktif dari AWAL (default
    // schema), bukan cuma kebetulan belum ada yang mengklik "Konfirmasi".
    const result = await buildBagiHasilExport(db, {
      businessId,
      outletId,
      startDate: "2000-01-01",
      endDate: "2099-12-31",
    });
    expect(result.status).toBe("locked");
  });

  it("berhasil membangun file .xlsx SUNGGUHAN (bisa dibaca ulang oleh ExcelJS) SESUDAH dayCutoffTime dikonfirmasi (SYARAT 3 terpenuhi)", async () => {
    await confirmDayCutoffWithDb(db, businessId, outletId);

    const result = await buildBagiHasilExport(db, {
      businessId,
      outletId,
      startDate: "2026-09-01",
      endDate: "2026-09-30",
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("harus ok sesudah dikonfirmasi");

    // Tanda tangan byte ZIP -- .xlsx adalah arsip ZIP, ini bukti file
    // BINER sungguhan yang dikembalikan, bukan pesan error/JSON.
    expect(result.buffer.subarray(0, 2).toString("latin1")).toBe("PK");

    // Baca ULANG file itu dengan ExcelJS -- bukti file benar-benar valid
    // dibuka lagi (round-trip), bukan cuma byte yang kebetulan diawali PK.
    const readBack = new ExcelJS.Workbook();
    await readBack.xlsx.load(result.buffer as unknown as ArrayBuffer);
    const sheet = readBack.worksheets[0];
    expect(sheet).toBeTruthy();
    expect(sheet!.name).toBe("2026-09-01 s.d. 2026-09-30");

    const headerRow = sheet!.getRow(1).values as unknown[];
    expect(headerRow).toContain("Pemilik");

    // getColumn(key) cuma berlaku untuk workbook yang MASIH di memori --
    // kunci kolom bukan bagian format file .xlsx, jadi hilang sesudah
    // round-trip baca ulang. Cari indeks kolom lewat teks header, bukan
    // key, supaya benar-benar menguji apa yang tersimpan di FILE.
    const pemilikColIndex = headerRow.indexOf("Pemilik");
    expect(pemilikColIndex).toBeGreaterThan(0);
    const pemilikColumnValues = sheet!.getColumn(pemilikColIndex).values as unknown[];
    expect(pemilikColumnValues).toContain(`${PREFIX}_Pemilik`);
  });

  it("outlet yang tidak cocok businessId -- status not_found, bukan melempar galat", async () => {
    const result = await buildBagiHasilExport(db, {
      businessId,
      outletId: "00000000-0000-0000-0000-000000000000",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
    });
    expect(result.status).toBe("not_found");
  });
});
