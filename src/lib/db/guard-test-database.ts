const OVERRIDE_ENV_VAR = "ALLOW_TEST_DB_OVERRIDE";

/**
 * lib/db/guard-test-database.ts — pengaman database uji (12 September
 * 2026, atas temuan CEO). Test integrasi proyek ini menjalankan insert/
 * update/delete SUNGGUHAN lewat getAdminDb() (bypass RLS) terhadap
 * apa pun yang ditunjuk DATABASE_URL di .env.local -- tidak ada yang
 * pernah memverifikasi itu memang database dev, bukan produksi.
 *
 * GAGAL-TERTUTUP, bukan gagal-terbuka -- ref yang diizinkan ditulis
 * EKSPLISIT di sini sebagai konstanta, BUKAN dibaca dari
 * .env.production.local atau env var mana pun: sumber yang bisa
 * hilang (clone baru, file terhapus) membuat penjaga diam-diam tidak
 * berbuat apa-apa persis di saat paling dibutuhkan (koreksi CEO --
 * usulan pertama membaca ref dari file yang bisa tidak ada, DITOLAK).
 * IZINKAN HANYA yang dikenal di sini, TOLAK sisanya -- termasuk kalau
 * tidak bisa diurai sama sekali (tidak tahu = tolak).
 *
 * Bukan rahasia -- project ref Supabase muncul di URL publik
 * (https://<ref>.supabase.co) dan di NEXT_PUBLIC_SUPABASE_URL, yang
 * memang untuk dipublikasikan ke klien.
 */
const ALLOWED_TEST_PROJECT_REFS = ["txmkbklzhleavjhzrckm"];

/**
 * Ambil project ref Supabase dari DATABASE_URL, dua bentuk yang dikenal:
 * - Pooler (dipakai proyek ini): username "postgres.<ref>"
 * - Koneksi langsung: host "db.<ref>.supabase.co"
 * Bentuk lain -> null (TIDAK menebak), pemanggil yang memutuskan itu
 * berarti ditolak.
 */
export function extractSupabaseProjectRef(databaseUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return null;
  }

  const poolerMatch = /^postgres\.([a-z0-9]+)$/.exec(decodeURIComponent(parsed.username));
  if (poolerMatch) {
    return poolerMatch[1]!;
  }

  const directMatch = /^db\.([a-z0-9]+)\.supabase\.co$/.exec(parsed.hostname);
  if (directMatch) {
    return directMatch[1]!;
  }

  return null;
}

export type TestDatabaseCheckResult =
  | { allowed: true; warning?: string }
  | { allowed: false; message: string };

/**
 * Fungsi murni (testable tanpa menyentuh process.env) -- assertTestDatabaseIsAllowed
 * di bawah ini pembungkus tipis yang membaca env sungguhan dan melempar.
 */
export function checkTestDatabaseAllowed(
  databaseUrl: string | undefined,
  overrideFlag: string | undefined
): TestDatabaseCheckResult {
  if (overrideFlag === "1") {
    return {
      allowed: true,
      warning: `${OVERRIDE_ENV_VAR}=1 -- pengaman database uji DILEWATI SENGAJA. Pastikan ini benar-benar disengaja.`,
    };
  }

  if (!databaseUrl) {
    return {
      allowed: false,
      message:
        `Pengaman database uji: DATABASE_URL kosong/tidak diset -- tidak tahu = tolak. ` +
        `Kalau ini disengaja, set ${OVERRIDE_ENV_VAR}=1 secara eksplisit sebelum menjalankan test.`,
    };
  }

  const ref = extractSupabaseProjectRef(databaseUrl);
  if (!ref) {
    return {
      allowed: false,
      message:
        `Pengaman database uji: tidak bisa mengurai project ref Supabase dari DATABASE_URL ` +
        `(bentuk tidak dikenal -- bukan pooler "postgres.<ref>@..." atau langsung "...db.<ref>.supabase.co"). ` +
        `Tidak tahu = tolak. Kalau ini disengaja, set ${OVERRIDE_ENV_VAR}=1 secara eksplisit.`,
    };
  }

  if (!ALLOWED_TEST_PROJECT_REFS.includes(ref)) {
    return {
      allowed: false,
      message:
        `Pengaman database uji: DATABASE_URL mengarah ke project ref "${ref}", ` +
        `padahal HANYA ref berikut yang diizinkan untuk test integrasi: ` +
        `${ALLOWED_TEST_PROJECT_REFS.join(", ")}. Test integrasi menjalankan insert/update/` +
        `delete SUNGGUHAN -- kalau ref ini memang benar dan perlu ditambahkan, perbarui ` +
        `ALLOWED_TEST_PROJECT_REFS di lib/db/guard-test-database.ts. Kalau ini cuma sekali ` +
        `dan disengaja, set ${OVERRIDE_ENV_VAR}=1 secara eksplisit.`,
    };
  }

  return { allowed: true };
}

/**
 * Dipanggil SEKALI di vitest.setup.ts, sebelum test file mana pun sempat
 * membuka koneksi lewat getAdminDb(). SENGAJA TIDAK dipasang di
 * getAdminDb() sendiri -- fungsi itu juga jalur skrip yang SAH menyentuh
 * produksi (scripts/bootstrap-production.ts, drizzle.config.production.ts
 * pakai config terpisah, tapi getAdminDb() run-time dipanggil scripts/demo:*
 * juga), penjaga di sana akan mematahkan skrip yang justru harus bisa
 * menyentuh produksi.
 *
 * PENYIMPANGAN YANG DISENGAJA dari checkTestDatabaseAllowed murni (yang
 * menolak DATABASE_URL kosong): kalau DATABASE_URL SAMA SEKALI TIDAK ADA
 * (bukan ada-tapi-salah), TIDAK ADA test integrasi yang akan jalan --
 * SETIAP file test digerbang describe.skipIf(!hasEnv) yang mensyaratkan
 * DATABASE_URL persis sama. Jadi tidak ada koneksi yang akan dibuka sama
 * sekali, tidak ada risiko untuk dipagari -- melempar di sini cuma akan
 * mematahkan `npm test` untuk siapa pun yang sengaja menjalankan test unit
 * saja tanpa kredensial Supabase (pola yang sudah ada di proyek ini jauh
 * sebelum pengaman ini dibangun). "Tidak tahu = tolak" berlaku untuk
 * DATABASE_URL yang ADA tapi salah/tidak dikenal -- BUKAN untuk yang
 * memang sengaja tidak diisi. Ditulis eksplisit di sini supaya CEO bisa
 * mengoreksi kalau penafsiran ini salah.
 */
export function assertTestDatabaseIsAllowed(
  databaseUrl: string | undefined = process.env["DATABASE_URL"],
  overrideFlag: string | undefined = process.env[OVERRIDE_ENV_VAR]
): void {
  if (!databaseUrl) {
    return;
  }

  const result = checkTestDatabaseAllowed(databaseUrl, overrideFlag);
  if (!result.allowed) {
    throw new Error(result.message);
  }
  if (result.warning) {
    console.warn(`[guard-test-database] ${result.warning}`);
  }
}
