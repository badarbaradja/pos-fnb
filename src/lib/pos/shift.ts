import { z } from "zod";
import { and, eq, isNotNull, isNull, desc, sql } from "drizzle-orm";
import { Decimal } from "decimal.js";
import type { UserDbHandle } from "@/lib/db/client";
import {
  auditLogs,
  businesses,
  cashMovements,
  employees,
  orders,
  outlets,
  paymentMethods,
  payments,
  refunds,
  shifts,
} from "@/lib/db/schema";
import { calculateShiftReconciliation } from "@/lib/calc/shift";
import { businessDate } from "@/lib/utils/business-date";
import { verifyCashierPin } from "@/lib/auth/pin";
import { generateId } from "@/lib/utils/id";
import { id as strings } from "@/lib/i18n/id";

/**
 * lib/pos/shift.ts — logika inti T15, pola thin-wrapper yang sama dengan
 * lib/pos/pay-order.ts (testable tanpa request Next.js sungguhan, dipisah
 * dari Server Action pembungkus di app/(pos)/pos/shift/actions.ts).
 *
 * Anti-fraud tutup shift (CALC-SPEC bagian E + permintaan eksplisit):
 * counted_cash HARUS diisi kasir SEBELUM expected_cash dihitung/ditampilkan,
 * dan setelah tersimpan TIDAK BISA diubah lagi -- ditegakkan di sini, bukan
 * cuma di UI. Makanya tutup shift dipecah jadi DUA langkah terpisah:
 *
 *   1. submitCountedCashWithDb() -- SATU-SATUNYA tempat counted_cash
 *      pernah ditulis (guard `countedCash IS NULL` di WHERE, atomik).
 *      Kalau selisih masih dalam toleransi, shift LANGSUNG closed di sini
 *      juga. Kalau di luar toleransi, shift TETAP 'open' tapi counted_cash
 *      sudah terkunci -- menandakan "sedang menunggu alasan", bukan lagi
 *      bisa dipakai jualan (lihat isShiftSellable()).
 *   2. confirmShiftCloseWithDb() -- HANYA menambahkan alasan lalu
 *      benar-benar menutup shift. Tidak pernah menyentuh counted_cash.
 *
 * Kalau langkah 1 dipanggil dua kali (percobaan edit), panggilan kedua
 * SELALU ditolak walau nilai yang dikirim berbeda -- tidak peduli apakah
 * percobaan pertama lolos toleransi atau tidak.
 */

type Db = UserDbHandle["db"];

export type OpenShiftRow = {
  id: string;
  outletId: string;
  deviceId: string | null;
  employeeId: string;
  employeeName: string;
  // TT06 lanjutan (11 September 2026) -- role EMPLOYEE (dari PIN/shift),
  // BUKAN role dashboard/Supabase Auth perangkat ini. Dipakai untuk gerbang
  // "tambah barang dari kasir" (Ita, manager, bisa; akun tamu/cashier,
  // tidak) -- dua identitas ini SENGAJA terpisah (lihat lib/pos/pos-add-
  // barang.ts), jadi role yang benar untuk keputusan ini WAJIB diambil
  // dari sini, bukan dari requirePermission() biasa.
  employeeRole: "owner" | "manager" | "cashier" | "waiter" | "kitchen" | "warehouse" | "accountant";
  // Akun tamu bersama (TT09b) -- terisi HANYA kalau shift ini dibuka akun
  // employees.isSharedAccount=true (lihat openShiftWithDb di bawah), null
  // selamanya untuk karyawan bernama biasa. Pemanggil yang menampilkan
  // "siapa bertugas" WAJIB pakai `servedByName ?? employeeName`, bukan
  // employeeName mentah -- kalau tidak, laporan akan selalu bilang "Akun
  // Tamu -- Bestie Thrift" untuk setiap orang berbeda yang pernah pakai
  // akun itu.
  servedByName: string | null;
  status: "open" | "closed" | "reconciled";
  openedAt: Date;
  businessDate: string;
  openingCash: string;
  countedCash: string | null;
  expectedCash: string | null;
  cashVariance: string | null;
};

/**
 * Shift dengan status='open' untuk device ini (satu device = satu terminal
 * fisik). Bisa saja counted_cash SUDAH terisi (sedang menunggu alasan
 * selisih) -- pakai isShiftSellable() untuk membedakan "boleh jualan" dari
 * "sedang proses tutup".
 */
export async function getOpenShiftForDevice(
  db: Db,
  businessId: string,
  deviceId: string
): Promise<OpenShiftRow | null> {
  const [row] = await db
    .select({
      id: shifts.id,
      outletId: shifts.outletId,
      deviceId: shifts.deviceId,
      employeeId: shifts.employeeId,
      employeeName: employees.fullName,
      employeeRole: employees.role,
      servedByName: shifts.servedByName,
      status: shifts.status,
      openedAt: shifts.openedAt,
      businessDate: shifts.businessDate,
      openingCash: shifts.openingCash,
      countedCash: shifts.countedCash,
      expectedCash: shifts.expectedCash,
      cashVariance: shifts.cashVariance,
    })
    .from(shifts)
    .innerJoin(employees, eq(shifts.employeeId, employees.id))
    .where(
      and(
        eq(shifts.businessId, businessId),
        eq(shifts.deviceId, deviceId),
        eq(shifts.status, "open")
      )
    )
    .orderBy(desc(shifts.openedAt))
    .limit(1);
  return row ?? null;
}

export type ShiftSellabilityIssue = "no_shift" | "closing_in_progress" | "stale";

