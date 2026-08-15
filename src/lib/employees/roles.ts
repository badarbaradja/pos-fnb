/**
 * Konstanta murni, TANPA import lain -- dipakai lib/employees/manage.ts
 * (server) DAN employee-form-dialog.tsx (client). Dipisah dari manage.ts
 * supaya komponen client yang cuma butuh daftar role ini tidak ikut
 * menyeret rantai import server-only (hashPin -> lib/auth/pin.ts ->
 * lib/auth/supabase.ts -> next/headers) ke bundle browser.
 */
export const employeeRoleValues = [
  "owner",
  "manager",
  "cashier",
  "waiter",
  "kitchen",
  "warehouse",
  "accountant",
] as const;
