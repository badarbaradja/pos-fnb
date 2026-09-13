import { userRoleEnum } from "@/lib/db/schema";

type UserRole = (typeof userRoleEnum.enumValues)[number];

/**
 * lib/auth/outlet-scope.ts — pembatasan akses per outlet, Tahap 1 (13
 * September 2026, docs/RENCANA-PEMBANGUNAN-KASIR-THRIFTING.md §21).
 *
 * MURNI ADITIF: file ini menghitung `allowedOutletIds`, TIDAK ADA halaman
 * atau Server Action mana pun yang memakainya untuk menyaring apa pun
 * (menyusul Tahap 3/4). computeAllowedOutletIds() sengaja dipisah dari
 * lib/auth/session.ts (yang memanggilnya) supaya bisa diuji langsung
 * tanpa Supabase/DB sama sekali -- fungsi murni, tidak ada I/O.
 *
 * KEPUTUSAN CEO (13 September 2026): owner dan akuntan TIDAK PERNAH
 * dipersempit, dipaksa di KODE (bukan cuma dengan membiarkan outlet_ids
 * mereka NULL di data) -- pertahanan berlapis, supaya sekali halaman
 * kelola membership (Tahap 0, /team) ada dan seseorang tidak sengaja
 * mengisi outlet_ids untuk akun owner/akuntan, laporan lintas outlet
 * mereka TIDAK diam-diam menyusut. Daftar peran ini HARUS disinkronkan
 * kalau nanti auth_outlet_ids() (Tahap 5, RLS) dibangun -- keduanya wajib
 * mengembalikan NULL untuk peran yang sama, kalau tidak laporan owner
 * bisa benar di app layer tapi salah di database (atau sebaliknya).
 */
export const UNRESTRICTED_OUTLET_ROLES: readonly UserRole[] = ["owner", "accountant"];

/**
 * outlet_ids mentah dari kolom `memberships.outlet_ids` -> outlet mana
 * yang boleh dilihat role ini. `null` di kedua sisi (input maupun output)
 * berarti "semua outlet", array berarti daftar spesifik. Untuk
 * UNRESTRICTED_OUTLET_ROLES, hasilnya SELALU `null` apa pun isi
 * outlet_ids di database -- lihat catatan file di atas.
 */
export function computeAllowedOutletIds(
  role: UserRole,
  outletIds: string[] | null
): string[] | null {
  if (UNRESTRICTED_OUTLET_ROLES.includes(role)) {
    return null;
  }
  return outletIds;
}
