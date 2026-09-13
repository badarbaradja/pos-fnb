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
 *
 * Pembatasan akses per outlet, Tahap 4 (13 September 2026, §27) --
 * DITEMUKAN PROAKTIF saat memperbaiki saveBarangWithDb, bukan diminta
 * CEO: identitas di jalur ini BUKAN membership Supabase Auth (lihat
 * komentar di atas -- gerbangnya sengaja role EMPLOYEE shift, bukan
 * role dashboard), jadi `allowedOutletIds` dari memberships TIDAK
 * relevan sama sekali di sini. Skop yang relevan justru lebih sempit
 * dan lebih pasti: shift ini SATU-SATUNYA outlet yang sah untuk aksi
 * ini, apa pun outletId yang diklaim `rawInput` (dikirim klien, bisa
 * disunting). Dipaksa lewat `[shift.outletId]` sebagai allowedOutletIds
 * ke saveBarangWithDb -- menutup celah nyata: SEBELUM ini, kasir yang
 * sedang shift di Outlet A bisa mengirim outletId Outlet B di body
 * request dan barang akan tertambah di Outlet B walau dia fisik/shift
 * di Outlet A.
 */
export async function addBarangFromShiftWithDb(
  db: Db,
  businessId: string,
  shiftId: string,
  rawInput: unknown
): Promise<BarangActionResult> {
  const [shift] = await db
    .select({ status: shifts.status, employeeRole: employees.role, outletId: shifts.outletId })
    .from(shifts)
    .innerJoin(employees, eq(shifts.employeeId, employees.id))
    .where(and(eq(shifts.id, shiftId), eq(shifts.businessId, businessId)));

  if (!shift || shift.status !== "open") {
    return { error: strings.common.unexpectedError };
  }
  if (shift.employeeRole !== "manager" && shift.employeeRole !== "owner") {
    return { error: strings.pos.tambahBarangAksesDitolakError };
  }

  const result = await saveBarangWithDb(db, businessId, [shift.outletId], rawInput);
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
