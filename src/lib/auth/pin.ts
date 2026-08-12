import bcrypt from "bcryptjs";
import { createSupabaseAdminClient } from "./supabase";
import type { UserRole } from "./session";

/**
 * Login kasir via PIN 6 digit — TIDAK lewat Supabase Auth (pegawai tidak
 * wajib punya akun, BLUEPRINT §3.1). Karena tidak ada sesi/JWT di titik
 * ini, employees table (FORCE RLS aktif sejak T07) tidak bisa dibaca lewat
 * koneksi biasa — sengaja pakai createSupabaseAdminClient() (service_role),
 * ini justru contoh nyata "operasi sistem yang sengaja butuh bypass" yang
 * didokumentasikan di migration 0001.
 *
 * Kebijakan lockout: ruang PIN 6 digit cuma 1 juta kombinasi, hash saja
 * tidak cukup menahan brute force. 5 kali gagal berturut-turut -> kunci 15
 * menit. failedAttempts HANYA direset ke 0 setelah login BERHASIL (bukan
 * otomatis setelah lockout berakhir) -- supaya percobaan gagal berikutnya
 * setelah lockout berakhir langsung mengunci lagi, bukan dapat 5 jatah baru.
 */

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

export type CashierIdentity = {
  employeeId: string;
  businessId: string;
  outletId: string | null;
  fullName: string;
  role: UserRole;
};

type EmployeeRow = {
  id: string;
  business_id: string;
  outlet_id: string | null;
  full_name: string;
  role: UserRole;
  pin_hash: string | null;
  failed_attempts: number;
  locked_until: string | null;
};

const INVALID_MESSAGE = "Kode karyawan atau PIN salah";

export async function verifyCashierPin(params: {
  outletId: string;
  code: string;
  pin: string;
}): Promise<CashierIdentity> {
  const supabase = createSupabaseAdminClient();

  const { data: employee, error } = await supabase
    .from("employees")
    .select(
      "id, business_id, outlet_id, full_name, role, pin_hash, failed_attempts, locked_until"
    )
    .eq("outlet_id", params.outletId)
    .eq("code", params.code)
    .eq("is_active", true)
    .maybeSingle<EmployeeRow>();

  if (error) {
    throw error;
  }
  // Pesan generik kalau kode tidak ketemu -- jangan bocorkan kode karyawan
  // mana yang valid lewat pesan error yang berbeda.
  if (!employee) {
    throw new Error(INVALID_MESSAGE);
  }

  const now = new Date();
  if (employee.locked_until && new Date(employee.locked_until) > now) {
    const until = new Date(employee.locked_until).toLocaleTimeString("id-ID");
    throw new Error(
      `Akun terkunci karena terlalu banyak percobaan gagal. Coba lagi setelah ${until}.`
    );
  }

  if (!employee.pin_hash) {
    throw new Error("PIN belum diset untuk karyawan ini");
  }

  const isValid = await bcrypt.compare(params.pin, employee.pin_hash);

  if (!isValid) {
    const failedAttempts = employee.failed_attempts + 1;
    const shouldLock = failedAttempts >= MAX_FAILED_ATTEMPTS;

    await supabase
      .from("employees")
      .update({
        failed_attempts: failedAttempts,
        locked_until: shouldLock
          ? new Date(now.getTime() + LOCKOUT_MINUTES * 60_000).toISOString()
          : employee.locked_until,
      })
      .eq("id", employee.id);

    throw new Error(INVALID_MESSAGE);
  }

  await supabase
    .from("employees")
    .update({ failed_attempts: 0, locked_until: null })
    .eq("id", employee.id);

  return {
    employeeId: employee.id,
    businessId: employee.business_id,
    outletId: employee.outlet_id,
    fullName: employee.full_name,
    role: employee.role,
  };
}

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, 10);
}
