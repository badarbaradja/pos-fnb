import { and, eq } from "drizzle-orm";
import type { UserDbHandle } from "@/lib/db/client";
import { shifts, employees, barang } from "@/lib/db/schema";
import { saveBarangWithDb, type BarangActionResult } from "@/lib/barang/manage";
import { id as strings } from "@/lib/i18n/id";

type Db = UserDbHandle["db"];

/**
 * lib/pos/pos-add-barang.ts — TT06 lanjutan (11 September 2026), instruksi
 * CEO langsung: "Ita super kasir" -- menambah barang harus bisa dari akun
 * kasir Ita langsung di /pos/thrift, tanpa pindah ke /barang (yang butuh
 * login dashboard Supabase Auth terpisah, bukan sekadar PIN shift).
 *
 * GERBANG DI SINI SENGAJA BUKAN requirePermissionDb(..., "barang.manage").
 * Server Action pemanggil (pos/thrift/actions.ts) tetap memverifikasi sesi
 * Supabase Auth device (pos.create_order, sama seperti jual/pindai) --
 * tapi IZIN UNTUK MENAMBAH BARANG di sini diputuskan dari role EMPLOYEE
 * pemilik shift yang sedang terbuka (PIN), bukan dari role membership
 * Supabase Auth sesi dashboard perangkat. Dua identitas ini terpisah:
 * device/tablet biasanya login dashboard sekali sebagai role cashier
 * (pos.create_order=on, tapi barang.manage=na) -- kalau gerbangnya lewat
 * requirePermissionDb biasa, TIDAK ADA kasir manapun yang PERNAH bisa
 * memakai tombol ini, siapa pun yang PIN login sebagai Ita sekalipun.
 *
 * Akun tamu (isSharedAccount) OTOMATIS tertolak di sini -- employees.role
 * akun tamu SELALU 'cashier' (lihat scripts/demo-thrift-checkpoint.ts),
 * tidak pernah 'manager', jadi tidak perlu pengecekan isSharedAccount
 * terpisah.
 */
export async function addBarangFromShiftWithDb(
  db: Db,
  businessId: string,
  shiftId: string,
  rawInput: unknown
): Promise<BarangActionResult> {
  const [shift] = await db
    .select({ status: shifts.status, employeeRole: employees.role })
    .from(shifts)
    .innerJoin(employees, eq(shifts.employeeId, employees.id))
    .where(and(eq(shifts.id, shiftId), eq(shifts.businessId, businessId)));

  if (!shift || shift.status !== "open") {
    return { error: strings.common.unexpectedError };
  }
  if (shift.employeeRole !== "manager" && shift.employeeRole !== "owner") {
    return { error: strings.pos.tambahBarangAksesDitolakError };
  }

  const result = await saveBarangWithDb(db, businessId, rawInput);
  if (result.error || !result.success) {
    return result;
  }

  // Barang dari kasir langsung siap dijual di sesi yang sama -- BEDA dari
  // intake lewat /barang (default 'baru_masuk', perlu ditandai manual di
  // Admin). Ita menambah barang ini untuk dijual SEKARANG, bukan disimpan
  // dulu untuk sesi input massal nanti.
  await db
    .update(barang)
    .set({ status: "siap_jual" })
    .where(and(eq(barang.id, result.success.barangId), eq(barang.businessId, businessId)));

  return result;
}
