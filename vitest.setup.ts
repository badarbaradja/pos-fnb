import dns from "node:dns";
import { config as loadEnv } from "dotenv";
import { assertTestDatabaseIsAllowed } from "./src/lib/db/guard-test-database";

/**
 * "TypeError: fetch failed" muncul sporadis di test yang memanggil Supabase
 * HTTP API (auth.admin.createUser, storage, dst.) -- BUKAN di query Postgres
 * langsung (getAdminDb/getUserDb tidak lewat fetch sama sekali). Ini gejala
 * klasik Node lebih memilih hasil resolusi IPv6 dulu (Happy Eyeballs), dan
 * kalau jalur IPv6 di jaringan/mesin ini lambat atau macet, percobaan
 * pertama gagal/timeout sebelum sempat fallback ke IPv4 -- lihat isu Node
 * yang sama di banyak proyek Next.js/Supabase di Windows. Paksa IPv4 dulu
 * supaya resolusi DNS tidak pernah menunggu IPv6 yang bermasalah.
 */
dns.setDefaultResultOrder("ipv4first");

/**
 * Pengaman database uji (12 September 2026) -- dimuat di sini, BUKAN di
 * getAdminDb() sendiri, supaya jalan SATU KALI sebelum test file mana pun
 * sempat mengimpor lib/db/client.ts dan membuka koneksi. getAdminDb() juga
 * jalur skrip yang SAH menyentuh produksi (scripts/bootstrap-production.ts,
 * scripts/demo:*) -- penjaga di sana akan mematahkan skrip itu.
 *
 * loadEnv dulu di sini (bukan cuma andalkan tiap file test memuatnya
 * sendiri) -- setupFiles jalan SEBELUM file test mana pun diimpor, jadi
 * tanpa ini process.env.DATABASE_URL masih kosong saat pengaman dicek.
 * dotenv.config() tidak menimpa variabel yang sudah ada, jadi aman dipanggil
 * lagi oleh tiap file test sesudah ini.
 */
loadEnv({ path: [".env.local", ".env"], quiet: true });
assertTestDatabaseIsAllowed();