/**
 * Kenapa ini ada (13 September 2026, temuan CEO -- §14 prasyarat shift):
 * shift yang tertinggal terbuka semalam SEBELUMNYA tetap bisa dipakai
 * jualan selama status masih 'open' -- businessDate transaksi dihitung
 * ulang tiap kali (benar), tapi orders.shiftId/cashierId diwariskan dari
 * shift yang sedang aktif APA ADANYA, tidak peduli sudah berapa lama
 * dibuka. Akibatnya penjualan besok tercatat atas nama/shift kemarin --
 * getSalesByCashier salah atribusi, rekonsiliasi kas shift itu mencampur
 * uang lebih dari satu hari kerja jadi satu angka yang mustahil
 * diverifikasi.
 *
 * Perbaikannya BUKAN cron yang menutup shift basi (itu cuma kerapian,
 * ditunda) -- titik yang sungguh berbahaya adalah shift basi BISA
 * MENYERAP TRANSAKSI BARU. Menutup jalur itu saja (di sini, satu-satunya
 * tempat) membuat shift basi tidak berbahaya lagi walau tetap
 * menggantung status='open' sampai ada yang menutupnya (kasir baru buka
 * shift baru sendiri -- lihat openShiftWithDb -- atau manajer menutupnya
 * lewat fitur force-close).
 */
export function checkShiftSellability(
  shift: OpenShiftRow | null,
  businessTimezone: string,
  dayCutoffTime: string
): ShiftSellabilityIssue | null {
  if (shift === null) {
    return "no_shift";
  }
  if (shift.countedCash !== null) {
    return "closing_in_progress";
  }
  const todayBusinessDate = businessDate(new Date(), businessTimezone, dayCutoffTime);
  if (shift.businessDate !== todayBusinessDate) {
    return "stale";
  }
  return null;
}

export function getShiftSellabilityErrorMessage(issue: ShiftSellabilityIssue): string {
  switch (issue) {
    case "no_shift":
      return strings.pos.noActiveShiftError;
    case "closing_in_progress":
      return strings.pos.shiftClosingInProgressError;
    case "stale":
      return strings.pos.staleShiftError;
  }
}

/**
 * Shift boleh dipakai jualan hanya kalau open, belum mulai proses tutup,
 * DAN businessDate-nya masih hari ini (bukan tertinggal dari hari
 * sebelumnya -- lihat checkShiftSellability di atas).
 */
export function isShiftSellable(
  shift: OpenShiftRow | null,
  businessTimezone: string,
  dayCutoffTime: string
): shift is OpenShiftRow {
  return checkShiftSellability(shift, businessTimezone, dayCutoffTime) === null;
}

export type OpenShiftSummaryRow = {
  id: string;
  outletId: string;
  outletName: string;
  employeeId: string;
  employeeName: string;
  openedAt: Date;
};

/**
 * SEMUA shift status='open' di bisnis ini (bukan per-device seperti
 * getOpenShiftForDevice) -- dipakai dashboard owner (T18) untuk "siapa yang
 * sedang bertugas". Sengaja tipe terpisah dari OpenShiftRow: tidak ikut
 * countedCash/expectedCash/cashVariance, dashboard cuma perlu identitas +
 * jam buka, bukan data rekonsiliasi kas.
 */
export async function getOpenShiftsForBusiness(
  db: Db,
  businessId: string
): Promise<OpenShiftSummaryRow[]> {
  return db
    .select({
      id: shifts.id,
      outletId: shifts.outletId,
      outletName: outlets.name,
      employeeId: shifts.employeeId,
      // Akun tamu bersama (TT09b) -- coalesce ke servedByName kalau terisi,
      // supaya dashboard "siapa bertugas" bilang "Rani"/"Dimas", bukan
      // literal nama akun tamu. Karyawan bernama biasa (servedByName selalu
      // null): tidak berubah sama sekali, tetap employees.fullName.
      employeeName: sql<string>`coalesce(${shifts.servedByName}, ${employees.fullName})`,
      openedAt: shifts.openedAt,
    })
    .from(shifts)
    .innerJoin(employees, eq(shifts.employeeId, employees.id))
    .innerJoin(outlets, eq(shifts.outletId, outlets.id))
    .where(and(eq(shifts.businessId, businessId), eq(shifts.status, "open")))
    .orderBy(shifts.openedAt);
}

export type ShiftReviewReason = "stale" | "force_closed_awaiting_cash";

export type ShiftNeedingReviewRow = {
  id: string;
  outletId: string;
  outletName: string;
  employeeId: string;
  employeeName: string;
  businessDate: string;
  status: "open" | "closed";
  reviewReason: ShiftReviewReason;
  openedAt: Date;
  closedAt: Date | null;
};

/**
 * Dua kategori shift yang perlu perhatian manajer (§14 prasyarat shift,
 * 13 September 2026):
 * 1. "stale" -- status masih 'open' tapi businessDate-nya bukan hari ini
 *    lagi (lihat checkShiftSellability) -- tidak bisa dipakai jualan
 *    lagi, menunggu forceCloseShiftWithDb().
 * 2. "force_closed_awaiting_cash" -- sudah ditutup manajer (forceClosedAt
 *    terisi) tapi kas belum dihitung -- menunggu
 *    reconcileForceClosedShiftWithDb().
 *
 * Staleness dihitung PER OUTLET (dayCutoffTime beda-beda per outlet),
 * makanya dilakukan di JavaScript sesudah query, bukan di WHERE SQL --
 * jumlah shift open per bisnis kecil (satu per device aktif), murah.
 */
