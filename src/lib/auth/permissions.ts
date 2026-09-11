import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserRole } from "./session";
import { getCurrentBusinessFromClient, getSessionFromClient } from "./session";
import { getUserDb, type UserDbHandle } from "../db/client";

/**
 * Matriks RBAC — BLUEPRINT §7. Konstanta ini SUMBER KEBENARAN untuk default
 * per role. Override per karyawan ada di tabel permissions_override (belum
 * dipakai di requirePermission() — lihat catatan di bawah).
 *
 * "unavailable" ('na') = tidak tersedia untuk role itu SAMA SEKALI, tidak
 * bisa diaktifkan lewat override (beda dari 'off', yang defaultnya nonaktif
 * tapi BISA diaktifkan per karyawan). Ini mengikuti legend BLUEPRINT §7:
 * "✓ = default aktif, ⚠ = default nonaktif bisa diaktifkan per karyawan,
 * — = tidak tersedia" — hanya ⚠ yang eksplisit disebut bisa di-override.
 */

export type PermissionKey =
  | "pos.create_order"
  | "pos.void_item_before_send"
  | "pos.void_after_send"
  | "pos.discount_manual"
  | "pos.open_price"
  | "pos.refund"
  | "pos.reprint_receipt"
  | "pos.open_drawer_no_sale"
  | "shift.open_close"
  | "shift.view_expected_cash"
  | "shift.reconcile"
  | "product.manage"
  | "price.manage"
  | "recipe.view_hpp"
  | "stock.purchase"
  | "stock.opname_input"
  | "stock.opname_approve"
  | "stock.waste"
  | "stock.transfer"
  | "stock.transfer_approve"
  | "kds.view"
  | "outlet.manage"
  | "employee.manage"
  | "payroll.view"
  | "payroll.process"
  | "expense.create"
  | "expense.approve"
  | "report.sales"
  | "report.profit_loss"
  | "settings.business"
  | "settings.tax"
  | "barang.manage"
  | "pemilik.manage";

type PermissionState = "on" | "off" | "na";

type RoleStates = Record<UserRole, PermissionState>;

function row(
  owner: PermissionState,
  manager: PermissionState,
  cashier: PermissionState,
  waiter: PermissionState,
  kitchen: PermissionState,
  warehouse: PermissionState,
  accountant: PermissionState
): RoleStates {
  return {
    owner,
    manager,
    cashier,
    waiter,
    kitchen,
    warehouse,
    accountant,
  };
}

// Urutan kolom persis tabel BLUEPRINT §7: Owner, Manajer, Kasir, Waiter, Dapur, Gudang, Akuntan
export const PERMISSIONS: Record<PermissionKey, RoleStates> = {
  "pos.create_order": row("on", "on", "on", "on", "na", "na", "na"),
  "pos.void_item_before_send": row("on", "on", "on", "on", "na", "na", "na"),
  "pos.void_after_send": row("on", "on", "off", "na", "na", "na", "na"),
  "pos.discount_manual": row("on", "on", "off", "na", "na", "na", "na"),
  "pos.open_price": row("on", "on", "off", "na", "na", "na", "na"),
  "pos.refund": row("on", "on", "off", "na", "na", "na", "na"),
  "pos.reprint_receipt": row("on", "on", "on", "na", "na", "na", "na"),
  "pos.open_drawer_no_sale": row("on", "on", "off", "na", "na", "na", "na"),
  "shift.open_close": row("on", "on", "on", "na", "na", "na", "na"),
  "shift.view_expected_cash": row("on", "on", "na", "na", "na", "na", "on"),
  "shift.reconcile": row("on", "on", "na", "na", "na", "na", "on"),
  "product.manage": row("on", "on", "na", "na", "na", "na", "na"),
  "price.manage": row("on", "off", "na", "na", "na", "na", "na"),
  "recipe.view_hpp": row("on", "on", "na", "na", "na", "off", "on"),
  "stock.purchase": row("on", "on", "na", "na", "na", "on", "na"),
  "stock.opname_input": row("on", "on", "on", "na", "na", "on", "na"),
  "stock.opname_approve": row("on", "on", "na", "na", "na", "na", "na"),
  "stock.waste": row("on", "on", "on", "na", "on", "on", "na"),
  "stock.transfer": row("on", "on", "na", "na", "na", "on", "na"),
  // T22, key baru -- BELUM ada di tabel BLUEPRINT §7 (alur dua sisi
  // belum ada saat tabel itu ditulis). Approve MURNI keputusan ya/tidak
  // (tidak menetapkan angka apa pun, itu terkunci di tahap send oleh
  // stock.transfer) -- warehouse SENGAJA 'na' (bukan 'off'), sama pola
  // stock.opname_approve: yang input (stock.transfer, warehouse=on)
  // TIDAK PERNAH boleh jadi yang menyetujui permintaannya sendiri, bahkan
  // lewat override per karyawan.
  "stock.transfer_approve": row("on", "on", "na", "na", "na", "na", "na"),
  "kds.view": row("on", "on", "on", "on", "on", "na", "na"),
  // T22b, key baru -- BELUM ada di tabel BLUEPRINT §7 (halaman kelola outlet
  // belum ada saat tabel itu ditulis). Mengatur lihat+UBAH outlet yang sudah
  // ada (owner & manajer). MEMBUAT outlet baru sengaja digerbang TERPISAH
  // oleh "settings.business" (owner-only, baris di bawah, TIDAK diubah) --
  // outlet baru punya konsekuensi biaya/struktur, keputusan pemilik, bukan
  // operasional harian seperti mengubah jam cutoff outlet yang sudah ada.
  "outlet.manage": row("on", "on", "na", "na", "na", "na", "na"),
  "employee.manage": row("on", "off", "na", "na", "na", "na", "na"),
  "payroll.view": row("on", "off", "na", "na", "na", "na", "on"),
  "payroll.process": row("on", "na", "na", "na", "na", "na", "on"),
  "expense.create": row("on", "on", "off", "na", "na", "on", "on"),
  "expense.approve": row("on", "on", "na", "na", "na", "na", "na"),
  "report.sales": row("on", "on", "off", "na", "na", "na", "on"),
  "report.profit_loss": row("on", "off", "na", "na", "na", "na", "on"),
  "settings.business": row("on", "na", "na", "na", "na", "na", "na"),
  "settings.tax": row("on", "na", "na", "na", "na", "na", "on"),
  // Thrifting (TT01, 10 September 2026) -- BELUM ada di BLUEPRINT §7 (dibuat
  // sebelum thrifting ada). Ita didaftarkan role=manager (dikonfirmasi
  // pemilik proyek -- mengurus barang masuk, harga, pemilik titipan, dan
  // laporan bagi hasil, pekerjaan manajerial, bukan kasir dengan
  // kelonggaran). `na` untuk cashier -- SENGAJA, bukan `off` -- supaya TIDAK
  // ADA jalan bagi kredensial kasir mana pun, termasuk akun tamu bersama
  // (TT09b), mendapat izin ini lewat permissions_override apa pun. Pola
  // sama persis "product.manage".
  "barang.manage": row("on", "on", "na", "na", "na", "na", "na"),
  // Pola sama "employee.manage" -- menambah/mengubah mitra titipan (dan
  // persentase bagi hasilnya) lebih dekat ke keputusan bisnis daripada
  // pekerjaan operasional harian.
  "pemilik.manage": row("on", "off", "na", "na", "na", "na", "na"),
};

