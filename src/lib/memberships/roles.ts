/**
 * Konstanta murni, TANPA import lain -- pola sama lib/employees/roles.ts.
 * Dipakai lib/memberships/manage.ts (server) DAN team-form-dialog.tsx
 * (client), supaya komponen client tidak ikut menyeret rantai import
 * server-only (createSupabaseAdminClient -> next/headers dst).
 *
 * SENGAJA TIDAK termasuk "owner"/"accountant" -- keputusan CEO (13
 * September 2026, pembatasan akses per outlet): halaman kelola tim tidak
 * boleh bisa memberi peran ini ke siapa pun, pola sama larangan admin
 * mengangkat dirinya sendiri di sistem laporan Koperumnas. Baris owner/
 * accountant yang SUDAH ADA (dibuat lewat scripts/bootstrap-production.ts)
 * tetap tampil di daftar, tapi tidak bisa diubah lewat halaman ini --
 * lihat cannotManageOwnerAccountant di lib/memberships/manage.ts.
 */
export const assignableMembershipRoles = [
  "manager",
  "cashier",
  "waiter",
  "kitchen",
  "warehouse",
] as const;