export async function getShiftsNeedingReview(
  db: Db,
  businessId: string,
  businessTimezone: string
): Promise<ShiftNeedingReviewRow[]> {
  const openRows = await db
    .select({
      id: shifts.id,
      outletId: shifts.outletId,
      outletName: outlets.name,
      employeeId: shifts.employeeId,
      employeeName: sql<string>`coalesce(${shifts.servedByName}, ${employees.fullName})`,
      businessDate: shifts.businessDate,
      openedAt: shifts.openedAt,
      dayCutoffTime: outlets.dayCutoffTime,
    })
    .from(shifts)
    .innerJoin(employees, eq(shifts.employeeId, employees.id))
    .innerJoin(outlets, eq(shifts.outletId, outlets.id))
    .where(and(eq(shifts.businessId, businessId), eq(shifts.status, "open")));

  const staleRows: ShiftNeedingReviewRow[] = openRows
    .filter((r) => r.businessDate !== businessDate(new Date(), businessTimezone, r.dayCutoffTime))
    .map((r) => ({
      id: r.id,
      outletId: r.outletId,
      outletName: r.outletName,
      employeeId: r.employeeId,
      employeeName: r.employeeName,
      businessDate: r.businessDate,
      status: "open" as const,
      reviewReason: "stale" as const,
      openedAt: r.openedAt,
      closedAt: null,
    }));

  const awaitingCashRows = await db
    .select({
      id: shifts.id,
      outletId: shifts.outletId,
      outletName: outlets.name,
      employeeId: shifts.employeeId,
      employeeName: sql<string>`coalesce(${shifts.servedByName}, ${employees.fullName})`,
      businessDate: shifts.businessDate,
      openedAt: shifts.openedAt,
      closedAt: shifts.closedAt,
    })
    .from(shifts)
    .innerJoin(employees, eq(shifts.employeeId, employees.id))
    .innerJoin(outlets, eq(shifts.outletId, outlets.id))
    .where(
      and(
        eq(shifts.businessId, businessId),
        eq(shifts.status, "closed"),
        isNotNull(shifts.forceClosedAt),
        isNull(shifts.countedCash)
      )
    );

  return [
    ...staleRows,
    ...awaitingCashRows.map(
      (r): ShiftNeedingReviewRow => ({
        id: r.id,
        outletId: r.outletId,
        outletName: r.outletName,
        employeeId: r.employeeId,
        employeeName: r.employeeName,
        businessDate: r.businessDate,
        status: "closed" as const,
        reviewReason: "force_closed_awaiting_cash" as const,
        openedAt: r.openedAt,
        closedAt: r.closedAt,
      })
    ),
  ];
}

/** Dipakai T15b untuk menolak menonaktifkan karyawan yang sedang bertugas. */
export async function hasOpenShiftForEmployee(db: Db, employeeId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: shifts.id })
    .from(shifts)
    .where(and(eq(shifts.employeeId, employeeId), eq(shifts.status, "open")))
    .limit(1);
  return row !== undefined;
}

/** Dipakai T22b untuk menolak menonaktifkan outlet yang sedang punya shift terbuka. */
export async function hasOpenShiftForOutlet(db: Db, outletId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: shifts.id })
    .from(shifts)
    .where(and(eq(shifts.outletId, outletId), eq(shifts.status, "open")))
    .limit(1);
  return row !== undefined;
}

// ---------------------------------------------------------------------
// Buka shift
// ---------------------------------------------------------------------

export const openShiftSchema = z.object({
  id: z.string().uuid(), // client-generated, CLAUDE.md §3.4
  outletId: z.string().uuid(),
  deviceId: z.string().uuid(),
  employeeCode: z.string().min(1),
  pin: z.string().min(1),
  openingCash: z.string(),
  // Akun tamu bersama (TT09b) -- opsional di SCHEMA (form selalu menampilkan
  // field ini, employeeCode belum diketahui isSharedAccount-nya sebelum PIN
  // diverifikasi di bawah), tapi WAJIB diisi non-kosong kalau employee yang
  // terverifikasi ternyata isSharedAccount=true -- ditegakkan di bawah,
  // bukan lewat zod (keputusannya baru bisa diambil setelah tahu employeeId).
  servedByName: z.string().optional(),
});

export type OpenShiftResult = {
  error?: string;
  success?: { shiftId: string; employeeName: string; openedAt: string };
};

