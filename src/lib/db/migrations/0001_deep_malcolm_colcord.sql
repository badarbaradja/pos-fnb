ALTER TABLE "employees" ADD COLUMN "failed_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
-- T07: FORCE ROW LEVEL SECURITY di ketujuh tabel.
--
-- Tanpa ini, role "postgres" (pemilik semua tabel di sini, dipakai oleh
-- DATABASE_URL / src/lib/db/client.ts) MELEWATI RLS sepenuhnya secara
-- default -- Postgres tidak menerapkan RLS ke pemilik tabel kecuali FORCE
-- diaktifkan. Ini pertahanan berlapis: kalau suatu saat ada kode server
-- yang keliru memakai koneksi biasa untuk query milik user tertentu tanpa
-- memuat konteks auth.uid() yang benar, RLS tetap menahannya (auth_business_ids()
-- akan kosong tanpa auth.uid(), jadi query itu cuma melihat nol baris,
-- bukan bocor).
--
-- PENGECUALIAN yang tetap bisa bypass walau FORCE aktif: role dengan atribut
-- BYPASSRLS, yaitu "service_role" (dipakai Supabase lewat SUPABASE_SERVICE_ROLE_KEY
-- di PostgREST). FORCE ROW LEVEL SECURITY tidak memengaruhi role ber-BYPASSRLS --
-- itu properti role, bukan properti tabel. Untuk operasi sistem yang memang
-- SENGAJA butuh lintas-tenant (cron /api/cron/end-of-day, job sync), dua opsi:
--   1. Panggil lewat Supabase admin client (createClient(url, SUPABASE_SERVICE_ROLE_KEY))
--      yang otomatis jalan sebagai service_role via PostgREST, ATAU
--   2. Kalau harus lewat koneksi Drizzle/SQL langsung, jalankan `SET ROLE service_role`
--      di awal transaksi tersebut (role "postgres" adalah member service_role di Supabase),
--      lalu `RESET ROLE` setelah selesai. Jangan jadikan ini default di getDb() --
--      harus eksplisit per operasi yang benar-benar butuh.
ALTER TABLE "businesses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "outlets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "profiles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "employees" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "devices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "permissions_override" FORCE ROW LEVEL SECURITY;