# 04 — Catatan Teknis

> Keputusan arsitektur yang sudah diambil, dan alasannya. Ditulis supaya
> tidak hilang bersama riwayat chat. Kalau ada keputusan di sini yang mau
> diubah, ubah dulu dokumennya, baru kodenya — jangan sebaliknya.

---

## 1. `getAdminDb()` vs `getUserDb()` — dua jalur akses database (T07)

`src/lib/db/client.ts` sengaja **tidak** punya fungsi generik `getDb()`. Ada
dua fungsi dengan nama yang menyatakan niatnya secara eksplisit:

- **`getAdminDb()`** — koneksi `DATABASE_URL`, role `postgres`. Role ini
  punya atribut `BYPASSRLS` di Supabase (lihat bagian 2), jadi koneksi ini
  **melewati RLS sepenuhnya**. Hanya untuk operasi sistem: migration, cron,
  sync, verifikasi PIN kasir (`lib/auth/pin.ts` — belum ada sesi Supabase
  Auth di titik itu, jadi tidak ada token untuk `getUserDb()`), seed data.
- **`getUserDb(accessToken)`** — koneksi Postgres langsung (bukan lewat
  PostgREST) yang membawa konteks user asli, supaya RLS **benar-benar**
  berlaku. Ini jalur wajib untuk semua query Drizzle atas nama user.

**Kenapa dipisah, bukan satu fungsi dengan parameter opsional:** nama yang
ambigu adalah undangan untuk salah pakai. Kalau cuma ada `getDb(token?)`,
lupa mengisi `token` akan diam-diam jatuh ke mode admin — persis jenis bug
yang RLS seharusnya mencegah. Dengan dua nama terpisah, pemanggil harus
secara sadar memilih, dan review kode jadi lebih mudah: `getAdminDb()` di
file mana pun langsung mencolok sebagai sesuatu yang perlu diperiksa
alasannya.

**Bagaimana `getUserDb()` menegakkan RLS:** query lewat Drizzle/`postgres.js`
terhubung LANGSUNG ke Postgres, bukan lewat PostgREST (REST API Supabase)
seperti klien `@supabase/supabase-js`. PostgREST otomatis menyuntikkan
konteks JWT user (`auth.uid()`, role `authenticated`) ke setiap koneksi yang
dibukanya — tapi koneksi Postgres langsung tidak dapat ini secara otomatis.
`getUserDb(accessToken)` meniru apa yang dilakukan PostgREST:

1. Verifikasi `accessToken` lewat `supabase.auth.getUser()` — **bukan**
   sekadar decode JWT mentah. Token yang tidak diverifikasi ke server bisa
   dipalsukan (siapa pun bisa menulis payload JWT yang mengklaim jadi user
   manapun kalau signature-nya tidak dicek).
2. Buka koneksi Postgres BARU yang *dedicated* (`max: 1`, bukan pool
   bersama) — supaya `SET ROLE` di bawah tidak pernah bocor ke user lain
   yang kebetulan berbagi koneksi dari pool.
3. `SET ROLE authenticated` lalu
   `SELECT set_config('request.jwt.claims', '{"sub":"<user-id>", ...}', false)`
   — dua pengaturan sesi yang sama persis dibaca oleh `auth.uid()` dan
   fungsi `auth_business_ids()` (BLUEPRINT §9.5) saat RLS policy dievaluasi.

Setelah ini, `SELECT` lewat koneksi tersebut tunduk ke RLS persis seperti
kalau query yang sama dijalankan lewat PostgREST. Dibuktikan di
`src/lib/auth/__tests__/tenant-isolation.test.ts`.

**Konsekuensi performa yang disadari:** `getUserDb()` membuka koneksi baru
setiap dipanggil (tidak di-cache seperti `getAdminDb()`), karena konteks
`SET ROLE`/JWT claims spesifik per user tidak aman dibagi lewat connection
pool. Ini trade-off yang sengaja diambil demi kebenaran RLS, bukan oversight
— kalau nanti terbukti jadi bottleneck (banyak request bersamaan), pertimbangkan
pooling per-user atau kembali ke jalur `@supabase/supabase-js` (PostgREST)
untuk baca-baca yang tidak butuh query builder Drizzle.

---

## 2. Kenapa `BYPASSRLS` pada role `postgres` tidak dicabut

Saat investigasi T07 ditemukan: role `postgres` (dipakai `DATABASE_URL`)
punya atribut `rolbypassrls = true` secara eksplisit di `pg_roles` —
bukan sekadar bypass karena kepemilikan tabel (yang bisa ditutup dengan
`FORCE ROW LEVEL SECURITY`). Atribut `BYPASSRLS` melewati RLS **tanpa
syarat**, `FORCE` atau tidak.

