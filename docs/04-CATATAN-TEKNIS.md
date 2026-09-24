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

---

## 13. Kenapa `src/middleware.ts`, BUKAN `src/proxy.ts` (T19)

Next.js 16 mendeprecated konvensi `middleware.ts`, ganti nama jadi
`proxy.ts` (`export function proxy` alih-alih `export function
middleware`), dan menyediakan codemod resmi
(`npx @next/codemod@canary middleware-to-proxy .`) untuk migrasi
otomatis. **JANGAN jalankan codemod itu di proyek ini** sampai kondisi
di bawah terpenuhi — sudah pernah dijalankan sekali dan membuat
`npm run deploy` gagal total di produksi Indokopi.

**Kenapa gagal:** Proxy (nama baru) **selalu** jalan di Node.js
runtime di Next.js 16 — tidak ada cara memaksanya ke Edge runtime lewat
config apa pun (Next.js sendiri melempar error kalau field `runtime`
di-set di file Proxy). `@opennextjs/cloudflare` versi 1.20.2 (versi
terbaru yang ada saat ditulis) **belum mendukung Node.js middleware
sama sekali** — `npx opennextjs-cloudflare build` berhenti dengan
"Node.js middleware is not currently supported. Consider switching to
Edge Middleware." `next build` sendiri **tidak** menangkap masalah ini
(lolos hijau), cuma ketahuan di tahap bundling OpenNext -- makanya
Definition of Done (CLAUDE.md §6) sekarang mewajibkan
`opennextjs-cloudflare build` untuk perubahan yang menyentuh
middleware/proxy/config runtime.

`middleware.ts` (konvensi lama, deprecated tapi masih berfungsi penuh
di Next.js 16.3.0) tetap jalan di Edge runtime seperti sebelumnya dan
didukung penuh oleh OpenNext -- itu yang dipakai sekarang.

