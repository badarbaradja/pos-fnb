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

---

## 7. RLS untuk tabel tanpa `business_id` — policy lewat `EXISTS` join ke tabel induk

Beberapa tabel BLUEPRINT sengaja **tidak** punya kolom `business_id`
sendiri — mereka anak langsung dari satu tabel induk yang sudah
ber-`business_id`, dan `business_id`-nya dianggap "diwariskan" lewat FK.
Ditemui pertama kali di T07 (`permissions_override`, anak dari
`employees`), lalu berulang di T08 untuk lima tabel katalog:

| Tabel | Induk yang dipakai untuk RLS |
|---|---|
| `product_variants` | `products` (lewat `product_id`) |
| `product_prices` | `products` (lewat `product_id`) |
| `modifiers` | `modifier_groups` (lewat `modifier_group_id`) |
| `product_modifier_groups` | `products` (lewat `product_id`) |
| `product_bundle_items` | `products` (lewat `bundle_id`) |

Pola policy-nya seragam, `SELECT` dan `INSERT` sama-sama pakai `EXISTS`:

```sql
using: exists (
  select 1 from products p
  where p.id = <tabel_ini>.product_id
    and p.business_id = any(auth_business_ids())
)
```

**Kenapa `EXISTS` join, bukan duplikasi kolom `business_id` ke setiap
tabel anak:**

1. **Itu desain BLUEPRINT, bukan pilihan kita untuk diubah.** Skema di
   BLUEPRINT §3.2 (dan tabel-tabel Fase 2 nanti) sudah didefinisikan tanpa
   `business_id` di tabel-tabel ini. Menambahkannya berarti menyimpang dari
   dokumen sumber kebenaran tanpa alasan bisnis, cuma demi kemudahan RLS.
2. **`business_id` yang diduplikasi bisa jadi tidak sinkron.** Kalau
   `product_variants.business_id` disimpan terpisah dari
   `products.business_id`, tidak ada yang memaksa keduanya tetap sama
   kecuali trigger tambahan atau disiplin aplikasi — sumber kebenaran ganda
   untuk satu fakta yang sama. Join ke induk membuat `business_id` cuma
   punya SATU tempat penyimpanan; anak-anaknya otomatis ikut benar selama
   FK-nya benar.
3. **Konsisten dengan aturan "RLS lapisan terakhir, bukan satu-satunya"**
   (CLAUDE.md §3.4) — query aplikasi tetap wajib filter eksplisit (mis.
   lewat `product_id` yang sudah diketahui scope-nya dari request), `EXISTS`
   join di policy cuma jaring pengaman tambahan, bukan jalur utama
   penentuan akses.

**Trade-off yang disadari:** setiap `SELECT`/`INSERT` ke tabel-tabel ini
menanggung satu subquery/join tambahan dibanding kalau `business_id` ada
langsung di tabel. Untuk ukuran data katalog (produk per bisnis biasanya
puluhan-ratusan baris, bukan jutaan), ini tidak jadi masalah performa —
kalau nanti terbukti jadi bottleneck di tabel transaksi volume tinggi,
evaluasi ulang per tabel, jangan generalisasi keputusan ini ke semuanya.

**Sudah muncul lagi, seperti diduga.** T11 (`docs/01-TASK-BOARD.md`) nambah
delapan tabel order & shift dengan pola yang sama: `order_items` (anak
`orders`), `cash_movements` (anak `shifts`), `payments`/`refunds` (anak
`orders`). Pilih induk yang paling langsung merepresentasikan "pemilik"
barisnya (biasanya FK yang `not null`), beri alias pendek satu-dua huruf
(`p` untuk `products`, `mg` untuk `modifier_groups`, `o` untuk `orders`,
`s` untuk `shifts`, dst.) supaya konsisten dibaca lintas tabel.

### 7.1 Varian: `EXISTS` DUA level, kalau induk langsung juga tidak punya `business_id`

Kadang tabel anak-nya sendiri adalah anak dari tabel anak lain (dua level
turun dari tabel yang punya `business_id`). Ditemui di T11 pada dua tabel:

| Tabel | Induk langsung | Induk langsung itu anak dari |
|---|---|---|
| `order_item_modifiers` | `order_items` (lewat `order_item_id`) | `orders` (lewat `order_id`) |
| `refund_items` | `refunds` (lewat `refund_id`) | `orders` (lewat `order_id`) |

