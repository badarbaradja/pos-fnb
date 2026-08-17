/**
 * Helper generik untuk mengenali kelas error Postgres tertentu -- BUKAN
 * aturan bisnis (CLAUDE.md §3.5 pengecualian arithmetic generik berlaku
 * sama untuk helper infrastruktur seperti ini), jadi boleh tinggal di
 * lib/db/ dan dipakai lintas modul.
 *
 * Drizzle (postgres-js driver) membungkus PostgresError asli sebagai
 * `.cause` pada error yang dilempar -- pesan luarnya "Failed query: ...",
 * `err.code` di level atas TIDAK terisi. Cek keduanya supaya tidak
 * bergantung versi/pembungkusan (ditemukan T15b saat test
 * `lib/employees/manage.ts` gagal walau constraint-nya benar dilanggar).
 */
function hasCode(value: unknown, code: string): boolean {
  return Boolean(
    value && typeof value === "object" && "code" in value && value.code === code
  );
}

export function isUniqueViolation(err: unknown): boolean {
  if (hasCode(err, "23505")) return true;
  const cause = err && typeof err === "object" ? (err as { cause?: unknown }).cause : undefined;
  return hasCode(cause, "23505");
}

/**
 * Dilempar di DALAM db.transaction() untuk membatalkan hapus permanen kalau
 * baris masih direferensikan (audit kelengkapan master data). Melempar
 * error di dalam transaction callback Drizzle otomatis rollback lalu
 * re-throw error yang sama ke pemanggil -- pesan .message sudah final,
 * siap ditampilkan ke user (mis. "Kategori ini dipakai oleh 5 produk"),
 * bukan pesan Postgres mentah.
 */
export class DeleteBlockedError extends Error {}

/**
 * Ditemukan lewat verifikasi UI manual /ingredients (bukan lewat test --
 * seluruh test safe-delete sebelumnya lewat getAdminDb(), yang BYPASSRLS,
 * jadi tidak pernah membuktikan policy DELETE di jalur produksi asli):
 * `ingredients` sempat tidak punya RLS policy DELETE sama sekali.
 * deleteIngredientWithDb() TIDAK melempar error apa pun -- DELETE lewat
 * getUserDb() cuma diam-diam mempengaruhi 0 baris (perilaku standar RLS:
 * baris yang tidak lolos USING clause policy DELETE bukan error, cuma
 * tidak ikut ter-delete), dan fungsi tetap melaporkan `{success: {...}}`.
 *
 * assertRowsAffected() menutup SELURUH kelas bug ini, bukan cuma kasus
 * ingredients: setiap `tx.delete(...)` di lib/*\/manage.ts WAJIB pakai
 * `.returning({ id: table.id })` lalu dicek lewat helper ini. Baris nol
 * berarti ada yang salah secara struktural (policy RLS hilang, WHERE
 * salah target, dst) -- itu BUKAN kasus bisnis "masih dipakai" yang
 * pantas dapat DeleteBlockedError dengan pesan ramah, jadi sengaja
 * melempar Error biasa yang menembus ke error boundary/log, bukan
 * ditangkap jadi toast halus. Penghapusan yang gagal diam-diam lebih
 * berbahaya daripada permintaan yang terlihat jelas gagal.
 */
export function assertRowsAffected(deletedRows: unknown[], context: string): void {
  if (deletedRows.length === 0) {
    throw new Error(
      `Penghapusan ${context} tidak mempengaruhi baris apa pun -- kemungkinan policy RLS DELETE hilang atau target salah. Ini bug internal, seharusnya tidak pernah terjadi kalau data yang dicek sebelumnya benar.`
    );
  }
}
