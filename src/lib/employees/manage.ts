import { z } from "zod";
import { and, eq } from "drizzle-orm";
import type { UserDbHandle } from "@/lib/db/client";
import { employees } from "@/lib/db/schema";
import { assertRowsAffected, isUniqueViolation } from "@/lib/db/errors";
import { generateId } from "@/lib/utils/id";
import { hashPin } from "@/lib/auth/pin";
import { hasOpenShiftForEmployee } from "@/lib/pos/shift";
import { isOutletAllowed, type OutletScope } from "@/lib/auth/outlet-scope";
import { employeeRoleValues } from "./roles";
import { id as strings } from "@/lib/i18n/id";

export { employeeRoleValues };

/**
 * Pembatasan akses per outlet, Tahap 4 (13 September 2026, §27) --
 * employees.outletId NULLABLE (karyawan tanpa outlet tertentu, mis.
 * peran lintas-outlet) -- isOutletAllowed() sendiri butuh outletId
 * non-null, jadi null ditangani TERPISAH di sini: karyawan TANPA
 * outlet cuma bisa disentuh pemanggil yang TAK TERBATAS (scope null).
 * Kebalikannya (menganggap null "selalu boleh") akan membiarkan
 * manajer yang dibatasi menyentuh SEMUA karyawan lintas-outlet lewat
 * satu celah -- tolak dulu untuk kasus ambigu ini, bukan longgarkan.
 */
function isEmployeeOutletAllowed(scope: OutletScope, outletId: string | null): boolean {
  if (outletId === null) {
    return scope === null;
  }
  return isOutletAllowed(scope, outletId);
}

/**
 * lib/employees/manage.ts — T15b. Pola thin-wrapper sama lib/pos/shift.ts/
 * lib/pos/void-refund.ts (fungsi murni (db, businessId, input) => result,
 * testable tanpa request Next.js sungguhan, dipisah dari Server Action
 * pembungkus di app/(dashboard)/employees/actions.ts) -- dipilih dibanding
 * pola categories/products (logic langsung di actions.ts) karena employees
 * punya aturan yang wajib diuji eksplisit: kode unik per bisnis, dan
 * larangan menonaktifkan karyawan yang sedang punya shift terbuka.
 *
 * PIN tidak pernah dibaca balik di sini -- cuma di-hash (hashPin, sudah ada
 * di lib/auth/pin.ts) lalu ditulis. Tidak ada fungsi "getPin"/"showPin".
 */

type Db = UserDbHandle["db"];

const pinSchema = z.string().regex(/^\d{6}$/, strings.employees.pinFormatError);

const createEmployeeSchema = z.object({
  code: z.string().trim().min(1, strings.common.requiredField),
  fullName: z.string().trim().min(1, strings.common.requiredField),
  role: z.enum(employeeRoleValues),
  outletId: z.string().uuid().nullable(),
  pin: pinSchema,
});

const updateEmployeeSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string().trim().min(1, strings.common.requiredField),
  role: z.enum(employeeRoleValues),
  outletId: z.string().uuid().nullable(),
  isActive: z.boolean(),
});

export type EmployeeActionResult = {
  error?: string;
  success?: { employeeId: string };
};