Secara teknis, atribut ini bisa dicabut (`ALTER ROLE postgres NOBYPASSRLS`)
kalau koneksi kita punya privilege untuk itu. **Sengaja tidak dilakukan**
karena:

- Ini desain resmi Supabase, bukan kesalahan konfigurasi. Role `postgres`
  perlu akses penuh untuk dashboard, migration tooling, dan fitur admin
  mereka sendiri.
- Mencabutnya berisiko merusak tooling Supabase yang bergantung pada akses
  penuh itu — risiko yang tidak sepadan dengan manfaatnya, mengingat sudah
  ada mitigasi yang lebih aman (lihat di bawah).

**Mitigasi yang dipakai sebagai gantinya (Opsi A, disiplin lapisan
aplikasi):**

1. Pemisahan `getAdminDb()`/`getUserDb()` (bagian 1) — nama yang eksplisit
   supaya niat pemanggil selalu jelas.
2. Setiap pemakaian `getAdminDb()` wajib komentar satu baris yang menjelaskan
   kenapa RLS perlu dilewati (CLAUDE.md §3.4).
3. Test permanen `src/lib/db/__tests__/no-admin-db-in-app.test.ts` — gagal
   kalau ada file di `src/app/` (lapisan UI/Server Action/Route Handler)
   yang mengimpor `getAdminDb`. Lapisan yang melayani request user tidak
   boleh menyentuhnya sama sekali.
4. **RLS adalah lapisan terakhir, bukan satu-satunya** (CLAUDE.md §3.4) —
   setiap query tetap memfilter `business_id` secara eksplisit, supaya
   kebenaran hasil tidak pernah bergantung cuma pada RLS.

---

## 3. Kenapa `drizzle-kit push` dilarang (CLAUDE.md §3.6)

Dua alasan, keduanya ditemukan lewat pengalaman langsung, bukan teori:

**Alasan 1 — riwayat migration jadi tidak sinkron (T06).** `push` men-diff
`schema.ts` langsung ke database dan menerapkan hasilnya, tanpa pernah
mencatat apa pun ke `drizzle.__drizzle_migrations`. Setelah database
dibangun lewat `push`, menjalankan `drizzle-kit migrate` mengira belum ada
migration yang pernah jalan sama sekali, lalu mencoba me-replay migration
pertama dari nol — gagal di statement pertama (`CREATE TYPE` yang objeknya
sudah ada) tanpa pesan error yang jelas ke terminal (bug UI spinner
`drizzle-kit`nya sendiri). Perbaikannya butuh "baseline" manual: hitung
SHA256 migration file lalu insert baris ke `__drizzle_migrations` supaya
riwayatnya sinkron dengan kondisi database yang sebenarnya.

**Alasan 2 — policy RLS terpasang TANPA kondisinya (T07).** Ditemukan lewat
`pg_policies`: kolom `qual` dan `with_check` untuk **semua 10 policy**
bernilai `NULL`, padahal migration `.sql` hasil `drizzle-kit generate`
isinya benar (ada klausa `USING (...)`/`WITH CHECK (...)`-nya). `push`
menerapkan `CREATE POLICY` tanpa klausa itu ke database sungguhan — policy
ada, RLS "aktif", tapi tidak membatasi apa pun sama sekali. Ini baru
ketahuan saat test integrasi tenant isolation (T07) menunjukkan user yang
sudah login pun tidak bisa melihat data miliknya sendiri — dan sebaliknya,
diam-diam TIDAK ADA yang benar-benar teruji terisolasi sebelumnya, walau
test T06 (yang cuma mengecek RLS aktif, bukan bekerja) lolos hijau.

Perbaikannya ada di migration `0002_fix_rls_policies_missing_conditions.sql`
— `DROP POLICY IF EXISTS` lalu `CREATE POLICY` ulang persis sesuai definisi
asli. Idempoten dan aman dijalankan di database mana pun: di database yang
selalu dibangun lewat `db:migrate` (tidak pernah tersentuh `push`), migration
ini efeknya no-op.

**Aturan sekarang:** selalu `npm run db:generate` lalu `npm run db:migrate`.
Tidak ada pengecualian, termasuk saat development cepat/eksperimen.

---

## 4. Kenapa PIN kasir pakai `bcryptjs`, bukan `bcrypt`