**Kapan boleh migrasi ke `proxy.ts` lagi:** setelah
`@opennextjs/cloudflare` merilis versi yang mendukung Node.js
middleware/Proxy. Cek status di
<https://github.com/opennextjs/opennextjs-cloudflare/issues/962>
(dan issue terkait di pihak Cloudflare,
<https://github.com/cloudflare/workers-sdk/issues/13755> dan
<https://github.com/cloudflare/workers-sdk/issues/13937>) sebelum
mencoba lagi. Kalau sudah ada rilis yang mengklaim dukungan ini, tetap
verifikasi dengan `npx opennextjs-cloudflare build` sampai selesai
tanpa error SEBELUM commit migrasinya -- jangan percaya changelog saja.

Guard auth (redirect ke `/login`) **tidak** ada di file ini, jadi
konvensi lama/baru tidak mengubah perilaku proteksi akses sama sekali
-- lihat komentar di `src/middleware.ts` sendiri untuk detail. Proteksi
akses sesungguhnya ada di `getSession()`/`requirePermissionDb()` per
layout/page.

---

## 14. T18b — Rancangan responsif mobile & tablet

Ditulis SEBELUM kode (langkah 1 dari 3), per instruksi eksplisit --
`/pos` dan dashboard sebelumnya cuma pernah dirancang/diuji untuk layar
desktop lebar. Ini juga akar masalah kenapa bug scroll `/pos` desktop
begitu sulit dilacak dua putaran sebelumnya: rantai `min-h-0`/`flex-1`
yang ada sekarang tidak pernah didesain untuk lebih dari satu bentuk
layout sekaligus. Breakpoint pakai default Tailwind (`md`=768px,
`lg`=1024px) -- sama persis dengan batas yang diminta, jadi tidak perlu
kustomisasi `tailwind.config`.

### 14.1 `/pos`

**Mobile (<768px, tanpa prefix):**
- `ProductGrid` dapat lebar penuh, 2 kolom produk (sudah `grid-cols-2`
  di `product-grid.tsx`, tidak berubah).
- `CartPanel` (panel sisi kanan yang ada sekarang) **disembunyikan**
  total (`hidden md:flex` di root-nya sendiri -- karena `display:none`,
  otomatis tidak ikut dihitung sebagai grid item, tidak perlu wrapper
  tambahan).
- Sebagai gantinya: `MobileCartBar` -- bar melayang di bagian bawah
  layar (`fixed inset-x-0 bottom-0`), tampil kalau keranjang tidak
  kosong, isinya badge jumlah item + total + label "Lihat Keranjang".
  Tap membuka `MobileCartSheet`.
- `MobileCartSheet` -- bottom sheet (dialog base-ui yang di-style ulang
  jadi slide-up dari bawah, tinggi ~85dvh, BUKAN memakai
  `DialogContent` yang sudah ada supaya dialog lain di app tidak ikut
  berubah), isinya sama persis dengan isi `CartPanel` (baris item +
  diskon + total + tombol Bayar) tapi sebagai konten sheet yang scroll
  alami -- TIDAK butuh trik `position:fixed`+portal seperti footer
  `CartPanel` desktop, karena sheet-nya sendiri sudah jadi overlay
  dengan batas tinggi sendiri.
- Tombol Bayar di dalam sheet membuka `PaymentDialog` yang sudah ada
  (dialog base-ui bertumpuk di atas sheet -- portal masing-masing
  independen, didukung base-ui secara native).

**Tablet (768–1024px, `md:`):** dua kolom seperti desktop
(`grid-cols-[1fr_280px]`), tapi kolom keranjang lebih SEMPIT (280px,
bukan 360px) -- `CartPanel` tampil (`md:flex`), rantai scroll internal
(`md:h-full` di root, `md:min-h-0 md:flex-1 md:overflow-y-auto` di
daftar item) TETAP SAMA seperti desktop karena breakpoint-nya memang
sama-sama "md ke atas", cukup lebar kolomnya yang beda per `lg:`.

**Desktop (>1024px, `lg:`):** sama seperti sekarang, kolom keranjang
360px (`lg:grid-cols-[1fr_360px]`).

**Tier selector & tab kategori -- SEMUA breakpoint:** baris horizontal
scroll (`flex flex-nowrap overflow-x-auto`, bukan `flex-wrap`), tidak
pernah menumpuk ke banyak baris. Ini juga memperbaiki desktop: dengan
15 kategori Indokopi, `flex-wrap` sebelumnya makan 3 baris dan menyita
ruang vertikal grid produk -- scroll horizontal satu baris konsisten
di semua ukuran, bukan cuma perbaikan mobile.

**Header shift-info (trailing di `PriceTierSelector`) -- mobile only:**
info "Kasir aktif" + tombol Tutup Shift/Transaksi Hari Ini/Kas pindah
ke baris KEDUA di bawah baris tier selector (`flex-col md:flex-row`)
supaya tidak berdesakan dengan tier yang sudah scroll horizontal --
tablet/desktop tetap satu baris seperti sekarang.

### 14.2 Dashboard (`(dashboard)/layout.tsx`)

**<1024px (di bawah `lg:`):** `<aside>` sidebar yang ada sekarang
disembunyikan (`hidden lg:flex`). Sebagai gantinya: tombol hamburger di
header/topbar (baru, belum ada topbar mobile sama sekali sekarang --
ditambahkan) membuka `MobileNavDrawer`, dialog base-ui di-style jadi
drawer dari kiri (`fixed inset-y-0 left-0`, lebar terbatas mis.
`w-72`), isinya sama persis dengan isi `<aside>` (logo, role, nav
items, tombol keluar). Drawer tertutup otomatis saat link nav ditekan
(navigasi = ganti halaman = drawer harus hilang).

**≥1024px (`lg:`):** sidebar tetap seperti sekarang, tombol hamburger
disembunyikan (`lg:hidden`).

### 14.3 Target sentuh 44px

Variant `size` di `components/ui/button.tsx` **tidak diubah** (dipakai
di seluruh dashboard, mengubahnya menggeser tombol di halaman yang
tidak diminta berubah). Sebagai gantinya, tombol-tombol interaktif
`/pos` yang dipakai kasir (tier selector, tab kategori, +/- qty
keranjang, tombol Bayar, trigger `MobileCartBar`) diberi override
`className="h-11 ..."` (44px) langsung per elemen lewat `cn()`/
`twMerge` (`src/lib/utils.ts`) -- variant besar bawaan (`lg`) cuma
36px, tidak cukup.

### 14.4 File yang berubah/baru

Baru: `mobile-cart-bar.tsx`, `mobile-cart-sheet.tsx`,
`cart-line-row.tsx` + `total-row.tsx` (diekstrak dari `cart-panel.tsx`
supaya dipakai ulang oleh sheet, bukan diduplikasi),
`cart-summary.tsx` (blok diskon+total+tombol Bayar, diekstrak dari
`cart-panel.tsx`, dipakai `CartPanel` DAN `MobileCartSheet`),
`components/dashboard/mobile-nav-drawer.tsx`.

Diubah: `pos-screen.tsx`, `cart-panel.tsx`, `product-grid.tsx`,
`price-tier-selector.tsx`, `(dashboard)/layout.tsx`.

### 14.5 Langkah 3 -- verifikasi manual (bukan saya yang menyatakan selesai)

Setelah implementasi, daftar hal yang PERLU dicek langsung di HP
(bukan asumsi dari saya) ada di respons setelah kode ini selesai --
lihat riwayat percakapan untuk daftar per-langkah yang diberikan ke
user setelah implementasi T18b.

## 15. Kenapa `units.code` tersimpan sebagai teks di `ingredients`, bukan FK -- dan kenapa code harus immutable (T21)

BLUEPRINT §3.3 memang merancangnya begitu: `ingredients.base_unit` dan
`ingredients.purchase_unit` bertipe `text`, isinya string kode satuan
("g", "kg", "pcs", ...), BUKAN foreign key ke `units.id`. Ini keputusan
BLUEPRINT, bukan penyimpangan yang dibuat saat implementasi T21 --
dicatat di sini karena konsekuensinya baru terasa sekarang setelah CRUD
`units` dibangun.

**Kenapa BLUEPRINT memilih teks, bukan FK:**
- `stock_movements` bersifat append-only dan snapshot nilainya sendiri
  (`unit_cost`, `balance_after`, dst, CLAUDE.md §3.2) -- filosofi yang
  sama berlaku ke satuan: kartu stok dan riwayat pembelian ingin
  menampilkan "g", "kg" sebagai LABEL, bukan hasil JOIN ke tabel lain
  yang bisa berubah.
- `units` bersifat GLOBAL per bisnis (satu daftar kosakata satuan),
  sementara base_unit/purchase_unit ingredient cukup mencocokkan salah
  satu KODE di kosakata itu -- tidak butuh integritas referensial
  seketat, misalnya, `stock_movements.ingredient_id` yang benar-benar
  harus menunjuk baris `ingredients` yang masih ada.

**Konsekuensi yang WAJIB dijaga karena ini teks, bukan FK:**
Postgres tidak bisa mencegah `units.code` berubah sementara
`ingredients.base_unit`/`purchase_unit` masih menyimpan nilai lama --
tidak ada `ON UPDATE CASCADE` untuk pencocokan teks. Kalau `code` boleh
diedit, mengubah "kg" jadi "KG" (misalnya) akan membuat setiap
ingredient yang sebelumnya mengacu "kg" DIAM-DIAM kehilangan
acuannya -- tidak ada error di database, tidak ada constraint yang
gagal, cuma pencocokan teks yang berhenti berhasil. `deleteUnitWithDb`
(lib/units/manage.ts) yang mengecek referensi lewat pencocokan
`units.code` juga jadi buta terhadap satuan yang sudah "yatim" seperti
ini -- dia akan menganggap satuan lama tidak dipakai siapa pun (karena
tidak ada lagi ingredient yang cocok dengan kode LAMA), padahal
sebenarnya masih "dipakai" oleh ingredient yang sekarang menunjuk kode
yang sudah tidak ada.

**Karena itu**: `units.code` dikunci permanen setelah dibuat
(`createUnitWithDb`/`updateUnitWithDb` di lib/units/manage.ts sengaja
jadi dua fungsi terpisah, `code` cuma ada di skema create). Sama
seperti kode karyawan dan serial number perangkat -- kalau salah ketik,
jalan keluarnya hapus (kalau belum dipakai bahan manapun) lalu buat
baru, bukan edit di tempat. `name`, `base_unit`, dan `factor` tetap
boleh diedit karena tidak ada tabel lain yang mencocokkan teksnya.

**Kalau nanti ini mau diubah jadi FK sungguhan** (`ingredients.base_unit_id
uuid references units(id)`), itu BUKAN perubahan kecil -- perlu
migration data yang menerjemahkan setiap nilai teks yang sudah ada
jadi `units.id` yang benar per bisnis, plus keputusan ulang soal apakah
`stock_movements` juga ikut di-FK-kan atau tetap snapshot teks. Jangan
dikerjakan diam-diam sebagai "refactor kecil" -- ini keputusan skema
yang butuh persetujuan eksplisit dulu.

## 16. `getAdminDb()` di test safe-delete membuktikan kode, bukan produksi -- dan penutupnya: `assertRowsAffected`

Bug #15 (ingredients tanpa policy RLS DELETE) lolos 11 test yang
kelihatannya lengkap. Sebabnya: test itu memakai `getAdminDb()`
(BYPASSRLS) untuk memanggil `deleteIngredientWithDb`, bukan cuma untuk
menyiapkan data. Baris `tx.delete(ingredients)...` di dalamnya jalan
tanpa RLS sama sekali, jadi tidak peduli policy DELETE ada atau tidak
-- baru terlihat gagal saat dashboard sungguhan (yang lewat
`getUserDb()`, RLS aktif) diverifikasi manual lewat browser.

Setelah ditemukan, dicek ulang: **seluruh** test safe-delete lain
(categories, price-tiers, modifier-groups, modifiers, payment-methods,
units) punya kelemahan struktural yang sama -- semuanya memanggil
fungsi yang diuji lewat `getAdminDb()`. Kebetulan kelimanya memang
punya policy DELETE yang benar (dicek manual, lihat commit yang
menambah `assertRowsAffected`), tapi test-nya sendiri tidak pernah
membuktikan itu.

**Perbaikan dua lapis, bukan cuma satu:**

1. **Test**: semua test safe-delete (`lib/*/​__tests__/manage.test.ts`)
   diubah memakai `getUserDb()` sungguhan lewat fixture bersama
   `lib/db/__tests__/helpers/user-db-fixture.ts` (business + auth user +
   membership + login asli, pola sama `tenant-isolation.test.ts`) --
   bukan cuma untuk setup data, tapi untuk operasi yang DIUJI. Kalau
   suatu tabel kehilangan policy DELETE-nya lagi di masa depan, test
   akan merah, bukan diam-diam lolos.

   Konsekuensi: cleanup di `afterAll` yang menghapus baris dari tabel
   append-only (`orders`, `shifts`, `stock_movements` -- semuanya
   SENGAJA tidak punya policy DELETE, CLAUDE.md §3.2) harus tetap pakai
   `getAdminDb()` secara eksplisit, karena itu memang operasi sistem
   (bukan bagian yang diuji), bukan salah kode. Beda peran, beda db --
   jangan disamakan jadi satu `db` per file lagi.

2. **Aplikasi**: `assertRowsAffected()` (`lib/db/errors.ts`) dipasang
   di SETIAP `tx.delete(...)` di `lib/*/manage.ts` lewat
   `.returning({id: table.id})`, melempar Error kalau baris yang
   terhapus nol. Ini lapisan pertahanan yang menutup SELURUH kelas bug
   ini secara permanen -- bukan cuma kasus yang kebetulan ketahuan hari
   ini. Kalau ada tabel lain kehilangan policy DELETE-nya nanti (lupa
   nambah di migration baru, salah generate, dst), pengguna dapat error
   jelas, bukan tombol "Hapus" yang terlihat berhasil tapi tidak
   melakukan apa-apa.

## 17. Batasan yang diketahui: cleanup fixture test tidak menjangkau `refunds` (dan tabel grandchild sejenis)

`lib/db/__tests__/helpers/user-db-fixture.ts` (bagian 16 di atas)
menghapus tabel penghalang secara dinamis lewat `information_schema` --
tapi HANYA satu langkah (1-hop): tabel dengan foreign key **langsung**
ke `businesses(id)` yang `ON DELETE NO ACTION`. Ini cukup untuk seluruh
pola T21/T22 (`business_id` didenormalisasi ke setiap tabel), tapi
`refunds` tidak mengikuti pola itu -- `refunds.order_id` menunjuk ke
`orders(id)` **tanpa** `business_id` sendiri, dan FK itu juga
`ON DELETE NO ACTION` (tidak eksplisit di schema.ts, jadi default
Postgres). Akibatnya `refunds` tidak pernah muncul di query
`findTablesBlockingBusinessDelete` (yang cuma mencari `ccu.table_name =
'businesses'`), padahal baris `refunds` bisa memblokir penghapusan
`orders`, yang pada gilirannya memblokir penghapusan `businesses`.

**Kapan ini jadi masalah:** hanya kalau ada test yang (a) memakai
`createUserDbFixture` DAN (b) membuat baris `refunds` sungguhan (lewat
`refundOrderWithDb`/alur serupa) sebagai bagian datanya. Sampai catatan
ini ditulis, tidak ada test seperti itu -- test yang membuat refunds
(`lib/pos/__tests__/void-refund.test.ts`) memakai `getAdminDb()`
langsung dengan cleanup manualnya sendiri (urutan `refunds` -> `orders`
-> `shifts` -> `businesses`, lihat `afterAll` di file itu), bukan
`createUserDbFixture`. Jadi ini BUKAN bug yang sedang aktif -- murni
batasan desain yang perlu diingat kalau kombinasi (a)+(b) di atas
pernah terjadi nanti.

**Kenapa sengaja tidak diperbaiki sekarang:** memperbaikinya dengan
benar untuk kasus umum (N-hop, bukan cuma `refunds`) berarti membangun
graph FK penuh + topological sort di seluruh schema `public`, bukan
lagi "cari tabel yang langsung menunjuk businesses". Itu jauh lebih
kompleks daripada manfaatnya sekarang, mengingat cakupan 1-hop yang ada
sudah menutup SEMUA tabel yang benar-benar dipakai lewat
`createUserDbFixture` hari ini. Kalau nanti kombinasi (a)+(b) di atas
terjadi, perbaikan paling murah BUKAN membangun solusi N-hop umum,
tapi menambah `refunds` (dan tabel grandchild lain yang relevan) sebagai
langkah manual eksplisit di `cleanup()`, mirip pola `void-refund.test.ts`
-- ditulis di sini supaya keputusan ini tidak hilang bersama riwayat
chat dan tidak perlu ditemukan ulang dari nol.

## 18. `movement_type = 'transfer_loss'` TIDAK PERNAH mengubah `stock_levels` -- JANGAN "diperbaiki" jadi mengurangi stok (T22)

`stock_movements` di seluruh sistem SELALU mengubah saldo -- itu memang
maksud tabelnya (ledger append-only, `balance_after` = saldo SETELAH
movement ini terjadi). `transfer_loss` (docs/05-RENCANA-FASE-2.md §8.h)
adalah SATU-SATUNYA pengecualian yang disengaja, dan alasannya bukan
teknis, tapi soal double-counting:

Saat outlet menerima kiriman gudang dan `received_qty != sent_qty`
(dikirim 20, sampai 15 -- 3 pecah, 2 hilang di jalan), sistem menulis
DUA movement dalam satu transaksi (`receiveStockTransferWithDb`,
`lib/stock-transfers/manage.ts`):

1. `transfer_in`, qty = **received_qty** (15) -- ini SATU-SATUNYA yang
   mengubah `stock_levels.qty_on_hand` outlet. Sudah benar sendirian:
   outlet memang cuma punya 15 secara fisik.
2. `transfer_loss`, qty = -(sent_qty − received_qty) = -5, TAPI
   `balance_after`/`avg_cost_after` yang ditulis SAMA PERSIS dengan yang
   baru saja dihasilkan `transfer_in` di atas -- TIDAK dihitung ulang,
   TIDAK memanggil UPDATE `stock_levels` sama sekali.

**Kalau `transfer_loss` IKUT mengurangi `stock_levels` (pola movement
normal), outlet akan kehilangan 5 unit itu DUA KALI**: sekali karena
`transfer_in` cuma mencatat 15 dari 20 yang diminta (5 "tidak pernah
masuk" secara implisit), sekali lagi kalau `transfer_loss` mengurangi 5
lagi dari saldo yang sudah benar itu. Padahal cuma ada SATU kejadian
kerugian, bukan dua.

**Fungsi `transfer_loss` murni pelaporan/akuntabilitas**: `qty` dan
`total_cost`-nya tetap diisi dengan benar (bukan nol) supaya laporan
"selisih pengiriman per pengirim/per periode" (T28, belum dibangun)
tinggal `SELECT ... WHERE movement_type = 'transfer_loss'` dan
menjumlahkan `total_cost` -- **tapi laporan APA PUN yang menjumlahkan
`stock_movements.qty` untuk merekonstruksi SALDO STOK** (bukan nilai
rupiah) **wajib mengecualikan `transfer_loss` secara eksplisit**, kalau
tidak saldo hasil rekonstruksinya akan lebih rendah dari
`stock_levels.qty_on_hand` yang sesungguhnya. Sampai catatan ini ditulis
belum ada laporan yang melakukan rekonstruksi saldo dari penjumlahan
`qty` (kartu stok di `ingredients/[id]/stock-card/page.tsx` menampilkan
`balance_after` per baris apa adanya, tidak menjumlahkan ulang) -- tapi
kalau T28 nanti butuh itu, filter `movement_type != 'transfer_loss'`
WAJIB ada di query itu.

Kartu stok memberi tanda visual (ikon ⓘ + `title` tooltip, kolom qty
dibuat italic/muted) khusus baris `transfer_loss`, supaya manusia yang
membaca juga tidak salah menyimpulkan itu pengurangan stok kedua.

## 19. Utang: `findTablesBlockingBusinessDelete`/`deleteBlockingRowsForBusiness` tidak melihat FK tidak langsung ke tabel lain (bukan ke `businesses`) — ditemukan lewat `stock_opnames.shift_id -> shifts.id` (Rencana Revisi 24 September 2026 §7 poin 4)

Varian BARU dari batasan §17 di atas, mekanismenya beda jadi ditulis
terpisah. `lib/db/__tests__/helpers/user-db-fixture.ts` — fungsi
`findTablesBlockingBusinessDelete` — mencari tabel yang FK-nya
LANGSUNG ke `businesses(id)` dengan `delete_rule = 'NO ACTION'`, lalu
`deleteBlockingRowsForBusiness` menghapus baris tabel-tabel itu
`WHERE business_id = ...` sebelum `businesses` sendiri dihapus.

`stock_opnames` (migrasi 0040, 24 September 2026) menambah kolom
`shift_id uuid references shifts(id)` — default `ON DELETE NO ACTION`,
TIDAK diberi `onDelete: "cascade"` secara eksplisit di `schema.ts`.
Tapi `stock_opnames.business_id` sendiri **`onDelete: "cascade"`** ke
`businesses` — jadi `stock_opnames` TIDAK PERNAH muncul di hasil
`findTablesBlockingBusinessDelete` sama sekali (query itu cuma mencari
`delete_rule = 'NO ACTION'`), padahal baris `stock_opnames` yang
`shift_id`-nya terisi tetap memblokir `DELETE shifts WHERE
business_id = ...` yang dijalankan lebih dulu oleh
`deleteBlockingRowsForBusiness` (`shifts` sendiri DITEMUKAN, karena FK
`shifts.business_id -> businesses` memang `NO ACTION`).

Beda dari §17 (`refunds` tidak ditemukan karena TIDAK PUNYA kolom
`business_id` sendiri untuk dicocokkan): di sini `stock_opnames`
PUNYA `business_id`, tapi tidak pernah masuk daftar sama sekali karena
FK business_id-nya sendiri CASCADE, bukan NO ACTION — jadi bukan soal
"kolom yang dicari tidak ada", tapi "tabelnya lolos dari pencarian
padahal salah satu kolom LAINNYA (`shift_id`) memblokir tabel lain
yang lebih dulu ditemukan".

**Kapan ini jadi masalah:** hanya kalau test memakai
`createUserDbFixture` DAN membuat baris `shifts` DAN baris
`stock_opnames` dengan `shift_id` terisi untuk shift itu (jenis
'buka'/'tutup'). `src/lib/stock-opnames/__tests__/shift-opname.test.ts`
(test baru, ditulis bersamaan dengan fitur ini) PERSIS kombinasi itu —
gejalanya: `deleteBlockingRowsForBusiness` gagal dengan pesan "gagal
menghapus baris dari shifts ... FK NO ACTION ke tabel lain di luar
daftar ini". Diperbaiki DI FILE TEST ITU SENDIRI (bukan di helper
bersama) dengan menghapus baris `stock_opnames` untuk `businessId`
tersebut secara manual di `afterAll`, sebelum memanggil
`fixture.cleanup()` — pola sama seperti solusi `refunds` di §17
(`void-refund.test.ts`).

**Kenapa sengaja tidak diperbaiki di helper bersama:** sama alasan
dengan §17 — perbaikan umum (N-hop, bukan cuma tabel-tabel yang FK-nya
langsung ke `businesses`) berarti membangun graph FK penuh + topological
sort atas seluruh skema `public`, jauh lebih kompleks daripada
manfaatnya untuk dua kasus (`refunds`, `stock_opnames`) yang sejauh ini
ditemukan. **Utang ini ditulis supaya orang berikutnya yang menambah
kolom FK baru menunjuk ke tabel NON-`businesses` (pola sama
`shift_id`/`opname_id`/dst) tahu harus mengecek dulu apakah test barunya
kena batasan yang sama** — cari nama fungsi
`findTablesBlockingBusinessDelete` atau `deleteBlockingRowsForBusiness`
di `user-db-fixture.ts` kalau `afterAll` test tiba-tiba gagal dengan
pesan "FK NO ACTION ke tabel lain di luar daftar ini" — tambahkan
manual cleanup di file test itu, jangan bongkar helper bersama untuk
satu kasus.
