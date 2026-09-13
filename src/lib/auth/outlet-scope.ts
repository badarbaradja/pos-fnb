import { and, inArray, or, sql, type Column, type SQL } from "drizzle-orm";
import { userRoleEnum } from "@/lib/db/schema";

type UserRole = (typeof userRoleEnum.enumValues)[number];

/**
 * OutletScope — bentuk resmi `allowedOutletIds` di seluruh proyek ini.
 * `null` = TAK TERBATAS (semua outlet). Array (termasuk KOSONG) = daftar
 * spesifik; array kosong berarti TIDAK ADA outlet yang boleh dilihat sama
 * sekali, BUKAN "belum diatur" atau "sama seperti null". Nama tipe ini
 * dipakai di mana-mana (bukan `string[] | null` ditulis ulang tiap file)
 * justru supaya perbedaan ini tidak pernah harus dihafal ulang pemanggil.
 */
export type OutletScope = string[] | null;

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
export function computeAllowedOutletIds(role: UserRole, outletIds: string[] | null): OutletScope {
  if (UNRESTRICTED_OUTLET_ROLES.includes(role)) {
    return null;
  }
  return outletIds;
}

// ---------------------------------------------------------------------------
// Tahap 2 — utilitas filter + assert (13 September 2026, §22). MASIH BELUM
// dipasang ke halaman/Server Action mana pun (Tahap 3/4) -- cuma disediakan
// di sini, dites lewat query DB sungguhan.
// ---------------------------------------------------------------------------

/**
 * Bentuk INTERNAL, dipakai HANYA di file ini untuk memaksa exhaustiveness
 * checking TypeScript (switch tanpa `default`, lihat di bawah) -- setiap
 * fungsi publik di bawah WAJIB menangani ketiga kasus secara eksplisit,
 * tidak ada jalan "lupa satu kasus" lolos diam-diam kalau OutletScope
 * berubah bentuk suatu saat nanti. TIDAK diekspor -- pemanggil dari luar
 * file ini TIDAK PERNAH boleh menulis switch/if sendiri atas null vs
 * array vs array-kosong (itu justru sumber bug "null dibaca kosong" /
 * "kosong dibaca null" yang CEO minta dicegah) -- mereka WAJIB lewat
 * outletScopeCondition()/isOutletAllowed()/assertOutletAllowed() di bawah.
 */
type ResolvedOutletScope =
  | { kind: "unrestricted" }
  | { kind: "none" }
  | { kind: "specific"; outletIds: string[] };

function resolveOutletScope(scope: OutletScope): ResolvedOutletScope {
  if (scope === null) {
    return { kind: "unrestricted" };
  }
  if (scope.length === 0) {
    return { kind: "none" };
  }
  return { kind: "specific", outletIds: scope };
}

/**
 * outletScopeCondition() — kondisi SQL untuk kolom outlet TUNGGAL (mis.
 * `orders.outletId`, `shifts.outletId`, `devices.outletId`). SELALU
 * mengembalikan SQL yang valid untuk di-AND-kan TANPA SYARAT ke where()
 * lain -- pemanggil TIDAK PERNAH perlu (dan TIDAK PERNAH boleh) menulis
 * `allowedOutletIds ? condition : undefined` sendiri. Ini yang membuat
 * bentuknya sulit dipakai salah (permintaan CEO): tidak ada cabang
 * kondisional yang diserahkan ke pemanggil sama sekali.
 *
 * - unrestricted -> `sql\`true\`` (tidak menyaring apa pun, TIDAK PERNAH
 *   diterjemahkan jadi "tidak ada filter" yang mudah salah ketik jadi
 *   "filter kosong")
 * - none (array KOSONG) -> `sql\`false\`` -- TIDAK PERNAH match baris
 *   apa pun, walau tabelnya punya sejuta baris. Ini beda tegas dari
 *   unrestricted, keduanya tidak mungkin tertukar karena keduanya SQL
 *   konstan yang eksplisit, bukan "ada WHERE" vs "tidak ada WHERE".
 * - specific -> `inArray(column, outletIds)` seperti biasa.
 */
export function outletScopeCondition(scope: OutletScope, column: Column): SQL {
  const resolved = resolveOutletScope(scope);
  switch (resolved.kind) {
    case "unrestricted":
      return sql`true`;
    case "none":
      return sql`false`;
    case "specific":
      return inArray(column, resolved.outletIds);
  }
}

/**
 * outletScopeConditionForTransfer() — KHUSUS tabel yang punya DUA kolom
 * outlet (stock_transfers.from_outlet_id / to_outlet_id): baris dianggap
 * dalam cakupan kalau outlet ASAL **ATAU** outlet TUJUAN ada di
 * allowedOutletIds. SENGAJA fungsi terpisah dari outletScopeCondition()
 * di atas (bukan dipaksakan lewat satu kolom gabungan/COALESCE) -- gudang
 * pusat yang mengirim ke banyak outlet perlu tetap terlihat di sisi
 * "from" walau tidak ada di daftar "to" manapun, dan sebaliknya.
 */
export function outletScopeConditionForTransfer(
  scope: OutletScope,
  fromColumn: Column,
  toColumn: Column
): SQL {
  const resolved = resolveOutletScope(scope);
  switch (resolved.kind) {
    case "unrestricted":
      return sql`true`;
    case "none":
      return sql`false`;
    case "specific": {
      const condition = or(inArray(fromColumn, resolved.outletIds), inArray(toColumn, resolved.outletIds));
      // or() dua argumen non-undefined SELALU mengembalikan SQL -- tidak
      // pernah undefined secara runtime, and(condition) di bawah cuma
      // untuk meyakinkan TypeScript tanpa `!` (non-null assertion
      // dilarang gaya proyek ini, lihat konvensi lib/*/manage.ts lain).
      return and(condition) as SQL;
    }
  }
}

/**
 * isOutletAllowed() — pengecekan SATU outletId terhadap scope, dipakai
 * assertOutletAllowed() di bawah dan cocok untuk cabang if/else biasa
 * (bukan query DB) di Server Action, mis. mengecek outletId dari FormData
 * sebelum menulis. Tidak melempar -- untuk itu pakai assertOutletAllowed().
 */
export function isOutletAllowed(scope: OutletScope, outletId: string): boolean {
  const resolved = resolveOutletScope(scope);
  switch (resolved.kind) {
    case "unrestricted":
      return true;
    case "none":
      return false;
    case "specific":
      return resolved.outletIds.includes(outletId);
  }
}

/**
 * assertOutletAllowed() — jaring terakhir di jalur TULIS (Server Action/
 * *WithDb). SELALU MELEMPAR kalau ditolak, TIDAK PERNAH mengembalikan
 * boolean (keputusan CEO eksplisit -- jalur tulis tidak boleh punya cara
 * gagal diam-diam kalau pemanggil lupa mengecek nilai baliknya). `context`
 * disisipkan ke pesan error, pola sama `assertRowsAffected()` di
 * lib/db/errors.ts -- pesan ini untuk log/debug (jalur ini seharusnya
 * TIDAK PERNAH tercapai lewat UI yang benar, cuma jaring untuk percobaan
 * lewat luar UI: URL langsung, panggilan Server Action manual dengan
 * outletId lain).
 */
export function assertOutletAllowed(scope: OutletScope, outletId: string, context: string): void {
  if (!isOutletAllowed(scope, outletId)) {
    throw new Error(
      `Akses ditolak -- outlet ini di luar cakupan akses Anda (${context}).`
    );
  }
}