export async function openShiftWithDb(
  db: Db,
  businessId: string,
  rawInput: unknown
): Promise<OpenShiftResult> {
  const parsed = openShiftSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: strings.common.unexpectedError };
  }
  const data = parsed.data;

  try {
    const [business] = await db
      .select({ timezone: businesses.timezone })
      .from(businesses)
      .where(eq(businesses.id, businessId));
    const [outlet] = await db
      .select({ dayCutoffTime: outlets.dayCutoffTime, cashEnabled: outlets.cashEnabled })
      .from(outlets)
      .where(and(eq(outlets.id, data.outletId), eq(outlets.businessId, businessId)));
    if (!business || !outlet) {
      return { error: strings.common.unexpectedError };
    }

    // Diambil LEBIH DULU (bukan sekadar "ada shift open -> tolak") supaya
    // shift BASI (businessDate sudah bukan hari ini) TIDAK menghalangi
    // shift baru dibuka -- itu justru jalan keluarnya (§14 prasyarat
    // shift, 13 September 2026). Shift yang sedang mid-close
    // (countedCash terkunci) TETAP menghalangi -- itu proses aktif hari
    // ini, tidak boleh dilewati begitu saja dengan buka shift baru.
    const existing = await getOpenShiftForDevice(db, businessId, data.deviceId);
    const existingIssue = existing
      ? checkShiftSellability(existing, business.timezone, outlet.dayCutoffTime)
      : "no_shift";
    if (existingIssue === null || existingIssue === "closing_in_progress") {
      return { error: strings.shift.alreadyOpenError };
    }

    // verifyCashierPin() dari lib/auth/pin.ts (T07) -- belum pernah dipakai
    // di UI manapun sampai sekarang. Ini SATU-SATUNYA cara employeeId di
    // shift benar-benar terverifikasi (bukan klaim dari dropdown), dan
    // otomatis dapat lockout brute-force yang sudah dites di sana.
    let identity;
    try {
      identity = await verifyCashierPin({
        outletId: data.outletId,
        code: data.employeeCode,
        pin: data.pin,
      });
    } catch (err) {
      return { error: err instanceof Error ? err.message : strings.common.unexpectedError };
    }
    // Defense-in-depth (CLAUDE.md §3.4: RLS/business_id difilter eksplisit,
    // bukan diandalkan sendirian) -- outlet di atas sudah dipastikan milik
    // businessId ini, jadi employeeId hasil verifikasi PIN seharusnya juga.
    if (identity.businessId !== businessId) {
      return { error: strings.common.unexpectedError };
    }

    // Akun tamu bersama (TT09b) -- WAJIB isi nama pelayan kalau employee
    // yang barusan terverifikasi PIN-nya isSharedAccount=true. Ditegakkan
    // DI SINI (server), bukan cuma disembunyikan/diwajibkan di form --
    // "Selesai kalau" TT09b eksplisit: tombol disabled di UI tidak cukup.
    const [employeeRow] = await db
      .select({ isSharedAccount: employees.isSharedAccount })
      .from(employees)
      .where(eq(employees.id, identity.employeeId));
    const servedByNameTrimmed = data.servedByName?.trim() || "";
    if (employeeRow?.isSharedAccount && servedByNameTrimmed === "") {
      return { error: strings.shift.servedByNameRequiredError };
    }
    const servedByName = employeeRow?.isSharedAccount ? servedByNameTrimmed : null;

    const now = new Date();
    const bDate = businessDate(now, business.timezone, outlet.dayCutoffTime);
    // Outlet cashless: opening_cash dipaksa "0" di server, tidak percaya
    // input klien -- sama prinsipnya dengan field lain di lib/pos/*.
    const openingCash = outlet.cashEnabled ? data.openingCash : "0";

    await db.insert(shifts).values({
      id: data.id,
      businessId,
      outletId: data.outletId,
      deviceId: data.deviceId,
      employeeId: identity.employeeId,
      servedByName,
      status: "open",
      openedAt: now,
      businessDate: bDate,
      openingCash,
    });

    return {
      success: {
        shiftId: data.id,
        employeeName: servedByName ?? identity.fullName,
        openedAt: now.toISOString(),
      },
    };
  } catch (err) {
    console.error("openShiftWithDb gagal:", err);
    return { error: strings.common.unexpectedError };
  }
}

// ---------------------------------------------------------------------
// Kas masuk/keluar
// ---------------------------------------------------------------------

export const addCashMovementSchema = z.object({
  id: z.string().uuid(),
  shiftId: z.string().uuid(),
  type: z.enum(["cash_in", "cash_out"]),
  amount: z.string(),
  reason: z.string().min(1),
});

export type AddCashMovementResult = { error?: string; success?: { id: string } };

export async function addCashMovementWithDb(
  db: Db,
  businessId: string,
  rawInput: unknown
): Promise<AddCashMovementResult> {
  const parsed = addCashMovementSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: strings.common.unexpectedError };
  }
  const data = parsed.data;

  try {
    const [shift] = await db
      .select({
        status: shifts.status,
        countedCash: shifts.countedCash,
        outletId: shifts.outletId,
      })
      .from(shifts)
      .where(and(eq(shifts.id, data.shiftId), eq(shifts.businessId, businessId)));
    if (!shift) {
      return { error: strings.common.unexpectedError };
    }
    // Tidak boleh menambah kas masuk/keluar setelah counted_cash terkunci
    // -- itu akan membuat expected_cash yang sudah dihitung tidak lagi
    // cocok dengan data sebenarnya (sama alasannya dengan isShiftSellable()).
    if (shift.status !== "open" || shift.countedCash !== null) {
      return { error: strings.shift.notOpenForMovementError };
    }

    const [outlet] = await db
      .select({ cashEnabled: outlets.cashEnabled })
      .from(outlets)
      .where(eq(outlets.id, shift.outletId));
    // Outlet cashless: kas masuk/keluar tidak berlaku sama sekali, bukan
    // cuma disembunyikan tombolnya di UI -- pertahanan berlapis.
    if (!outlet || !outlet.cashEnabled) {
      return { error: strings.shift.cashDisabledError };
    }

    const [existing] = await db
      .select({ id: cashMovements.id })
      .from(cashMovements)
      .where(eq(cashMovements.id, data.id));
    if (existing) {
      return { success: { id: data.id } };
    }

    await db.insert(cashMovements).values({
      id: data.id,
      shiftId: data.shiftId,
      type: data.type,
      amount: data.amount,
      reason: data.reason,
    });

    return { success: { id: data.id } };
  } catch (err) {
    console.error("addCashMovementWithDb gagal:", err);
    return { error: strings.common.unexpectedError };
  }
}

// ---------------------------------------------------------------------
// Tutup shift -- lihat komentar besar di atas file untuk alasan dua langkah
// ---------------------------------------------------------------------

function sumDecimal<T extends { amount: string }>(rows: T[]): Decimal {
  return rows.reduce((sum, r) => sum.plus(r.amount), new Decimal(0));
}

async function getCashPaymentsTotal(db: Db, shiftId: string): Promise<Decimal> {
  const rows = await db
    .select({ amount: payments.amount })
    .from(payments)
    .innerJoin(orders, eq(payments.orderId, orders.id))
    .innerJoin(paymentMethods, eq(payments.paymentMethodId, paymentMethods.id))
    .where(
      and(
        eq(orders.shiftId, shiftId),
        eq(orders.status, "paid"),
        eq(paymentMethods.isCashDrawer, true)
      )
    );
  return sumDecimal(rows);
}

