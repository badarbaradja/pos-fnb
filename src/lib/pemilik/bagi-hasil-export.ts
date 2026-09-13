import ExcelJS from "exceljs";
import { and, eq } from "drizzle-orm";
import { Decimal } from "decimal.js";
import type { UserDbHandle } from "@/lib/db/client";
import { businesses, outlets } from "@/lib/db/schema";
import { getBagiHasilLaporan } from "@/lib/db/queries/bagi-hasil-report";
import { calculateSisaDibayar } from "@/lib/calc/bagi-hasil-payout";
import { formatTimezoneAbbreviation } from "@/lib/utils/business-date";
import { id as strings } from "@/lib/i18n/id";

type Db = UserDbHandle["db"];

const COLUMN_DEFS = [
  { header: strings.bagiHasil.colPemilik, key: "pemilik", width: 24 },
  { header: strings.bagiHasil.colDititipkan, key: "dititipkan", width: 12 },
  { header: strings.bagiHasil.colTerjual, key: "terjual", width: 12 },
  { header: strings.bagiHasil.colBelumTerjual, key: "belumTerjual", width: 14 },
  { header: strings.bagiHasil.colRusak, key: "rusak", width: 10 },
  // Posisi TEPAT SEBELUM totalPenjualan (keputusan CEO 13 September
  // 2026) -- sama posisi dengan tabel di layar, supaya urutan baca
  // konsisten: terjual periode ini -> total penjualan -> bagian pemilik
  // -> bagian toko.
  { header: strings.bagiHasil.colTerjualPeriode, key: "terjualPeriode", width: 14 },
  { header: strings.bagiHasil.colTotalPenjualan, key: "totalPenjualan", width: 18 },
  { header: strings.bagiHasil.colBagianPemilik, key: "bagianPemilik", width: 18 },
  { header: strings.bagiHasil.colBagianToko, key: "bagianToko", width: 18 },
  { header: strings.bagiHasil.colSudahDibayar, key: "sudahDibayar", width: 18 },
  { header: strings.bagiHasil.colSisaDibayar, key: "sisaDibayar", width: 18 },
] as const;
const MONEY_COLUMN_KEYS = [
  "totalPenjualan",
  "bagianPemilik",
  "bagianToko",
  "sudahDibayar",
  "sisaDibayar",
] as const;

/**
 * lib/pemilik/bagi-hasil-export.ts — TT11. Logika ekspor Excel DIPISAH
 * dari Route Handler (app/api/reports/bagi-hasil/export/route.ts) supaya
 * bisa diuji lewat panggilan langsung ke database sungguhan -- pola sama
 * *WithDb lain di proyek ini (recordPemilikPayoutWithDb, dst): Route
 * Handler cuma pembungkus tipis (baca searchParams, requirePermissionDb,
 * terjemahkan ke NextResponse), SEMUA logika (termasuk gerbang SYARAT 3)
 * ada di sini supaya __tests__ bisa membuktikan gerbangnya benar-benar
 * MENOLAK, bukan cuma "kodenya ada".
 */
export type BagiHasilExportResult =
  | { status: "not_found" }
  | { status: "locked"; error: string }
  | { status: "ok"; buffer: Buffer; filename: string };

export async function buildBagiHasilExport(
  db: Db,
  params: { businessId: string; outletId: string; startDate: string; endDate: string }
): Promise<BagiHasilExportResult> {
  const { businessId, outletId, startDate, endDate } = params;

  const [outlet] = await db
    .select({
      name: outlets.name,
      dayCutoffTime: outlets.dayCutoffTime,
      dayCutoffConfirmed: outlets.dayCutoffConfirmed,
    })
    .from(outlets)
    .where(and(eq(outlets.id, outletId), eq(outlets.businessId, businessId)));

  if (!outlet) {
    return { status: "not_found" };
  }

  // SYARAT 3 TT11 -- dicek DI SINI (bukan cuma tombol disabled di UI),
  // supaya mengetik URL ekspor langsung tetap ditolak. Kalau terkunci,
  // TIDAK PERNAH sampai membangun workbook sama sekali -- tidak ada data
  // yang diproses/dibocorkan lewat jalur ini selagi belum dikonfirmasi.
  if (!outlet.dayCutoffConfirmed) {
    return { status: "locked", error: strings.bagiHasil.cutoffBelumDikonfirmasiError };
  }

  const [business] = await db
    .select({ timezone: businesses.timezone })
    .from(businesses)
    .where(eq(businesses.id, businessId));

  // businessTimezone -- BUKAN "outletTimezone" (outlet tidak punya kolom
  // zona waktu sendiri di skema ini). Batas periode ditentukan DUA nilai
  // bersama: dayCutoffTime outlet DAN zona waktu bisnis ini -- keduanya
  // WAJIB tampil bersama di kepala laporan, kalau tidak konfirmasi
  // "04:00" tidak berarti apa-apa (koreksi CEO 12 September 2026: gerbang
  // yang cuma memagari satu dari dua nilai memberi rasa aman palsu).
  const businessTimezone = business?.timezone ?? "Asia/Jakarta";
  const timezoneLabel = formatTimezoneAbbreviation(businessTimezone);

  const rows = await getBagiHasilLaporan(db, {
    businessId,
    outletId,
    businessTimezone,
    startDate,
    endDate,
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(`${startDate} s.d. ${endDate}`.slice(0, 31));

  // Kolom TANPA `header` (beda dari sebelumnya) -- ExcelJS otomatis menulis
  // `header` ke baris 1 begitu `sheet.columns` di-set, yang akan menabrak
  // baris info batas-hari/zona-waktu yang kita tulis manual di bawah.
  sheet.columns = COLUMN_DEFS.map(({ key, width }) => ({ key, width }));

  // Baris 1: kepala laporan -- batas hari + zona waktu WAJIB tampil
  // bersama (lihat komentar di atas). Baris 2: kosong (spasi). Baris 3:
  // label kolom (ditulis manual, sama urutan/isi dengan COLUMN_DEFS).
  sheet.addRow([
    strings.bagiHasil.cutoffInfo
      .replace("{cutoff}", outlet.dayCutoffTime)
      .replace("{timezone}", timezoneLabel),
  ]);
  sheet.addRow([]);
  const headerRow = sheet.addRow(COLUMN_DEFS.map((c) => c.header));
  headerRow.font = { bold: true };

  for (const row of rows) {
    const sisa = calculateSisaDibayar(new Decimal(row.bagianPemilik), new Decimal(row.sudahDibayar));
    sheet.addRow({
      pemilik: row.pemilikNama,
      dititipkan: row.dititipkan,
      terjual: row.terjualKumulatif,
      belumTerjual: row.belumTerjual,
      rusak: row.rusak,
      terjualPeriode: row.terjualPeriode,
      totalPenjualan: Number(row.totalPenjualan),
      bagianPemilik: Number(row.bagianPemilik),
      bagianToko: Number(row.bagianToko),
      sudahDibayar: Number(row.sudahDibayar),
      sisaDibayar: Number(sisa.toFixed(2)),
    });
  }

  MONEY_COLUMN_KEYS.forEach((key) => {
    sheet.getColumn(key).numFmt = "#,##0";
  });

  const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
  const filename = `bagi-hasil_${outlet.name.replace(/[^a-zA-Z0-9]/g, "-")}_${startDate}_${endDate}.xlsx`;

  return { status: "ok", buffer, filename };
}
