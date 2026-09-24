/**
 * lib/audit/report.ts — Halaman Auditor (24 September 2026). Menyusun
 * laporan HARIAN lintas outlet untuk satu business_date: per outlet,
 * berurutan mengikuti alur shift (Prepare -> Opname Buka -> Penjualan ->
 * Opname Tutup -> Closing), plus shift yang perlu ditandai (kamera gagal,
 * force-close, selisih kas di luar toleransi).
 *
 * DUA sumber data dengan hak akses BERBEDA (lihat lib/audit/access.ts):
 * 1. Data shift+kas+prepare+closing+penjualan -- lewat fungsi SQL
 *    audit_shifts_for_business_date() (SECURITY DEFINER, satu-satunya
 *    jalur baca lintas outlet baru di sistem ini).
 * 2. Data opname (stock_opnames/stock_opname_items) -- DIBACA LANGSUNG
 *    lewat koneksi user biasa. RLS kedua tabel itu business-scoped saja
 *    (bukan outlet-scoped, dikonfirmasi dari policy-nya di schema.ts),
 *    jadi TIDAK butuh elevasi apa pun -- siapa pun anggota aktif bisnis
 *    ini SUDAH BISA membacanya lintas outlet hari ini, sebelum halaman
 *    ini ada. requireAuditAccess() tetap satu-satunya gerbang MASUK ke
 *    halaman ini secara keseluruhan.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import type { UserDbHandle } from "@/lib/db/client";
import { outlets, stockOpnames } from "@/lib/db/schema";
import { getShiftOpnameItemsForSession, type ShiftOpnameItemRow } from "@/lib/stock-opnames/shift-opname";
import { getAuditReviewsForBusinessDate } from "./reviews";

type Db = UserDbHandle["db"];

export type AuditFlagKind =
  | "prepare_photo_failed"
  | "closing_photo_failed"
  | "force_closed"
  | "cash_variance_out_of_tolerance";

export type AuditFlag = {
  kind: AuditFlagKind;
  detail: string | null;
};

export type AuditOpnameSection = {
  items: ShiftOpnameItemRow[];
  isFirstShiftAtOutlet: boolean;
};

export type AuditShiftReport = {
  shiftId: string;
  employeeName: string;
  status: "open" | "closed" | "reconciled";
  openedAt: Date;
  closedAt: Date | null;
  prepare: {
    photoPath: string | null;
    photoMissingReason: string | null;
    hasEvent: boolean | null;
    eventNote: string | null;
  };
  opnameBuka: AuditOpnameSection | null;
  sales: { orderCount: number; netTotal: string };
  opnameTutup: AuditOpnameSection | null;
  closing: {
    photoPath: string | null;
    photoMissingReason: string | null;
    cleanlinessNote: string | null;
  };
  cash: {
    openingCash: string;
    countedCash: string | null;
    expectedCash: string | null;
    variance: string | null;
    tolerance: string;
  };
  flags: AuditFlag[];
};

export type AuditReviewInfo = {
  reviewedByName: string;
  reviewedAt: Date;
  note: string | null;
};

export type AuditOutletReport = {
  outletId: string;
  outletName: string;
  shifts: AuditShiftReport[]; // kosong = "belum ada shift" hari ini
  review: AuditReviewInfo | null;
};

export type AuditDailyReport = {
  businessDate: string;
  outlets: AuditOutletReport[];
};

type RawAuditShiftRow = {
  shift_id: string;
  outlet_id: string;
  outlet_name: string;
  employee_name: string;
  status: "open" | "closed" | "reconciled";
  opened_at: Date;
  closed_at: Date | null;
  business_date: string;
  opening_cash: string;
  counted_cash: string | null;
  expected_cash: string | null;
  cash_variance: string | null;
  cash_variance_tolerance: string;
  force_closed_at: Date | null;
  prepare_photo_path: string | null;
  prepare_photo_missing_reason: string | null;
  prepare_has_event: boolean | null;
  prepare_event_note: string | null;
  closing_photo_path: string | null;
  closing_photo_missing_reason: string | null;
  closing_cleanliness_note: string | null;
  sales_order_count: number;
  sales_net_total: string;
};

function computeFlags(row: RawAuditShiftRow): AuditFlag[] {
  const flags: AuditFlag[] = [];
  if (row.prepare_photo_missing_reason !== null) {
    flags.push({ kind: "prepare_photo_failed", detail: row.prepare_photo_missing_reason });
  }
  if (row.closing_photo_missing_reason !== null) {
    flags.push({ kind: "closing_photo_failed", detail: row.closing_photo_missing_reason });
  }
  if (row.force_closed_at !== null) {
    flags.push({ kind: "force_closed", detail: null });
  }
  if (row.cash_variance !== null) {
    const variance = new Decimal(row.cash_variance);
    const tolerance = new Decimal(row.cash_variance_tolerance);
    if (variance.abs().greaterThan(tolerance)) {
      flags.push({ kind: "cash_variance_out_of_tolerance", detail: variance.toFixed(2) });
    }
  }
  return flags;
}

/**
 * Panggil fungsi SQL SECURITY DEFINER audit_shifts_for_business_date().
 * MELEMPAR kalau caller tidak lolos auth_can_audit() di database -- jaring
 * kedua, requireAuditAccess() (lib/audit/access.ts) sudah menolak duluan
 * di app layer untuk kasus normal.
 */
