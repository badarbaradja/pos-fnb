-- ============================================================================
-- KILL-SWITCH: kembalikan policy RLS "shifts" ke kondisi SEBELUM Tahap 5
-- (pembatasan akses per outlet, level database, 13 September 2026, §30).
-- ============================================================================
--
-- KAPAN DIPAKAI:
-- shifts adalah GERBANG IDENTITAS KASIR -- kalau policy outlet-aware di
-- bawah ternyata salah (mis. akun yang login di tablet POS punya
-- outlet_ids yang tidak mencakup outlet tablet itu sendiri), SEMUA kasir
-- di outlet itu tidak bisa buka/tutup shift SAMA SEKALI, bukan cuma satu
-- fitur/laporan yang kosong -- penjualan berhenti total di outlet itu.
-- Ini file paling mungkin dibutuhkan MENDESAK dari seluruh Tahap 5.
--
-- CARA PAKAI:
-- 1. Buka Supabase Dashboard proyek ini -> SQL Editor.
-- 2. Tempel ISI FILE INI APA ADANYA, jalankan (Run).
-- 3. TIDAK BUTUH akses dashboard aplikasi, tidak butuh login sebagai owner,
--    tidak butuh service_role key ditulis di mana pun -- SQL Editor
--    Supabase sudah otomatis jalan dengan privilese yang bisa ALTER POLICY.
-- 4. Setelah dijalankan, shifts DAN cash_movements (policy-nya EXISTS ke
--    shifts, ikut pulih otomatis TANPA disentuh terpisah) kembali ke
--    gerbang business-only (Tahap 0-4 era) -- SEMUA kasir kembali bisa
--    buka/tutup shift di outlet mana pun tempat mereka berwenang di
--    bisnisnya (pemulihan darurat, BUKAN keadaan akhir yang diinginkan)
--    sampai akar masalah (biasanya: outlet_ids akun yang login di
--    tablet) diperbaiki dan policy outlet-aware dipasang ulang.
-- 5. auth_outlet_ids() SENDIRI TIDAK dihapus/disentuh oleh file ini --
--    fungsi itu (dan penggunaannya di policy orders) tetap aman, cuma
--    tidak lagi dirujuk oleh ketiga policy shifts di bawah.
--
-- Diverifikasi jalan di database dev (13 September 2026) SEBELUM DAN
-- SESUDAH migrasi outlet-aware dipasang -- lihat docs/RENCANA-...md §30
-- untuk catatan verifikasi. JANGAN ubah teks di bawah tanpa menguji ulang.
-- ============================================================================

ALTER POLICY "shifts_select" ON "shifts"
  USING ("shifts"."business_id" = any(auth_business_ids()));

ALTER POLICY "shifts_insert" ON "shifts"
  WITH CHECK ("shifts"."business_id" = any(auth_business_ids()));

ALTER POLICY "shifts_update" ON "shifts"
  USING ("shifts"."business_id" = any(auth_business_ids()))
  WITH CHECK ("shifts"."business_id" = any(auth_business_ids()));
