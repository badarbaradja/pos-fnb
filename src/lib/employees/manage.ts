import { z } from "zod";
import { and, eq } from "drizzle-orm";
import type { UserDbHandle } from "@/lib/db/client";
import { employees } from "@/lib/db/schema";
import { isUniqueViolation } from "@/lib/db/errors";
import { generateId } from "@/lib/utils/id";
import { hashPin } from "@/lib/auth/pin";
import { hasOpenShiftForEmployee } from "@/lib/pos/shift";
import { employeeRoleValues } from "./roles";
import { id as strings } from "@/lib/i18n/id";

export { employeeRoleValues };

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
  rawInput: unknown
): Promise<EmployeeActionResult> {
  const parsed = createEmployeeSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const data = parsed.data;

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
  rawInput: unknown
): Promise<EmployeeActionResult> {
  const parsed = updateEmployeeSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const data = parsed.data;

  if (!data.isActive) {
    const hasOpenShift = await hasOpenShiftForEmployee(db, data.id);
    if (hasOpenShift) {
      return { error: strings.employees.deactivateBlockedOpenShift };
    }
  }

  await db
    .update(employees)
    .set({
      fullName: data.fullName,
      role: data.role,
      outletId: data.outletId,
      isActive: data.isActive,
    })
    .where(and(eq(employees.id, data.id), eq(employees.businessId, businessId)));

  return { success: { employeeId: data.id } };
}

export async function resetPinWithDb(
  db: Db,
  businessId: string,
  rawInput: unknown
): Promise<EmployeeActionResult> {
  const parsed = z.object({ employeeId: z.string().uuid(), newPin: pinSchema }).safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const { employeeId, newPin } = parsed.data;

  const pinHash = await hashPin(newPin);
  // Reset PIN sekalian membuka kunci -- kalau tidak, owner reset PIN tapi
  // karyawan masih terkunci dari lockout PIN LAMA, membingungkan.
  await db
    .update(employees)
    .set({ pinHash, failedAttempts: 0, lockedUntil: null })
    .where(and(eq(employees.id, employeeId), eq(employees.businessId, businessId)));

  return { success: { employeeId } };
}

export async function unlockEmployeeWithDb(
  db: Db,
  businessId: string,
  rawInput: unknown
): Promise<EmployeeActionResult> {
  const parsed = z.object({ employeeId: z.string().uuid() }).safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const { employeeId } = parsed.data;

  await db
    .update(employees)
    .set({ failedAttempts: 0, lockedUntil: null })
    .where(and(eq(employees.id, employeeId), eq(employees.businessId, businessId)));

  return { success: { employeeId } };
}