`bcrypt` (paket npm) butuh kompilasi native binding saat instalasi. CLAUDE.md
§3.6 sudah mencatat masalah serupa sebelumnya (`vite`/`rolldown` bermasalah
dengan native binding di Windows, mesin development proyek ini). `bcryptjs`
adalah reimplementasi bcrypt murni JavaScript — hash yang dihasilkan
kompatibel dengan `bcrypt` (format `$2a$`/`$2b$` sama), tapi tanpa risiko
gagal instal di Windows atau di target deploy yang tidak mendukung native
addon (mis. edge runtime, kalau nanti dipakai). `bcryptjs` v3 juga sudah
menyertakan tipe TypeScript sendiri (`@types/bcryptjs` sengaja tidak
dipasang — redundan).

---

## 5. Kebijakan lockout PIN kasir

PIN kasir 6 digit cuma punya 1.000.000 kemungkinan — hash yang kuat saja
tidak cukup menahan brute force kalau percobaannya tidak dibatasi. Kebijakan
di `src/lib/auth/pin.ts`:

- **5 kali PIN salah berturut-turut → kunci 15 menit.**
- `failedAttempts` (kolom `employees.failed_attempts`) **hanya** direset ke
  0 setelah login **berhasil** — bukan otomatis setelah waktu kunci
  (`locked_until`) berakhir. Konsekuensinya: kalau lockout lama sudah lewat
  tapi kasir masih salah PIN, akun langsung terkunci lagi (bukan dapat 5
  jatah percobaan baru setiap kali waktu berjalan).
- Selama terkunci, percobaan ditolak lebih dulu di pengecekan `locked_until`
  **sebelum** membandingkan PIN — walau PIN yang dimasukkan benar, tetap
  ditolak sampai waktu kuncinya lewat.
- Pesan error untuk "kode karyawan tidak ditemukan" dan "PIN salah" **sama**
  (generik) — supaya tidak bisa dipakai mengenumerasi kode karyawan yang
  valid. Pesan "akun terkunci" sengaja berbeda/eksplisit (trade-off UX yang
  diterima untuk konteks perangkat POS internal, bukan form publik).
- `verifyCashierPin()` memakai `getAdminDb()`-setara (`createSupabaseAdminClient()`,
  service_role) karena belum ada sesi Supabase Auth sama sekali di titik
  PIN dimasukkan — lihat bagian 1.

Semua perilaku ini diuji di `src/lib/auth/__tests__/pin.test.ts` (7 test,
termasuk kasus lockout-berakhir-lalu-salah-lagi).

---

## 6. Konvensi: semua *rate* di `lib/calc/` (dan sekarang seluruh project)
   adalah pecahan, bukan angka 0–100

Berlaku konsisten di `order-calculator.ts`, `cogs.ts`, `pnl.ts`, `kpi.ts`:
field/fungsi apa pun yang secara konsep adalah persentase menyimpan atau
mengembalikan **pecahan** — `0.10` untuk 10%, `0.6882` untuk 68,82% — bukan
angka `10` atau `68.82`. Konversi ke skala persen (dikali 100, ditambah "%")
untuk tampilan dilakukan di **layer UI**, tidak pernah di dalam kalkulator.

Riwayat konvensi ini (kenapa ini dianggap penting untuk didokumentasikan
secara eksplisit): awalnya `kpi.ts` dan `pnl.ts` (T05) mengembalikan skala
0–100 (`grossMarginPct`, `foodCostPercent`, dst.), sementara
`order-calculator.ts` (T03) dan `cogs.ts` (T04) sudah memakai pecahan sejak
awal. Audit lib/calc/ (setelah T05) menemukan inkonsistensi ini — akhiran
nama yang sama (`*Percent`) berarti dua skala berbeda tergantung modulnya,
dan bahkan ada fungsi bernama `*Rate` (`voidRate`, `discountRate`) yang
diam-diam mengembalikan skala 0–100, bertentangan dengan namanya sendiri.
Semua diseragamkan jadi pecahan, dan fungsi yang tadinya `*Percent`
diganti nama jadi `*Rate` (`foodCostRate`, `grossMarginRate`, dst.) supaya
akhiran namanya sendiri menjadi penanda konvensi: **`*Rate` = pecahan,
selalu, di seluruh `lib/calc/`.**

Pengecualian yang harus diingat: `wastePercent` dari 0-100 di TC-08 (contoh
ilustratif di CALC-SPEC, bukan golden test formal) dan angka *literal* di
`docs/03-CALC-SPEC.md` sendiri (yang memakai notasi Indonesia biasa untuk
narasi/tabel, lihat bagian "Notasi Angka" di kepala dokumen itu) — konvensi
pecahan ini berlaku untuk **nilai di dalam kode**, bukan cara CALC-SPEC
menulis penjelasan dalam bahasa manusia.
