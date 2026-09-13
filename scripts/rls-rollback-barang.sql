-- ============================================================================
-- KILL-SWITCH: kembalikan policy RLS "barang" ke kondisi SEBELUM Tahap 5
-- (pembatasan akses per outlet, level database, 13 September 2026, §31).
-- ============================================================================
--
-- KAPAN DIPAKAI:
-- Kalau, SETELAH policy outlet-aware barang_select/barang_insert/
-- barang_update dipasang, ada pengguna sah yang tidak bisa lagi melihat/
-- menambah barang yang seharusnya boleh dia akses -- TERMASUK "Ita super
-- kasir" (addBarangFromShiftWithDb, /pos/thrift): akun yang login di
-- tablet POS-nya dibatasi dan outlet_ids-nya tidak memuat outlet shift
-- itu sendiri, jadi menambah barang dari kasir langsung gagal untuk
-- SEMUA kasir yang PIN di tablet itu -- bukan cuma satu laporan kosong.
--
-- CATATAN KHUSUS barang (beda dari orders/shifts): saveBarangWithDb
-- (lib/barang/manage.ts) jalur CREATE-nya TIDAK membungkus error RLS
-- jadi pesan generik seperti shifts.ts -- kegagalan bisa muncul sebagai
-- galat Server Action yang tidak tertangani (disanitasi Next.js di
-- produksi, tapi bentuknya beda dari pesan form biasa). Kalau ini file
-- yang sedang dipakai untuk memulihkan keadaan, itu tanda tambahan
-- bahwa masalahnya kemungkinan besar outlet_ids akun tablet, bukan bug
-- baru di kode aplikasi.
--
-- CARA PAKAI:
-- 1. Buka Supabase Dashboard proyek ini -> SQL Editor.
-- 2. Tempel ISI FILE INI APA ADANYA, jalankan (Run).
-- 3. TIDAK BUTUH akses dashboard aplikasi, tidak butuh login sebagai owner,
--    tidak butuh service_role key ditulis di mana pun -- SQL Editor
--    Supabase sudah otomatis jalan dengan privilese yang bisa ALTER POLICY.
-- 4. Setelah dijalankan, barang kembali ke gerbang business-only (Tahap
--    0-4 era) -- SEMUA yang berwenang di bisnisnya bisa lihat/tambah/ubah
--    barang di outlet mana pun (pemulihan darurat, BUKAN keadaan akhir
--    yang diinginkan) sampai akar masalah (biasanya: outlet_ids akun
--    yang login di tablet) diperbaiki dan policy outlet-aware dipasang
--    ulang.
-- 5. auth_outlet_ids() SENDIRI TIDAK dihapus/disentuh oleh file ini.
--
-- Diverifikasi jalan di database dev (13 September 2026) SEBELUM DAN
-- SESUDAH migrasi outlet-aware dipasang -- lihat docs/RENCANA-...md §31
-- untuk catatan verifikasi. JANGAN ubah teks di bawah tanpa menguji ulang.
-- ============================================================================

ALTER POLICY "barang_select" ON "barang"
  USING ("barang"."business_id" = any(auth_business_ids()));

ALTER POLICY "barang_insert" ON "barang"
  WITH CHECK ("barang"."business_id" = any(auth_business_ids()));

ALTER POLICY "barang_update" ON "barang"
  USING ("barang"."business_id" = any(auth_business_ids()))
  WITH CHECK ("barang"."business_id" = any(auth_business_ids()));
