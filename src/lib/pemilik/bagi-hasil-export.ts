import ExcelJS from "exceljs";
import { and, eq } from "drizzle-orm";
import { Decimal } from "decimal.js";
import type { UserDbHandle } from "@/lib/db/client";
import { businesses, outlets } from "@/lib/db/schema";
import { getBagiHasilLaporan } from "@/lib/db/queries/bagi-hasil-report";
import { calculateSisaDibayar } from "@/lib/calc/bagi-hasil-payout";
import { id as strings } from "@/lib/i18n/id";

type Db = UserDbHandle["db"];

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
    .select({ name: outlets.name, dayCutoffConfirmed: outlets.dayCutoffConfirmed })
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

  const rows = await getBagiHasilLaporan(db, {
    businessId,
    outletId,
    outletTimezone: business?.timezone ?? "Asia/Jakarta",
    startDate,
    endDate,
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(`${startDate} s.d. ${endDate}`.slice(0, 31));

  sheet.columns = [
    { header: strings.bagiHasil.colPemilik, key: "pemilik", width: 24 },
    { header: strings.bagiHasil.colDititipkan, key: "dititipkan", width: 12 },
    { header: strings.bagiHasil.colTerjual, key: "terjual", width: 12 },
    { header: strings.bagiHasil.colBelumTerjual, key: "belumTerjual", width: 14 },
    { header: strings.bagiHasil.colRusak, key: "rusak", width: 10 },
    { header: strings.bagiHasil.colTotalPenjualan, key: "totalPenjualan", width: 18 },
    { header: strings.bagiHasil.colBagianPemilik, key: "bagianPemilik", width: 18 },
    { header: strings.bagiHasil.colBagianToko, key: "bagianToko", width: 18 },
    { header: strings.bagiHasil.colSudahDibayar, key: "sudahDibayar", width: 18 },
    { header: strings.bagiHasil.colSisaDibayar, key: "sisaDibayar", width: 18 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const row of rows) {
    const sisa = calculateSisaDibayar(new Decimal(row.bagianPemilik), new Decimal(row.sudahDibayar));
    sheet.addRow({
      pemilik: row.pemilikNama,
      dititipkan: row.dititipkan,
      terjual: row.terjualKumulatif,
      belumTerjual: row.belumTerjual,
      rusak: row.rusak,
      totalPenjualan: Number(row.totalPenjualan),
      bagianPemilik: Number(row.bagianPemilik),
      bagianToko: Number(row.bagianToko),
      sudahDibayar: Number(row.sudahDibayar),
      sisaDibayar: Number(sisa.toFixed(2)),
    });
  }

  ["totalPenjualan", "bagianPemilik", "bagianToko", "sudahDibayar", "sisaDibayar"].forEach((key) => {
    sheet.getColumn(key).numFmt = "#,##0";
  });

  const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
  const filename = `bagi-hasil_${outlet.name.replace(/[^a-zA-Z0-9]/g, "-")}_${startDate}_${endDate}.xlsx`;

  return { status: "ok", buffer, filename };
}
