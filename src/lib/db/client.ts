import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { createSupabaseClientWithToken } from "../auth/supabase";

type Db = ReturnType<typeof drizzle<typeof schema>>;

function getConnectionString(): string {
  const connectionString = process.env["DATABASE_URL"];
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL belum diset. Isi .env.local berdasarkan .env.example (Supabase: Settings > Database > Connection string, Session pooler)."
    );
  }
  return connectionString;
}

let cachedAdminDb: Db | null = null;

/**
 * getAdminDb() — koneksi DATABASE_URL, role "postgres".
 *
 * PERINGATAN: role "postgres" di Supabase punya atribut BYPASSRLS eksplisit
 * (dikonfirmasi lewat query pg_roles saat investigasi T07) — koneksi ini
 * MELEWATI RLS SEPENUHNYA, tidak peduli FORCE ROW LEVEL SECURITY aktif atau
 * tidak di tabelnya. Ini bukan bug yang bisa kita perbaiki: itu desain
 * Supabase (postgres perlu akses penuh untuk dashboard/migration mereka),
 * dan mencabut BYPASSRLS dari role ini berisiko merusak tooling mereka
 * sendiri — jangan dicoba.
 *
 * HANYA untuk operasi SISTEM, bukan pernah atas nama user:
 *   - migration (drizzle-kit) dan seed data
 *   - cron job (mis. /api/cron/end-of-day)
 *   - sync job lintas-tenant
 *   - verifikasi PIN kasir (lib/auth/pin.ts) — belum ada sesi Supabase Auth
 *     sama sekali di titik itu, jadi tidak ada token untuk getUserDb()
 *
 * TIDAK BOLEH dipakai untuk query atas nama user mana pun — pakai
 * getUserDb(accessToken) untuk itu, tanpa pengecualian. Lapisan UI
 * (src/app/) sama sekali tidak boleh mengimpor fungsi ini — ditegakkan
 * lewat test, lihat lib/db/__tests__/no-admin-db-in-app.test.ts.
 *
 * Setiap pemanggilan getAdminDb() di kode wajib disertai komentar satu
 * baris yang menjelaskan kenapa RLS perlu dilewati (CLAUDE.md §3.4).
 */
export function getAdminDb(): Db {
  if (cachedAdminDb) {
    return cachedAdminDb;
  }
  const queryClient = postgres(getConnectionString(), { prepare: false });
  cachedAdminDb = drizzle(queryClient, { schema });
  return cachedAdminDb;
}

export type UserDbHandle = {
  db: Db;
  close: () => Promise<void>;
};

/**
 * getUserDb(accessToken) — koneksi Postgres langsung (bukan lewat
 * PostgREST) yang membawa konteks user asli, supaya RLS BENAR-BENAR
 * berlaku: role sesi di-set ke "authenticated" dan request.jwt.claims
 * diisi user id yang SUDAH DIVERIFIKASI lewat supabase.auth.getUser()
 * (bukan cuma decode JWT mentah — token yang tidak diverifikasi bisa
 * dipalsukan).
 *
 * Koneksi ini DEDICATED per pemanggilan (max: 1, bukan pool bersama)
 * supaya SET ROLE / request.jwt.claims tidak pernah bocor ke user lain.
 * WAJIB ditutup lewat handle.close() setelah selesai (mis. di akhir
 * Server Action atau di afterEach/afterAll pada test) — jangan biarkan
 * koneksi menggantung.
 *
 * Ini jalur WAJIB untuk semua query atas nama user (CLAUDE.md §3.4).
 * RLS di sini adalah lapisan TERAKHIR, bukan satu-satunya — tetap filter
 * business_id secara eksplisit di setiap query, jangan mengandalkan RLS
 * saja untuk kebenaran hasil.
 */
export async function getUserDb(accessToken: string): Promise<UserDbHandle> {
  const supabase = createSupabaseClientWithToken(accessToken);
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new Error("getUserDb: access token tidak valid atau kedaluwarsa");
  }

  const queryClient = postgres(getConnectionString(), {
    prepare: false,
    max: 1,
  });

  const claims = JSON.stringify({ sub: data.user.id, role: "authenticated" });
  await queryClient`SET ROLE authenticated`;
  await queryClient`SELECT set_config('request.jwt.claims', ${claims}, false)`;

  const db = drizzle(queryClient, { schema });

  return {
    db,
    close: () => queryClient.end(),
  };
}
