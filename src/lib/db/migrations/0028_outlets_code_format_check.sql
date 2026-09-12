-- Kode outlet dicetak jadi awalan barcode barang titipan (lib/barang/kode.ts:
-- `${outletCode}-${suffix}`), langsung di-encode Code128 tanpa transformasi
-- apa pun -- ditemukan sebagai kerapuhan (bukan penyebab) saat investigasi
-- bug barcode salah baca, 12 September 2026. Validasi lama (trim().min(1))
-- membiarkan huruf kecil/spasi/tanda baca lolos.

-- Langkah 1: normalisasi otomatis yang AMAN (uppercase) untuk baris lama --
-- tidak mengubah identitas kode, cuma huruf besar/kecilnya. Tidak memutus
-- barang.kode yang sudah tercetak (kode itu sudah tersimpan literal per
-- baris, tidak dihitung ulang dari outlets.code saat ini).
UPDATE "outlets" SET "code" = UPPER("code") WHERE "code" <> UPPER("code");

-- Langkah 2: kalau MASIH ada baris yang tidak sesuai pola A-Z0-9 setelah
-- uppercase (mis. ada spasi atau tanda baca), migrasi ini BERHENTI dengan
-- pesan jelas -- mengubah/membuang karakter tanpa izin adalah keputusan
-- bisnis (nama tampilan berubah, barcode outlet itu berubah), bukan sesuatu
-- yang boleh diputuskan skrip diam-diam. Admin harus mengubahnya manual
-- lewat halaman Outlet lalu menjalankan migrasi ini lagi.
DO $$
DECLARE
  bad_codes text;
BEGIN
  SELECT string_agg(format('%s (id=%s)', code, id), ', ')
  INTO bad_codes
  FROM "outlets"
  WHERE "code" !~ '^[A-Z0-9]+$';

  IF bad_codes IS NOT NULL THEN
    RAISE EXCEPTION 'Migrasi 0028 berhenti: kode outlet berikut tidak sesuai pola A-Z0-9 walau sudah di-uppercase, perlu diperbaiki manual dulu lewat halaman Outlet: %', bad_codes;
  END IF;
END $$;

ALTER TABLE "outlets" ADD CONSTRAINT "outlets_code_format" CHECK ("outlets"."code" ~ '^[A-Z0-9]+$');
