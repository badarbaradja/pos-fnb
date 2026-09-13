-- ============================================================================
-- KILL-SWITCH: kembalikan auth_business_ids() dan auth_outlet_ids() ke
-- definisi SEBELUM search_path dikeraskan (13 September 2026, §33).
-- ============================================================================
--
-- KAPAN DIPAKAI:
-- auth_business_ids() adalah DASAR SETIAP POLICY RLS di 30+ TABEL di
-- seluruh proyek ini (semua tabel bisnis, sejak migrasi 0000) --
-- auth_outlet_ids() dasar policy orders/shifts/barang (Tahap 5). Kalau
-- SETELAH `SET search_path` ditambahkan, ADA SAJA yang salah (typo di
-- ulang penulisan fungsi, search_path yang tidak mencakup skema yang
-- benar, dst) -- gejalanya BUKAN satu tabel, tapi SEMUA ORANG DI SEMUA
-- TABEL kehilangan akses (atau, lebih gawat, tanpa sadar mendapat akses
-- ke bisnis lain) SEKALIGUS. Ini file yang paling penting dari SELURUH
-- kill-switch yang pernah dibuat proyek ini -- blast radius-nya
-- terbesar.
--
-- CARA PAKAI:
-- 1. Buka Supabase Dashboard proyek ini -> SQL Editor.
-- 2. Tempel ISI FILE INI APA ADANYA, jalankan (Run).
-- 3. TIDAK BUTUH akses dashboard aplikasi, tidak butuh login sebagai owner,
--    tidak butuh service_role key ditulis di mana pun -- SQL Editor
--    Supabase sudah otomatis jalan dengan privilese yang bisa
--    CREATE OR REPLACE FUNCTION.
-- 4. Setelah dijalankan, kedua fungsi kembali PERSIS ke bentuk semula
--    (tanpa SET search_path) -- fungsional identik dengan sebelum §33,
--    cuma tanpa pengerasan search_path (pemulihan darurat, BUKAN
--    keadaan akhir yang diinginkan) sampai akar masalah pengerasan
--    yang baru diperbaiki dan dipasang ulang.
--
-- Teks di bawah disalin PERSIS dari `pg_get_functiondef()` terhadap
-- database dev SEBELUM §33 diterapkan (13 September 2026) -- bukan
-- ditulis ulang dari ingatan.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.auth_business_ids()
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER AS $$
      SELECT COALESCE(ARRAY_AGG(business_id), '{}')
      FROM memberships
      WHERE user_id = auth.uid() AND is_active = true
    $$;

CREATE OR REPLACE FUNCTION public.auth_outlet_ids(p_business_id uuid)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    CASE
      WHEN m.role IN ('owner', 'accountant') THEN NULL
      ELSE m.outlet_ids
    END
  FROM memberships m
  WHERE m.user_id = auth.uid()
    AND m.business_id = p_business_id
    AND m.is_active = true
  LIMIT 1
$$;