async function getChangeGivenTotal(db: Db, shiftId: string): Promise<Decimal> {
  // Kembalian selalu fisik uang tunai apa pun kombinasi metode
  // pembayarannya -- tidak difilter isCashDrawer di sini (CALC-SPEC bagian
  // E cuma sebut "Σ kembalian" sebagai satu angka, bukan per metode).
  const rows = await db
    .select({ amount: payments.changeAmount })
    .from(payments)
    .innerJoin(orders, eq(payments.orderId, orders.id))
    .where(and(eq(orders.shiftId, shiftId), eq(orders.status, "paid")));
  return sumDecimal(rows);
}

async function getCashMovementsTotal(
  db: Db,
  shiftId: string,
  type: "cash_in" | "cash_out"
): Promise<Decimal> {
  const rows = await db
    .select({ amount: cashMovements.amount })
    .from(cashMovements)
    .where(and(eq(cashMovements.shiftId, shiftId), eq(cashMovements.type, type)));
  return sumDecimal(rows);
}

/**
 * T16 (void & refund) belum dibangun -- tabel refunds akan selalu kosong
 * untuk shift manapun sampai saat itu, jadi ini forward-compatible no-op
 * untuk sekarang. Catatan untuk T16: refunds belum punya link ke payment
 * method, jadi query ini menghitung SEMUA refund shift sebagai pengurang
 * kas tunai -- perlu dikoreksi begitu refund non-tunai bisa terjadi.
 */
async function getCashRefundsTotal(db: Db, shiftId: string): Promise<Decimal> {
  const rows = await db
    .select({ amount: refunds.amount })
    .from(refunds)
    .innerJoin(orders, eq(refunds.orderId, orders.id))
    .where(eq(orders.shiftId, shiftId));
  return sumDecimal(rows);
}

export const submitCountedCashSchema = z.object({
  shiftId: z.string().uuid(),
  countedCash: z.string(),
});

export type SubmitCountedCashResult = {
  error?: string;
  success?: {
    countedCash: string;
    expectedCash: string;
    cashVariance: string;
    tolerance: string;
    requiresReason: boolean;
    closed: boolean;
    closedAt: string | null; // terisi hanya kalau closed=true
  };
};

export async function submitCountedCashWithDb(
  db: Db,
  businessId: string,
  rawInput: unknown
): Promise<SubmitCountedCashResult> {
  const parsed = submitCountedCashSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: strings.common.unexpectedError };
  }
  const data = parsed.data;

  try {
    const [shift] = await db
      .select()
      .from(shifts)
      .where(and(eq(shifts.id, data.shiftId), eq(shifts.businessId, businessId)));
    if (!shift) {
      return { error: strings.common.unexpectedError };
    }
    if (shift.status !== "open") {
      return { error: strings.shift.alreadyClosedError };
    }
    if (shift.countedCash !== null) {
      // WRITE-ONCE: counted_cash sudah pernah diisi. Tolak mentah-mentah,
      // apa pun nilai baru yang dikirim -- ini yang membuktikan aturan
      // ditegakkan di server, bukan cuma disembunyikan di UI.
      return { error: strings.shift.countedCashAlreadySetError };
    }

    const [outlet] = await db
      .select({
        cashVarianceTolerance: outlets.cashVarianceTolerance,
        cashEnabled: outlets.cashEnabled,
      })
      .from(outlets)
      .where(eq(outlets.id, shift.outletId));
    if (!outlet) {
      return { error: strings.common.unexpectedError };
    }
    // Outlet cashless: jalur ini cuma untuk outlet yang cash-nya aktif --
    // pakai closeCashlessShiftWithDb() untuk outlet cashless.
    if (!outlet.cashEnabled) {
      return { error: strings.shift.cashDisabledError };
    }

    const [cashPayments, changeGiven, cashIn, cashOut, cashRefunds] = await Promise.all([
      getCashPaymentsTotal(db, shift.id),
      getChangeGivenTotal(db, shift.id),
      getCashMovementsTotal(db, shift.id, "cash_in"),
      getCashMovementsTotal(db, shift.id, "cash_out"),
      getCashRefundsTotal(db, shift.id),
    ]);

    const countedCash = new Decimal(data.countedCash);
    const { expectedCash, cashVariance } = calculateShiftReconciliation({
      openingCash: new Decimal(shift.openingCash),
      cashPayments,
      changeGiven,
      cashIn,
      cashOut,
      cashRefunds,
      countedCash,
    });

    const tolerance = new Decimal(outlet.cashVarianceTolerance);
    const requiresReason = cashVariance.abs().greaterThan(tolerance);
    const now = new Date();

    // Guard `isNull(countedCash)` di WHERE (bukan cuma cek di atas) supaya
    // dua submit bersamaan (double-tap/race) tidak bisa dua-duanya lolos --
    // ini yang menegakkan write-once di level DB, atomik.
    const updated = await db
      .update(shifts)
      .set({
        countedCash: countedCash.toFixed(2),
        expectedCash: expectedCash.toFixed(2),
        cashVariance: cashVariance.toFixed(2),
        ...(requiresReason ? {} : { status: "closed" as const, closedAt: now }),
      })
      .where(and(eq(shifts.id, shift.id), eq(shifts.status, "open"), isNull(shifts.countedCash)))
      .returning({ id: shifts.id });

    if (updated.length === 0) {
      return { error: strings.shift.countedCashAlreadySetError };
    }

    return {
      success: {
        countedCash: countedCash.toFixed(2),
        expectedCash: expectedCash.toFixed(2),
        cashVariance: cashVariance.toFixed(2),
        tolerance: tolerance.toFixed(2),
        requiresReason,
        closed: !requiresReason,
        closedAt: requiresReason ? null : now.toISOString(),
      },
    };
  } catch (err) {
    console.error("submitCountedCashWithDb gagal:", err);
    return { error: strings.common.unexpectedError };
  }
}