export async function createEmployeeWithDb(
  db: Db,
  businessId: string,
  allowedOutletIds: OutletScope,
  rawInput: unknown
): Promise<EmployeeActionResult> {
  const parsed = createEmployeeSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const data = parsed.data;

  if (!isEmployeeOutletAllowed(allowedOutletIds, data.outletId)) {
    return { error: strings.common.outletAccessDenied };
  }

  const pinHash = await hashPin(data.pin);
  const employeeId = generateId();

  try {
    await db.insert(employees).values({
      id: employeeId,
      businessId,
      outletId: data.outletId,
      code: data.code,
      fullName: data.fullName,
      role: data.role,
      pinHash,
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { error: strings.employees.duplicateCode };
    }
    throw err;
  }

  return { success: { employeeId } };
}

export async function updateEmployeeWithDb(
  db: Db,
  businessId: string,
  allowedOutletIds: OutletScope,
  rawInput: unknown
): Promise<EmployeeActionResult> {
  const parsed = updateEmployeeSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const data = parsed.data;

  // Pembatasan akses per outlet, Tahap 4 -- DUA sumber diperiksa
  // TERPISAH (kasus jahat CEO: manajer mengubah baris outlet yang
  // diizinkan, tapi memindahkannya ke outlet lain lewat input). Baris
  // SAAT INI (current.outletId) diambil ulang dari DB -- manajer tidak
  // boleh menyentuh karyawan outlet lain sama sekali, apa pun input
  // barunya. outletId TUJUAN (data.outletId) diperiksa terpisah --
  // manajer tidak boleh memindahkan karyawan yang diizinkan KE outlet
  // yang tidak diizinkan.
  const [current] = await db
    .select({ outletId: employees.outletId })
    .from(employees)
    .where(and(eq(employees.id, data.id), eq(employees.businessId, businessId)));
  if (!current) {
    return { error: strings.common.unexpectedError };
  }
  if (!isEmployeeOutletAllowed(allowedOutletIds, current.outletId)) {
    return { error: strings.common.outletAccessDenied };
  }
  if (!isEmployeeOutletAllowed(allowedOutletIds, data.outletId)) {
    return { error: strings.common.outletAccessDenied };
  }

  if (!data.isActive) {
    const hasOpenShift = await hasOpenShiftForEmployee(db, data.id);
    if (hasOpenShift) {
      return { error: strings.employees.deactivateBlockedOpenShift };
    }
  }

  const updated = await db
    .update(employees)
    .set({
      fullName: data.fullName,
      role: data.role,
      outletId: data.outletId,
      isActive: data.isActive,
    })
    .where(and(eq(employees.id, data.id), eq(employees.businessId, businessId)))
    .returning({ id: employees.id });
  assertRowsAffected(updated, "karyawan");

  return { success: { employeeId: data.id } };
}

export async function resetPinWithDb(
  db: Db,
  businessId: string,
  allowedOutletIds: OutletScope,
  rawInput: unknown
): Promise<EmployeeActionResult> {
  const parsed = z.object({ employeeId: z.string().uuid(), newPin: pinSchema }).safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const { employeeId, newPin } = parsed.data;

  // Pembatasan akses per outlet, Tahap 4 -- DITAMBAHKAN PROAKTIF, di
  // luar "Employees" yang dimaksud CEO secara umum tapi belum tentu
  // mencakup fungsi reset PIN spesifik ini: menerima employeeId
  // langsung, gerbang izin sama (employee.manage), risiko identik.
  const [current] = await db
    .select({ outletId: employees.outletId })
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.businessId, businessId)));
  if (!current) {
    return { error: strings.common.unexpectedError };
  }
  if (!isEmployeeOutletAllowed(allowedOutletIds, current.outletId)) {
    return { error: strings.common.outletAccessDenied };
  }

  const pinHash = await hashPin(newPin);
  // Reset PIN sekalian membuka kunci -- kalau tidak, owner reset PIN tapi
  // karyawan masih terkunci dari lockout PIN LAMA, membingungkan.
  const updated = await db
    .update(employees)
    .set({ pinHash, failedAttempts: 0, lockedUntil: null })
    .where(and(eq(employees.id, employeeId), eq(employees.businessId, businessId)))
    .returning({ id: employees.id });
  assertRowsAffected(updated, "karyawan");

  return { success: { employeeId } };
}

export async function unlockEmployeeWithDb(
  db: Db,
  businessId: string,
  allowedOutletIds: OutletScope,
  rawInput: unknown
): Promise<EmployeeActionResult> {
  const parsed = z.object({ employeeId: z.string().uuid() }).safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const { employeeId } = parsed.data;

  // Pembatasan akses per outlet, Tahap 4 -- DITAMBAHKAN PROAKTIF, pola
  // sama resetPinWithDb di atas.
  const [current] = await db
    .select({ outletId: employees.outletId })
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.businessId, businessId)));
  if (!current) {
    return { error: strings.common.unexpectedError };
  }
  if (!isEmployeeOutletAllowed(allowedOutletIds, current.outletId)) {
    return { error: strings.common.outletAccessDenied };
  }

  const updated = await db
    .update(employees)
    .set({ failedAttempts: 0, lockedUntil: null })
    .where(and(eq(employees.id, employeeId), eq(employees.businessId, businessId)))
    .returning({ id: employees.id });
  assertRowsAffected(updated, "karyawan");

  return { success: { employeeId } };
}
