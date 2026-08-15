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
