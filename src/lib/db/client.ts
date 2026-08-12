import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type Db = ReturnType<typeof drizzle<typeof schema>>;

let cached: Db | null = null;

/**
 * Client Drizzle singleton. Lazy — DATABASE_URL baru dibaca saat pertama
 * kali dipanggil, supaya file ini aman di-import di tempat yang tidak
 * selalu punya koneksi database (mis. test yang tidak menyentuh DB).
 */
export function getDb(): Db {
  if (cached) {
    return cached;
  }

  const connectionString = process.env["DATABASE_URL"];
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL belum diset. Isi .env berdasarkan .env.example (Supabase: Settings > Database > Connection string, Session pooler)."
    );
  }

  const queryClient = postgres(connectionString);
  cached = drizzle(queryClient, { schema });
  return cached;
}