export const confirmShiftCloseSchema = z.object({
  shiftId: z.string().uuid(),
  reason: z.string().min(1),
});

export type ConfirmShiftCloseResult = { error?: string; success?: { closedAt: string } };

/**
 * Dipakai HANYA untuk melengkapi shift yang selisihnya di luar toleransi
 * (submitCountedCashWithDb() sudah mengunci counted_cash tapi belum
 * menutup). TIDAK PERNAH menyentuh counted_cash/expected_cash/cash_variance
 * -- cuma menambahkan alasan lalu memindahkan status ke 'closed'.
 */
export async function confirmShiftCloseWithDb(
  db: Db,
  businessId: string,
  rawInput: unknown
): Promise<ConfirmShiftCloseResult> {
  const parsed = confirmShiftCloseSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: strings.common.unexpectedError };
  }
  const data = parsed.data;

  try {
    const [shift] = await db
      .select({ status: shifts.status, countedCash: shifts.countedCash })
      .from(shifts)
      .where(and(eq(shifts.id, data.shiftId), eq(shifts.businessId, businessId)));
    if (!shift) {
      return { error: strings.common.unexpectedError };
    }
    if (shift.status !== "open") {
      return { error: strings.shift.alreadyClosedError };
    }
    if (shift.countedCash === null) {
      return { error: strings.shift.countedCashRequiredError };
    }

    const now = new Date();
    const updated = await db
      .update(shifts)
      .set({ note: data.reason, status: "closed", closedAt: now })
      .where(and(eq(shifts.id, data.shiftId), eq(shifts.status, "open")))
      .returning({ id: shifts.id });

    if (updated.length === 0) {
      return { error: strings.shift.alreadyClosedError };
    }

    return { success: { closedAt: now.toISOString() } };
  } catch (err) {
    console.error("confirmShiftCloseWithDb gagal:", err);
    return { error: strings.common.unexpectedError };
  }
}

// ---------------------------------------------------------------------
// Tutup shift -- outlet cashless (cash_enabled = false)
// ---------------------------------------------------------------------

export type ShiftSalesSummary = {
  orderCount: number;
  totalsByMethod: { methodName: string; total: string }[];
};

/**
 * Ringkasan penjualan shift TANPA menyentuh apa pun soal kas -- dipakai
 * layar tutup shift outlet cashless (jumlah transaksi, total per metode
 * bayar), dan bisa juga dipakai kapan saja shift masih berjalan (live
 * preview), bukan cuma setelah closed.
 */
export async function getShiftSalesSummary(db: Db, shiftId: string): Promise<ShiftSalesSummary> {
  const rows = await db
    .select({
      orderId: orders.id,
      methodName: payments.methodName,
      amount: payments.amount,
      changeAmount: payments.changeAmount,
    })
    .from(payments)
    .innerJoin(orders, eq(payments.orderId, orders.id))
    .where(and(eq(orders.shiftId, shiftId), eq(orders.status, "paid")));

  const orderIds = new Set<string>();
  const totalByMethod = new Map<string, Decimal>();
  for (const r of rows) {
    orderIds.add(r.orderId);
    const sum = totalByMethod.get(r.methodName) ?? new Decimal(0);
    // amount - changeAmount, bukan amount mentah -- amount adalah yang
    // DITENDANG (bisa lebih dari total kalau ada kembalian), penjualan
    // sesungguhnya per metode adalah net-nya (sama logika dengan
    // getCashPaymentsTotal/getChangeGivenTotal di atas untuk rekonsiliasi
    // kas, cuma di sini per-metode bukan cuma tunai).
    const net = new Decimal(r.amount).minus(r.changeAmount);
    totalByMethod.set(r.methodName, sum.plus(net));
  }

  return {
    orderCount: orderIds.size,
    totalsByMethod: [...totalByMethod.entries()].map(([methodName, total]) => ({
      methodName,
      total: total.toFixed(2),
    })),
  };
}

export const closeCashlessShiftSchema = z.object({
  shiftId: z.string().uuid(),
});

export type CloseCashlessShiftResult = { error?: string; success?: { closedAt: string } };

/**
 * Tutup shift untuk outlet cashless -- TIDAK PERNAH menyentuh
 * counted_cash/expected_cash/cash_variance (tetap null selamanya untuk
 * shift ini). Satu langkah, tidak seperti submitCountedCashWithDb() +
 * confirmShiftCloseWithDb() yang dua langkah -- tidak ada apa pun untuk
 * direkonsiliasi di sini.
 */
export async function closeCashlessShiftWithDb(
  db: Db,
  businessId: string,
  rawInput: unknown
): Promise<CloseCashlessShiftResult> {
  const parsed = closeCashlessShiftSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: strings.common.unexpectedError };
  }
  const data = parsed.data;

  try {
    const [shift] = await db
      .select({ status: shifts.status, outletId: shifts.outletId })
      .from(shifts)
      .where(and(eq(shifts.id, data.shiftId), eq(shifts.businessId, businessId)));
    if (!shift) {
      return { error: strings.common.unexpectedError };
    }
    if (shift.status !== "open") {
      return { error: strings.shift.alreadyClosedError };
    }

    const [outlet] = await db
      .select({ cashEnabled: outlets.cashEnabled })
      .from(outlets)
      .where(eq(outlets.id, shift.outletId));
    // Jalur ini cuma untuk outlet cashless -- outlet dengan cash aktif
    // wajib lewat submitCountedCashWithDb()/confirmShiftCloseWithDb().
    if (!outlet || outlet.cashEnabled) {
      return { error: strings.shift.cashEnabledError };
    }

    const now = new Date();
    const updated = await db
      .update(shifts)
      .set({ status: "closed", closedAt: now })
      .where(and(eq(shifts.id, data.shiftId), eq(shifts.status, "open")))
      .returning({ id: shifts.id });

    if (updated.length === 0) {
      return { error: strings.shift.alreadyClosedError };
    }

    return { success: { closedAt: now.toISOString() } };
  } catch (err) {
    console.error("closeCashlessShiftWithDb gagal:", err);
    return { error: strings.common.unexpectedError };
  }
}

