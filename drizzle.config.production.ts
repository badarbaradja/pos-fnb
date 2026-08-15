import type { Config } from "drizzle-kit";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { assertValidDatabaseUrl } from "./src/lib/db/validate-database-url";

/**
 * Config drizzle-kit KHUSUS produksi (T19) -- file terpisah dari
 * drizzle.config.ts (dev), bukan cuma env var berbeda, supaya tidak
 * mungkin salah pakai secara diam-diam.
 *
 * HANYA baca .env.production.local -- TIDAK ADA fallback ke .env.local/
 * .env (itu database dev). Kalau file produksi belum ada, GAGAL keras di
 * sini dengan pesan jelas, bukan diam-diam jalan pakai DATABASE_URL dev
 * yang kebetulan masih ada di environment.
 */

const PROD_ENV_PATH = resolve(process.cwd(), ".env.production.local");

if (!existsSync(PROD_ENV_PATH)) {
  throw new Error(
    "drizzle.config.production.ts: .env.production.local tidak ditemukan di root proyek.\n" +
      "Ini SENGAJA tidak fallback ke .env.local/.env (itu database dev) -- buat dulu " +
      ".env.production.local berisi DATABASE_URL project Supabase produksi sebelum " +
      "menjalankan db:migrate:prod."
  );
}

loadEnv({ path: PROD_ENV_PATH, quiet: true });

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  throw new Error(
    "drizzle.config.production.ts: DATABASE_URL kosong/tidak ada di .env.production.local."
  );
}

// Ditambahkan setelah insiden: password produksi mengandung "@"/"]" yang
// tidak di-encode membuat koneksi gagal dengan 28P01 (pesan menyesatkan,
// terlihat seperti password salah padahal penyebabnya parsing). Gagal di
// sini dulu, SEBELUM koneksi dibuka, dengan pesan yang menunjuk penyebabnya.
try {
  assertValidDatabaseUrl(databaseUrl);
} catch (err) {
  throw new Error(`drizzle.config.production.ts: ${(err as Error).message}`);
}

export default {
  schema: "./src/lib/db/schema.ts",
  out: "./src/lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
} satisfies Config;