async function getRawAuditShifts(
  db: Db,
  businessId: string,
  businessDate: string
): Promise<RawAuditShiftRow[]> {
  const result = await db.execute<RawAuditShiftRow>(
    sql`select * from audit_shifts_for_business_date(${businessId}::uuid, ${businessDate}::date)`
  );
  return Array.from(result as unknown as RawAuditShiftRow[]);
}

/**
 * Opname 'buka'/'tutup' untuk sekumpulan shift SEKALIGUS -- dibaca lewat
 * koneksi user biasa (lihat catatan kepala berkas soal kenapa ini tidak
 * butuh fungsi SECURITY DEFINER). Mengembalikan peta shiftId -> { buka?,
 * tutup? } supaya perakitan laporan di bawah tinggal lookup, bukan query
 * per shift satu-satu.
 */
async function getOpnameSectionsForShifts(
  db: Db,
  businessId: string,
  shiftRows: { shiftId: string; outletId: string }[]
): Promise<Map<string, { buka?: AuditOpnameSection; tutup?: AuditOpnameSection }>> {
  const result = new Map<string, { buka?: AuditOpnameSection; tutup?: AuditOpnameSection }>();
  if (shiftRows.length === 0) return result;

  const shiftIds = shiftRows.map((s) => s.shiftId);
  const sessions = await db
    .select({
      id: stockOpnames.id,
      shiftId: stockOpnames.shiftId,
      outletId: stockOpnames.outletId,
      jenis: stockOpnames.jenis,
    })
    .from(stockOpnames)
    .where(and(eq(stockOpnames.businessId, businessId), inArray(stockOpnames.shiftId, shiftIds)));

  for (const session of sessions) {
    if (session.jenis !== "buka" && session.jenis !== "tutup") continue;
    if (!session.shiftId) continue;
    const { items, isFirstShiftAtOutlet } = await getShiftOpnameItemsForSession(db, {
      businessId,
      outletId: session.outletId,
      opnameId: session.id,
      jenis: session.jenis,
      shiftId: session.shiftId,
    });
    if (items.length === 0) continue; // nol bahan berflag -- tidak ada apa pun untuk ditampilkan
    const entry = result.get(session.shiftId) ?? {};
    entry[session.jenis] = { items, isFirstShiftAtOutlet };
    result.set(session.shiftId, entry);
  }

  return result;
}

/**
 * Susun laporan auditor harian LENGKAP untuk satu business_date: SEMUA
 * outlet aktif bisnis ini, termasuk yang nol shift hari itu ("belum ada
 * shift", bukan halaman kosong -- outlets dibaca dari tabelnya sendiri,
 * business-scoped biasa, BUKAN dari hasil audit_shifts_for_business_date()
 * yang cuma berisi outlet yang PUNYA shift hari itu).
 */
export async function getAuditDailyReport(
  db: Db,
  businessId: string,
  businessDate: string
): Promise<AuditDailyReport> {
  const [allOutlets, rawShifts] = await Promise.all([
    db
      .select({ id: outlets.id, name: outlets.name, isActive: outlets.isActive })
      .from(outlets)
      .where(eq(outlets.businessId, businessId)),
    getRawAuditShifts(db, businessId, businessDate),
  ]);

  const reviews = await getAuditReviewsForBusinessDate(
    db,
    businessId,
    allOutlets.map((o) => o.id),
    businessDate
  );

  const opnameSections = await getOpnameSectionsForShifts(
    db,
    businessId,
    rawShifts.map((r) => ({ shiftId: r.shift_id, outletId: r.outlet_id }))
  );

  const shiftsByOutlet = new Map<string, AuditShiftReport[]>();
  for (const row of rawShifts) {
    const sections = opnameSections.get(row.shift_id) ?? {};
    const report: AuditShiftReport = {
      shiftId: row.shift_id,
      employeeName: row.employee_name,
      status: row.status,
      openedAt: row.opened_at,
      closedAt: row.closed_at,
      prepare: {
        photoPath: row.prepare_photo_path,
        photoMissingReason: row.prepare_photo_missing_reason,
        hasEvent: row.prepare_has_event,
        eventNote: row.prepare_event_note,
      },
      opnameBuka: sections.buka ?? null,
      sales: { orderCount: Number(row.sales_order_count), netTotal: row.sales_net_total },
      opnameTutup: sections.tutup ?? null,
      closing: {
        photoPath: row.closing_photo_path,
        photoMissingReason: row.closing_photo_missing_reason,
        cleanlinessNote: row.closing_cleanliness_note,
      },
      cash: {
        openingCash: row.opening_cash,
        countedCash: row.counted_cash,
        expectedCash: row.expected_cash,
        variance: row.cash_variance,
        tolerance: row.cash_variance_tolerance,
      },
      flags: computeFlags(row),
    };
    const list = shiftsByOutlet.get(row.outlet_id) ?? [];
    list.push(report);
    shiftsByOutlet.set(row.outlet_id, list);
  }
  for (const list of shiftsByOutlet.values()) {
    list.sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime());
  }

  const outletReports: AuditOutletReport[] = allOutlets
    .filter((o) => o.isActive)
    .map((o) => ({
      outletId: o.id,
      outletName: o.name,
      shifts: shiftsByOutlet.get(o.id) ?? [],
      review: reviews.get(o.id) ?? null,
    }))
    .sort((a, b) => a.outletName.localeCompare(b.outletName));

  return { businessDate, outlets: outletReports };
}