// ---------------------------------------------------------------------
// Manajer menutup shift orang lain -- §14 prasyarat shift (13 September
// 2026, temuan CEO). Shift basi (lihat checkShiftSellability) tidak lagi
// bisa dipakai jualan, tapi tetap status='open' sampai SESEORANG
// menutupnya -- ini jalan itu, untuk shift yang pemiliknya sendiri sudah
// tidak bisa/tidak mungkin lagi menutupnya (mis. sudah pulang semalam).
// ---------------------------------------------------------------------

export const forceCloseShiftSchema = z.object({
  shiftId: z.string().uuid(),
  reason: z.string().min(1),
});

export type ForceCloseShiftResult = {
  error?: string;
  success?: { closedAt: string; needsReview: boolean };
};

/**
 * Menutup shift MILIK ORANG LAIN. Alasan WAJIB, dicatat ke audit_logs
 * (siapa menutup shift siapa, kapan, kenapa) -- bukan cuma disimpan di
 * shifts.note. Izin dicek di Server Action pembungkus (shift.reconcile,
 * owner/manajer/akuntan -- lihat lib/auth/permissions.ts, izin yang
 * SUDAH ADA, tidak pernah dipasang ke mana pun sebelum ini).
 *
 * Kas TIDAK PERNAH dihitung di sini, bahkan untuk outlet bertunai --
 * manajer yang menutup dari jauh belum tentu tahu isi laci kas outlet
 * itu. Outlet CASHLESS: langsung selesai (tidak ada apa pun untuk
 * direkonsiliasi). Outlet BERTUNAI: forceClosedAt menandai "perlu
 * ditinjau" sampai reconcileForceClosedShiftWithDb() dipanggil
 * belakangan oleh siapa pun yang tahu isi laci kasnya.
 */
export async function forceCloseShiftWithDb(
  db: Db,
  businessId: string,
  actingUserId: string,
  rawInput: unknown
): Promise<ForceCloseShiftResult> {
  const parsed = forceCloseShiftSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const data = parsed.data;

  try {
    const [shift] = await db
      .select()
      .from(shifts)
      .where(and(eq(shifts.id, data.shiftId), eq(shifts.businessId, businessId)));
    if (!shift) {
      return { error: strings.common.unexpectedError };
    }
    if (shift.status !== "open") {
      return { error: strings.shift.alreadyClosedError };
    }

    const [outlet] = await db
      .select({ cashEnabled: outlets.cashEnabled })
      .from(outlets)
      .where(eq(outlets.id, shift.outletId));
    if (!outlet) {
      return { error: strings.common.unexpectedError };
    }

    const now = new Date();
    const needsReview = outlet.cashEnabled;

    const updated = await db
      .update(shifts)
      .set({
        status: "closed",
        closedAt: now,
        forceClosedAt: now,
        note: data.reason,
      })
      .where(and(eq(shifts.id, data.shiftId), eq(shifts.status, "open")))
      .returning({ id: shifts.id });
    if (updated.length === 0) {
      return { error: strings.shift.alreadyClosedError };
    }

    await db.insert(auditLogs).values({
      id: generateId(),
      businessId,
      outletId: shift.outletId,
      // employees.id shift yang DITUTUP (bukan yang menutup) -- itu FK
      // valid ke employees, manajer yang menutup (Supabase Auth,
      // profiles.id) bukan employees.id sehingga ditaruh di metadata,
      // bukan dipaksa ke kolom employeeId.
      employeeId: shift.employeeId,
      action: "shift_force_closed",
      refType: "shift",
      refId: shift.id,
      reason: data.reason,
      metadata: {
        closedByProfileId: actingUserId,
        shiftBusinessDate: shift.businessDate,
        needsReview,
      },
      createdAt: now,
    });

    return { success: { closedAt: now.toISOString(), needsReview } };
  } catch (err) {
    console.error("forceCloseShiftWithDb gagal:", err);
    return { error: strings.common.unexpectedError };
  }
}

export const reconcileForceClosedShiftSchema = z.object({
  shiftId: z.string().uuid(),
  countedCash: z.string(),
});

export type ReconcileForceClosedShiftResult = {
  error?: string;
  success?: {
    countedCash: string;
    expectedCash: string;
    cashVariance: string;
    tolerance: string;
    requiresReason: boolean;
    reconciled: boolean;
  };
};

/**
 * Melengkapi rekonsiliasi kas shift yang sebelumnya ditutup paksa TANPA
 * hitungan kas (forceCloseShiftWithDb, outlet bertunai). Pola SAMA
 * PERSIS submitCountedCashWithDb (write-once, guard atomik di WHERE),
 * bedanya shift ini sudah status='closed' (bukan 'open') menunggu kas.
 * Kalau selisih masih dalam toleransi, langsung 'reconciled' di sini.
 * Kalau di luar toleransi, tetap 'closed' menunggu
 * confirmForceClosedReconciliationWithDb() dengan alasan tambahan --
 * pola sama dua-langkah confirmShiftCloseWithDb.
 */