Solusinya bukan dua `EXISTS` bersarang, cukup **satu** `EXISTS` yang
join dua tabel sekaligus sampai ketemu kolom `business_id`:

```sql
-- order_item_modifiers: dua level ke business_id lewat order_items -> orders
using: exists (
  select 1 from order_items oi
  join orders o on o.id = oi.order_id
  where oi.id = order_item_modifiers.order_item_id
    and o.business_id = any(auth_business_ids())
)
```

Alias huruf pertama tabel perantara (`oi` untuk `order_items`) beda dari
alias tabel yang punya `business_id`-nya (`o` untuk `orders`) — penting
supaya query-nya jelas dibaca mana yang jadi jembatan dan mana yang jadi
sumber `business_id` sebenarnya, terutama kalau nanti ada join tiga level.

**Kapan pola dua level ini dipakai, bukan satu level:** kalau tabel
induknya SENDIRI tidak punya `business_id` (dia juga anak, bukan tabel
utama ber-tenant). Kalau induk langsungnya sudah punya `business_id`
(kasus §7 di atas), satu level `EXISTS` saja cukup — jangan tambah join
yang tidak perlu.

**Ini akan muncul lagi.** Fase 2 kemungkinan besar butuh varian dua level
ini lagi: `purchase_items` (anak `purchases`, yang anak `suppliers` atau
langsung ber-`business_id` -- cek dulu skemanya saat sampai di T24),
`opname_items` (anak `stock_opnames`), dan `recipe_items` kalau resep
punya tabel header terpisah dari baris bahannya. Pola pemilihannya sama:
telusuri FK `not null` sampai ketemu tabel pertama yang punya
`business_id`, join semua tabel perantara dalam SATU `EXISTS`.

---

## 8. Select (Base UI): wajib prop `items`, kalau tidak akan menampilkan value mentah

`<Select.Root>` WAJIB diberi prop `items` berisi peta value→label. Tanpa
itu, `<Select.Value>` menampilkan raw value (UUID atau enum mentah)
alih-alih label sampai dropdown pernah dibuka. Ditemukan di T09,
mempengaruhi setiap Select baru.

---

## 9. Harga di keranjang kasir: LIVE, bukan snapshot — snapshot cuma sekali, di T13

Harga di keranjang bersifat LIVE — di-resolve saat kalkulasi dari
katalog + tier terpilih, tidak disimpan di `CartLine`. Ini supaya ganti
tingkat harga langsung berlaku ke seluruh keranjang.

Snapshot terjadi tepat SEKALI, saat order disimpan di T13: `unit_price`,
`product_name`, `variant_name`, `category_name`, dan `unit_cogs`
dibekukan ke `order_items` dan tidak pernah berubah lagi. Jangan
tertukar — keranjang live, order beku.

---

## 10. QRIS = metode pencatatan manual, BUKAN integrasi payment gateway

Sengaja ditulis eksplisit supaya tidak ada yang mengira ini bug yang
belum selesai: sistem ini **tidak** terintegrasi ke payment gateway
mana pun (Midtrans, Xendit, QRIS resmi dari bank/PJSP, dll). Tidak ada
callback, tidak ada verifikasi status pembayaran otomatis, tidak ada API
eksternal yang dipanggil saat kasir memilih QRIS di dialog pembayaran.

Yang sebenarnya terjadi: kasir menerima pembayaran QRIS lewat alat
scan-nya sendiri (EDC/HP bank), lalu **mencatat manual** di sistem ini
kalau sudah dibayar, dengan nomor referensi dari notifikasi bank
(SMS/app) sebagai bukti. Karena itu `payment_methods.requires_ref` untuk
QRIS diset `true` (`scripts/seed-demo.ts`) — field "Nomor Referensi"
muncul di dialog pembayaran (`components/pos/payment-dialog.tsx`) khusus
untuk metode yang `requires_ref = true`, disimpan ke `payments.reference`.

Kalau nanti (Fase lanjut) benar-benar mau integrasi payment gateway
sungguhan, itu perubahan arsitektur baru — bukan sekadar "melengkapi"
yang sudah ada di sini.

---

## 11. `/pos` adalah antarmuka staf, bukan antarmuka pelanggan — jangan digabung