/**
 * hasPermission() — cek default per role dari matriks. `overrideAllowed`
 * datang dari permissions_override per karyawan (undefined = tidak ada
 * override, pakai default). 'na' tidak pernah bisa di-override.
 */
export function hasPermission(
  role: UserRole,
  key: PermissionKey,
  overrideAllowed?: boolean
): boolean {
  const state = PERMISSIONS[key][role];
  if (state === "na") {
    return false;
  }
  if (overrideAllowed !== undefined) {
    return overrideAllowed;
  }
  return state === "on";
}

export type PermissionContext = {
  userId: string;
  businessId: string;
  role: UserRole;
};

/**
 * requirePermission() — dipakai di awal Server Action. Melempar Error kalau
 * tidak ada sesi, tidak ada membership aktif, atau role tidak punya izin.
 *
 * CAKUPAN T07: hanya cek default per ROLE (membership.role), belum
 * memeriksa permissions_override per EMPLOYEE. Override per karyawan butuh
 * konsep "employee yang sedang aktif di device ini" (dari sesi PIN kasir,
 * lib/auth/pin.ts) yang belum diikat ke satu mekanisme sesi — menyusul di
 * task yang membangun alur shift/kasir (T12+). Untuk owner/manajer (yang
 * login via Supabase Auth, bukan PIN), keputusan berbasis role saja ini
 * sudah benar karena mereka tidak akan pernah dibatasi oleh
 * permissions_override (kolom itu FK ke employees, bukan ke profiles/user
 * biasa).
 */
export async function requirePermission(
  supabase: SupabaseClient,
  key: PermissionKey
): Promise<PermissionContext> {
  const session = await getSessionFromClient(supabase);
  if (!session) {
    throw new Error("Unauthorized: tidak ada sesi login");
  }

  const business = await getCurrentBusinessFromClient(supabase, session.userId);
  if (!business) {
    throw new Error("Unauthorized: tidak ada membership aktif");
  }

  if (!hasPermission(business.role, key)) {
    throw new Error(
      `Forbidden: role "${business.role}" tidak punya izin "${key}"`
    );
  }

  return { userId: session.userId, businessId: business.businessId, role: business.role };
}

/**
 * requirePermissionDb() — requirePermission() + getUserDb() digabung,
 * karena hampir semua Server Action mutasi (CRUD dashboard) butuh keduanya
 * berurutan: validasi izin, lalu koneksi Drizzle yang RLS-nya benar-benar
 * berlaku (CLAUDE.md §3.4). Pemanggil WAJIB memanggil closeDb() di akhir
 * (idealnya try/finally) — lihat catatan UserDbHandle di lib/db/client.ts
 * soal kenapa koneksi ini tidak di-cache.
 */
export async function requirePermissionDb(
  supabase: SupabaseClient,
  key: PermissionKey
): Promise<PermissionContext & { db: UserDbHandle["db"]; closeDb: UserDbHandle["close"] }> {
  const context = await requirePermission(supabase, key);

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) {
    throw new Error("Unauthorized: access token tidak ditemukan di sesi");
  }

  const { db, close } = await getUserDb(accessToken);
  return { ...context, db, closeDb: close };
}