export async function reconcileForceClosedShiftWithDb(
  db: Db,
  businessId: string,
  rawInput: unknown
): Promise<ReconcileForceClosedShiftResult> {
  const parsed = reconcileForceClosedShiftSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: strings.common.unexpectedError };
  }
  const data = parsed.data;

  try {
    const [shift] = await db
      .select()
      .from(shifts)
      .where(and(eq(shifts.id, data.shiftId), eq(shifts.businessId, businessId)));
    if (!shift) {
      return { error: strings.common.unexpectedError };
    }
    if (shift.status !== "closed" || shift.forceClosedAt === null) {
      return { error: strings.shift.notAwaitingReconciliationError };
    }
    if (shift.countedCash !== null) {
      return { error: strings.shift.countedCashAlreadySetError };
    }

    const [outlet] = await db
      .select({ cashVarianceTolerance: outlets.cashVarianceTolerance })
      .from(outlets)
      .where(eq(outlets.id, shift.outletId));
    if (!outlet) {
      return { error: strings.common.unexpectedError };
    }

    const [cashPayments, changeGiven, cashIn, cashOut, cashRefunds] = await Promise.all([
      getCashPaymentsTotal(db, shift.id),
      getChangeGivenTotal(db, shift.id),
      getCashMovementsTotal(db, shift.id, "cash_in"),
      getCashMovementsTotal(db, shift.id, "cash_out"),
      getCashRefundsTotal(db, shift.id),
    ]);

    const countedCash = new Decimal(data.countedCash);
    const { expectedCash, cashVariance } = calculateShiftReconciliation({
      openingCash: new Decimal(shift.openingCash),
      cashPayments,
      changeGiven,
      cashIn,
      cashOut,
      cashRefunds,
      countedCash,
    });

    const tolerance = new Decimal(outlet.cashVarianceTolerance);
    const requiresReason = cashVariance.abs().greaterThan(tolerance);

    const updated = await db
      .update(shifts)
      .set({
        countedCash: countedCash.toFixed(2),
        expectedCash: expectedCash.toFixed(2),
        cashVariance: cashVariance.toFixed(2),
        ...(requiresReason ? {} : { status: "reconciled" as const }),
      })
      .where(and(eq(shifts.id, shift.id), eq(shifts.status, "closed"), isNull(shifts.countedCash)))
      .returning({ id: shifts.id });
    if (updated.length === 0) {
      return { error: strings.shift.countedCashAlreadySetError };
    }

    if (!requiresReason) {
      await insertShiftReconciledAuditLog(db, {
        businessId,
        shift,
        countedCash,
        expectedCash,
        cashVariance,
        reason: null,
      });
    }

    return {
      success: {
        countedCash: countedCash.toFixed(2),
        expectedCash: expectedCash.toFixed(2),
        cashVariance: cashVariance.toFixed(2),
        tolerance: tolerance.toFixed(2),
        requiresReason,
        reconciled: !requiresReason,
      },
    };
  } catch (err) {
    console.error("reconcileForceClosedShiftWithDb gagal:", err);
    return { error: strings.common.unexpectedError };
  }
}

export const confirmForceClosedReconciliationSchema = z.object({
  shiftId: z.string().uuid(),
  reason: z.string().min(1),
});

export type ConfirmForceClosedReconciliationResult = { error?: string; success?: { reconciledAt: string } };

/**
 * Dipakai HANYA untuk melengkapi shift force-closed yang selisih kasnya
 * di luar toleransi (reconcileForceClosedShiftWithDb sudah mengunci
 * counted_cash tapi belum pindah ke 'reconciled'). Sama persis pola
 * confirmShiftCloseWithDb -- TIDAK PERNAH menyentuh counted_cash/
 * expected_cash/cash_variance lagi, cuma alasan lalu memindahkan status.
 */
export async function confirmForceClosedReconciliationWithDb(
  db: Db,
  businessId: string,
  rawInput: unknown
): Promise<ConfirmForceClosedReconciliationResult> {
  const parsed = confirmForceClosedReconciliationSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: strings.common.unexpectedError };
  }
  const data = parsed.data;

  try {
    const [shift] = await db
      .select()
      .from(shifts)
      .where(and(eq(shifts.id, data.shiftId), eq(shifts.businessId, businessId)));
    if (!shift) {
      return { error: strings.common.unexpectedError };
    }
    if (shift.status !== "closed" || shift.forceClosedAt === null) {
      return { error: strings.shift.notAwaitingReconciliationError };
    }
    if (shift.countedCash === null) {
      return { error: strings.shift.countedCashRequiredError };
    }

    const updated = await db
      .update(shifts)
      .set({ status: "reconciled" })
      .where(and(eq(shifts.id, data.shiftId), eq(shifts.status, "closed")))
      .returning({ id: shifts.id });
    if (updated.length === 0) {
      return { error: strings.shift.alreadyClosedError };
    }

    await insertShiftReconciledAuditLog(db, {
      businessId,
      shift,
      countedCash: new Decimal(shift.countedCash),
      expectedCash: new Decimal(shift.expectedCash ?? "0"),
      cashVariance: new Decimal(shift.cashVariance ?? "0"),
      reason: data.reason,
    });

    return { success: { reconciledAt: new Date().toISOString() } };
  } catch (err) {
    console.error("confirmForceClosedReconciliationWithDb gagal:", err);
    return { error: strings.common.unexpectedError };
  }
}

async function insertShiftReconciledAuditLog(
  db: Db,
  params: {
    businessId: string;
    shift: { id: string; outletId: string; employeeId: string };
    countedCash: Decimal;
    expectedCash: Decimal;
    cashVariance: Decimal;
    reason: string | null;
  }
): Promise<void> {
  await db.insert(auditLogs).values({
    id: generateId(),
    businessId: params.businessId,
    outletId: params.shift.outletId,
    employeeId: params.shift.employeeId,
    action: "shift_reconciled",
    refType: "shift",
    refId: params.shift.id,
    reason: params.reason,
    metadata: {
      countedCash: params.countedCash.toFixed(2),
      expectedCash: params.expectedCash.toFixed(2),
      cashVariance: params.cashVariance.toFixed(2),
    },
    createdAt: new Date(),
  });
}
