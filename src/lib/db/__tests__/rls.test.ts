/**
 * T06 — Test permanen: setiap tabel di schema `public` wajib Row Level
 * Security aktif. Satu tabel baru terlewat = data lintas klien bisa bocor
 * (BLUEPRINT §9.5). Test ini akan dipakai selamanya — jangan dihapus saat
 * tabel baru ditambahkan, biarkan ia menangkap yang lupa di-RLS.
 *
 * Butuh koneksi Postgres sungguhan (DATABASE_URL), beda dari test
 * lib/calc/lib/utils yang murni fungsi. Kalau .env belum diisi, seluruh
 * describe di bawah di-skip otomatis (bukan gagal) — isi DATABASE_URL di
 * .env (lihat .env.example) supaya test ini benar-benar jalan.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

try {
  process.loadEnvFile();
} catch {
  // .env belum ada — DATABASE_URL tetap kosong, describe di bawah di-skip.
}

const DATABASE_URL = process.env["DATABASE_URL"];

describe.skipIf(!DATABASE_URL)(
  "RLS — semua tabel di schema public wajib enable Row Level Security",
  () => {
    let sql: ReturnType<typeof postgres>;

    beforeAll(() => {
      sql = postgres(DATABASE_URL!);
    });

    afterAll(async () => {
      await sql.end();
    });

    it("tidak ada tabel tanpa rowsecurity aktif", async () => {
      const rows = await sql<{ tablename: string }[]>`
        select tablename
        from pg_tables
        where schemaname = 'public'
          and rowsecurity = false
      `;

      expect(rows.map((r) => r.tablename)).toEqual([]);
    });
  }
);