Dicatat di sini sebelum Fase 6 (T50 — Kiosk/QR Order, lihat
`docs/01-TASK-BOARD.md`) mulai dikerjakan, supaya batasnya jelas sejak
awal. `/pos` (route group `(pos)`) selalu mengasumsikan dua hal yang
TIDAK berlaku untuk pelanggan yang memesan sendiri: shift aktif (T15 —
tanpa shift, `pos/page.tsx` redirect ke `/pos/shift/open`, dan
`payOrderWithDb` menolak bayar) dan identitas kasir yang sudah
diverifikasi PIN (`shift.employeeId`, dipakai sebagai `orders.cashier_id`).
Antarmuka pemesanan mandiri pelanggan nanti TIDAK punya keduanya — tidak
ada shift, tidak ada kasir yang login — jadi harus jadi route group
terpisah dari `(pos)`, dengan alur order yang berhenti di status baru
(`pending_confirmation`) sebelum disentuh kasir, bukan langsung lewat
`payOrderWithDb`. Katalog dan `lib/calc/order-calculator.ts` boleh dipakai
ulang (keduanya sudah tidak bergantung pada sesi kasir), tapi halaman dan
Server Action-nya harus baru, bukan menumpangi punya `/pos`.

---

## 12. Gambar produk (T09c): bucket privat + RLS path-prefix + signed URL, bukan Next.js `<Image>`

Bucket Storage `products` (migration 0012) **privat** (`public = false`),
bukan bucket publik dengan path UUID yang "susah ditebak" — susah ditebak
bukan akses terkontrol. RLS di `storage.objects` dipasang manual di SQL
migration (Drizzle tidak punya builder untuk `storage.*`, sama alasannya
dengan `FORCE ROW LEVEL SECURITY` di bagian 3), pola yang PERSIS sama
dengan RLS tabel Postgres biasa, cuma predikatnya beda:

```sql
using (bucket_id = 'products' and (storage.foldername(name))[1]::uuid = any(public.auth_business_ids()))
```

`(storage.foldername(name))[1]` = segmen path pertama objek. Konvensi
path yang dipilih supaya predikat ini bisa dipakai: **path objek
DETERMINISTIK**, `{business_id}/{product_id}.jpg`
(`lib/products/image.ts#getProductImagePath`) — business_id selalu jadi
folder pertama, dan karena deterministik, upload ulang (ganti gambar)
tinggal `upsert:true` ke path yang SAMA. Ini menghilangkan seluruh
masalah "file lama yang tertinggal saat diganti" tanpa perlu kode
pelacakan path lama/hapus terpisah — tidak ada window di mana dua file
sempat ada sekaligus.

Karena bucket privat, gambar tidak pernah diakses lewat URL permanen —
selalu di-resolve ke **signed URL** (`createSignedUrl`/`createSignedUrls`,
1 jam) di server, tepat sebelum dikirim ke klien: satu per produk di
halaman edit dashboard, dan **satu panggilan batch** untuk semua produk
sekaligus di `getPosCatalog()` (bukan N panggilan per produk — dengan
25+ produk bergambar, N panggilan terpisah akan terasa di waktu muat
layar kasir).

**Sengaja TIDAK pakai `next/image`** untuk merender gambar ini, walau itu
pilihan default Next.js untuk gambar eksternal: (1) perlu menambah
`images.remotePatterns` untuk domain Storage Supabase, permukaan config
baru untuk sesuatu yang bisa diselesaikan dengan `<img>` biasa; (2)
signed URL BERUBAH tiap kali di-generate ulang (token di query string) —
ini melemahkan optimasi cache bawaan `next/image` yang mengandalkan URL
stabil. Sebagai gantinya: `<img loading="lazy" decoding="async">` biasa +
ukuran tetap (`aspect-square`, supaya tidak ada layout shift) — cukup
untuk grid kasir tetap responsif dengan 25+ produk bergambar, karena
gambar offscreen tidak pernah di-decode sampai discroll ke layar.

Diverifikasi dengan test isolasi tenant yang setara
`lib/auth/__tests__/tenant-isolation.test.ts` tapi untuk Storage:
`src/lib/db/__tests__/storage-tenant-isolation.test.ts` — business A
benar-benar ditolak (bukan diasumsikan tertolak) saat mencoba
`download()`/`list()` objek business B.
