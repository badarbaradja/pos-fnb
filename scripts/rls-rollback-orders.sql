-- ============================================================================
-- KILL-SWITCH: kembalikan policy RLS "orders" ke kondisi SEBELUM Tahap 5
-- (pembatasan akses per outlet, level database, 13 September 2026, §29).
-- ============================================================================
--
-- KAPAN DIPAKAI:
-- Kalau, SETELAH policy outlet-aware orders_select/orders_insert/orders_update
-- dipasang, ada pengguna sah yang tiba-tiba tidak bisa melihat/menulis order
-- yang seharusnya boleh dia akses (termasuk owner/akuntan yang mendadak
-- melihat nol baris -- gejala paling gawat, tanda auth_outlet_ids() atau
-- guard IS NULL gagal). File ini mengembalikan ketiga policy itu PERSIS ke
-- kondisi sebelum outlet ikut diperiksa -- cuma business_id, sama seperti
-- yang sudah terbukti aman bertahun-tahun sebelum Tahap 5.
--
-- CARA PAKAI:
-- 1. Buka Supabase Dashboard proyek ini -> SQL Editor.
-- 2. Tempel ISI FILE INI APA ADANYA, jalankan (Run).
-- 3. TIDAK BUTUH akses dashboard aplikasi, tidak butuh login sebagai owner,
--    tidak butuh service_role key ditulis di mana pun -- SQL Editor Supabase
--    sudah otomatis jalan dengan privilese yang bisa ALTER POLICY.
-- 4. Setelah dijalankan, orders kembali ke gerbang business-only (Tahap 0-4
--    era) -- SEMUA baris outlet kembali terlihat/tertulis untuk siapa pun
--    yang berwenang di bisnisnya (pemulihan darurat, BUKAN keadaan akhir
--    yang diinginkan) sampai akar masalah auth_outlet_ids()/policy baru
--    diperbaiki dan dipasang ulang.
-- 5. auth_outlet_ids() SENDIRI TIDAK dihapus oleh file ini -- fungsi itu
--    aman dibiarkan ada tidak terpakai (tidak direferensikan policy mana
--    pun lagi setelah rollback ini). Hapus terpisah kalau memang mau
--    bersih-bersih, tidak mendesak untuk pemulihan.
--
-- Diverifikasi jalan di database dev (13 September 2026) SEBELUM migrasi
-- outlet-aware yang baru dipasang -- lihat docs/RENCANA-...md §29 untuk
-- catatan verifikasi. JANGAN ubah teks di bawah tanpa menguji ulang.
-- ============================================================================

ALTER POLICY "orders_select" ON "orders"
  USING ("orders"."business_id" = any(auth_business_ids()));

ALTER POLICY "orders_insert" ON "orders"
  WITH CHECK ("orders"."business_id" = any(auth_business_ids()));

ALTER POLICY "orders_update" ON "orders"
  USING ("orders"."business_id" = any(auth_business_ids()))
  WITH CHECK ("orders"."business_id" = any(auth_business_ids()));
