# 01 — Task Board

Urutan ini disengaja. Kalimat kuncinya: **kalkulator dulu, database kedua, UI terakhir.**
Kalau kalkulatornya benar, sisanya cuma CRUD. Kalau UI-nya duluan, kamu akan menulis ulang semuanya.

Status: `[ ]` belum · `[~]` jalan · `[x]` selesai

---

## Fase 0 — Fondasi (target 1 minggu)

**[x] T01 — Setup tooling**
Pasang Vitest, Drizzle ORM, decimal.js, zod, date-fns-tz. Buat script `typecheck`, `lint`, `test`, `db:generate`, `db:migrate`. TypeScript strict mode aktif.
*Selesai kalau:* `npm run test` jalan dengan satu test dummy hijau.

**[x] T02 — Utilitas dasar**
`lib/utils/money.ts` (wrapper Decimal, `formatIDR`, `roundTo`), `lib/utils/business-date.ts`, `lib/utils/id.ts` (UUID v7).
*Selesai kalau:* TC-15 dari CALC-SPEC lolos, termasuk kasus WITA dengan server UTC.

**[x] T03 — Kalkulator struk** ★ tugas paling penting di seluruh proyek
Implementasi `lib/calc/order-calculator.ts` sesuai CALC-SPEC bagian A. **Tulis test dulu, baru implementasi.**
*Selesai kalau:* TC-01 sampai TC-07 semuanya hijau, termasuk property test.

**[x] T04 — Kalkulator HPP**
`lib/calc/cogs.ts`: HPP dari resep (rekursif untuk semi-finished), WAC, alokasi ongkir, variance.
*Selesai kalau:* TC-08 sampai TC-12 hijau, circular reference melempar error jelas.

**[x] T05 — Kalkulator P&L, KPI, shift**
`lib/calc/pnl.ts`, `kpi.ts`, `shift.ts` sesuai CALC-SPEC bagian C, D, E.
*Selesai kalau:* TC-13, TC-14 hijau, dan semua pembagian nol menghasilkan `null`.

**[x] T06 — Skema database inti**
Drizzle schema untuk: `businesses`, `outlets`, `profiles`, `memberships`, `employees`, `devices`. Migration + RLS untuk semua tabel.
*Selesai kalau:* migration jalan di Supabase dev, dan ada test yang memverifikasi tidak ada tabel tanpa RLS.

**[x] T07 — Auth & sesi**
Login owner/manajer via Supabase Auth. Login kasir via PIN (bcrypt). Helper `getSession()`, `requirePermission()`.
*Selesai kalau:* user A tidak bisa membaca data bisnis user B — buktikan dengan test.

---

## Fase 1 — POS yang bisa dijual (target 3–4 minggu)

**[ ] T08 — Skema katalog**
`categories`, `products`, `product_variants`, `price_tiers`, `product_prices`, `modifier_groups`, `modifiers`.

**[ ] T09 — CRUD produk**
Halaman dashboard: daftar produk, tambah/edit, kategori, varian, modifier, harga multi-tier.

**[x] T09c — Upload gambar produk**
Bucket Storage `products` privat + RLS path-prefix per `business_id`
(`{business_id}/{product_id}.jpg`, deterministik — ganti gambar = upsert
ke path yang sama, tidak pernah ada file lama tertinggal). Kompresi
client-side (canvas, maks 800px sisi terpanjang, iteratif turun kualitas
sampai ≤500KB), validasi tipe+ukuran diulang di server (`saveProduct`)
sebagai penegakan sungguhan. Tampil di grid kasir (`getPosCatalog` batch
signed URL, bukan N per produk) dengan fallback inisial+warna
deterministik kalau kosong. 2-3 produk demo dapat gambar placeholder
(kotak warna solid, digenerate tanpa dependency baru).

**[x] T10 — Seed data demo (katalog)**
Script seed satu cafe fiktif: 5 kategori, 4 tingkat harga
(DINEIN default, TAKEAWAY, GOFOOD markup 25%, MEMBER), 3 grup modifier
(Level Gula, Suhu, Topping) dengan modifier-nya, dan 25 menu dengan
varian + harga di semua tier. Idempoten, pakai getAdminDb().
Bagian bahan dan resep pindah ke T24b setelah skema inventori ada.

**[ ] T11 — Skema order & shift**
`shifts`, `cash_movements`, `orders`, `order_items`, `order_item_modifiers`, `payment_methods`, `payments`, `refunds`.

**[x] T12 — Layar kasir**
Grid produk, pencarian, kategori, keranjang, modifier, catatan item. Semua kalkulasi memanggil `lib/calc/order-calculator.ts` — **tidak boleh ada aritmetika uang di komponen**.

**[x] T13 — Pembayaran**
Pilih metode, split payment, hitung kembalian, simpan order, generate nomor struk sesuai format `{OUTLET}-{YYMMDD}-{DEVICE}-{COUNTER}`. Idempotency: double tap tidak boleh jadi dua pembayaran. `shiftId`/`cashierId` diisi dari shift aktif sejak T15.

**[x] T14 — Struk**
Template struk 80mm dengan CSS `@page`, tombol cetak. Cetak ulang lewat
halaman "Transaksi Hari Ini" (`/pos/receipt`) — tabel transaksi
`business_date` berjalan (nomor struk, jam, total, metode bayar, saluran),
urut terbaru di atas, tombol "Cetak" per baris ke halaman struk. Kolom
pencarian nomor struk opsional untuk transaksi lama (lintas tanggal).
Ini alat kerja kasir, bukan laporan penjualan (itu T17) — sengaja tetap
ringkas, tanpa filter/paginasi. Ada tombol dari layar kasir ke halaman ini.

**[x] T15 — Shift**
Buka shift: kode karyawan + PIN (`verifyCashierPin`) + modal awal, `businessDate` dari cutoff outlet. Kas masuk/keluar selama shift berjalan. Tutup shift dua langkah: `countedCash` write-once (ditegakkan di server lewat guard `status='open' AND counted_cash IS NULL`, bukan cuma UI) dulu baru `expectedCash`/selisih dihitung & ditampilkan; selisih di atas toleransi outlet (setting `cash_variance_tolerance`, default Rp 20.000) wajib alasan sebelum shift benar-benar closed. Layar kasir (`/pos`) redirect ke `/pos/shift/open` kalau belum ada shift, atau `/pos/shift/close` kalau sedang menunggu alasan. `payOrderWithDb` mengisi `shiftId`/`cashierId` dari shift aktif device, menolak bayar kalau tidak ada.

**[x] T15b — CRUD Karyawan**
Halaman dashboard (`/employees`, permission `employee.manage`): daftar
per outlet, tambah (kode + PIN awal 6 digit), ubah nama/role/outlet,
reset PIN (tidak pernah menampilkan PIN lama, cuma set PIN baru),
buka kunci akun terkunci. Nonaktifkan, bukan hapus — ditolak di server
kalau karyawan sedang punya shift terbuka. Kode karyawan unik per
bisnis. Karyawan nonaktif tidak lolos `verifyCashierPin`.

**[x] T15c — CRUD Perangkat**
Halaman dashboard (`/devices`, permission `employee.manage` -- BLUEPRINT
§7 tidak punya key khusus device, dikelompokkan satu modul dengan
employee/tenancy di M01): daftar device per outlet, tambah, ubah nama/
outlet, nonaktifkan. Tampilkan serial number, `last_seq`, dan kapan
terakhir sinkron. Tidak ada hapus sama sekali -- RLS `devices` cuma
punya policy select/insert/update, master data cuma dinonaktifkan
(CLAUDE.md §3.2) supaya nomor struk lama tetap bisa ditelusuri.
`bootstrap-production.ts` juga diperbaiki supaya bikin satu device
default ("Kasir 1") saat bootstrap -- sebelumnya `/pos` gagal total
di produksi karena device aktif tidak pernah ada sama sekali.

**[x] T16 — Void & refund**
Void order paid (wajib alasan, `pos.void_after_send`), refund sebagian
per item (nominal proporsional dari `order_items.net_amount`, tidak
dihitung ulang dari katalog, `pos.refund`). Keduanya ditolak di server
kalau shift order itu sudah ditutup. Refund pilih metode pengembalian
sendiri (tidak diasumsikan tunai — outlet cashless tidak bisa refund
tunai), total refund per order (termasuk akumulasi) tidak boleh melebihi
total dibayar. Tabel `audit_logs` (append-only) mencatat setiap void dan
refund. Order void tetap tampil di "Transaksi Hari Ini", ditandai badge,
otomatis keluar dari agregasi karena filter `status='paid'`.

**[x] T17 — Laporan penjualan dasar**
`lib/db/queries/sales-report.ts`: `getSalesSummary`, `getSalesByProduct`,
`getSalesByCategory`, `getSalesByCashier`, `getSalesByPaymentMethod`,
`getSalesByChannel`, `getSalesByHour` (timezone bisnis, bukan UTC
server), `getTransactionHistory` dengan filter. Semua filter pakai
`business_date`, bukan `created_at`/`paid_at`. Order void tidak masuk
ringkasan maupun breakdown produk; refund mengurangi net sales di
ringkasan tapi tidak mengubah breakdown per produk (net dari amount
yang ditendang, bukan amount mentah).

**[x] T18 — Dashboard owner**
`(dashboard)/page.tsx` + `components/dashboard/home/*`: omzet hari ini
vs hari yang sama minggu lalu (persen, `percentChange` di `kpi.ts`),
jumlah transaksi, average check, grafik tren 7 hari (`getSalesByDay`,
Recharts), 5 item terlaris, status shift (siapa yang sedang bertugas,
`getOpenShiftsForBusiness`), perbandingan antar outlet kalau bisnis
multi-outlet (`getSalesByOutlet`). Placeholder laba (HPP belum ada,
Fase 2) ditandai jelas, bukan Rp0 yang menyesatkan. Query berat di-stream
lewat Suspense (`deferred-sections.tsx` + `dashboard-skeleton.tsx`)
supaya halaman terasa instan, tidak menunggu semua query sebelum
render pertama.

**[x] T19 — Deploy**
Cloudflare Workers via OpenNext (`@opennextjs/cloudflare`) + project
Supabase produksi terpisah (region Singapore). Migration selalu lewat
`db:migrate`/`db:migrate:prod`, tidak pernah `push` (CLAUDE.md §3.6).
`scripts/bootstrap-production.ts` (idempoten): owner + business +
outlet pertama + metode pembayaran sesuai `cash_enabled` + device
default, baca config dari `scripts/bootstrap-config.json`, password
owner dari env (tidak pernah digenerate+ditampilkan). Secret Cloudflare
lewat `wrangler secret put`, bukan di `wrangler.jsonc`. Storage bucket
`products` + RLS-nya diverifikasi jalan di produksi (T09c). Backup
harian lewat GitHub Actions (`.github/workflows/backup.yml`).

**[x] T18b — Responsif mobile & tablet `/pos` + dashboard**
Rancangan di `docs/04-CATATAN-TEKNIS.md` §14. Breakpoint Tailwind
default (`md`=768px, `lg`=1024px). `/pos` mobile: keranjang jadi
`MobileCartBar` (bar melayang, badge jumlah item + total) yang membuka
`MobileCartSheet` (bottom sheet); grid produk dapat lebar penuh. `/pos`
tablet: dua kolom, keranjang 280px. `/pos` desktop: keranjang 360px
seperti sebelumnya. Tier selector & tab kategori: scroll horizontal
satu baris di SEMUA breakpoint (sebelumnya `flex-wrap` makan sampai 3
baris dengan 15 kategori Indokopi, menyita ruang grid produk bahkan di
desktop). Dashboard: sidebar jadi drawer hamburger di bawah 1024px.
Target sentuh 44px untuk semua tombol `/pos`. **Dikonfirmasi user:
mobile dan tablet sudah benar** -- scroll desktop TIDAK ikut
terselesaikan, dipisah ke T18c karena kasir Indokopi sehari-hari pakai
tablet, bukan desktop.

**[ ] T18c — Perbaikan scroll desktop `/pos`**
Grid produk dan panel keranjang desktop (>1024px) masih tidak bisa
discroll setelah dua kali percobaan perbaikan (rantai `min-h-0`/
`flex-1`/`overflow-y-auto`, lalu percobaan "scroll halaman biasa" yang
malah meregresi keranjang, lalu dikembalikan ke rantai height-chain
semula). **Mobile dan tablet sudah benar sejak T18b** -- masalahnya
spesifik di layout desktop, bukan arsitektur scroll secara umum.
Analisis statis (baca kode) sudah dilakukan berulang tanpa hasil;
kemungkinan penyebabnya baru ketahuan lewat inspeksi computed style
langsung di DevTools (leluhur tak dikenal yang membentuk containing
block baru -- dicurigai sejak catatan di `cart-panel.tsx`), bukan
tebakan lagi dari pembacaan kode. Prioritas rendah untuk sekarang
karena Indokopi jual lewat tablet, bukan desktop.

**[ ] T19b — Lupa password owner**
Ditemukan saat bootstrap produksi (T19): satu-satunya jalan pemulihan
password owner sekarang adalah Supabase Dashboard (operator manual,
klien tidak bisa lakukan sendiri). Butuh alur "lupa password" biasa
(reset via email) sebelum benar-benar diserahkan ke klien yang tidak
punya akses dashboard Supabase.

**[ ] T20 — Uji lapangan**
Pasang paralel di cafe pilot selama seminggu, jalan bersama sistem lama mereka. Catat semua keluhan. Ini lebih berharga dari dua minggu coding.

---

## Fase 2 — Inventori & HPP (setelah klien pilot puas)

T21 skema inventori · T22 CRUD bahan & satuan · T23 resep/BOM · T24 pembelian & supplier ·
T25 pemotongan stok otomatis saat bayar · T26 opname · T27 waste · T28 laporan stok & variance

> Urutan detail (beda dari ringkasan satu baris di atas, ditulis setelah
> data lapangan Indokopi mengubah prioritas) ada di
> `docs/05-RENCANA-FASE-2.md`: T21 sekarang mencakup CRUD bahan & satuan
> sekaligus, T22 jadi penerimaan barang dari gudang (bukan resep), resep/
> HPP mundur ke akhir. Baris ringkasan di atas sengaja tidak ditulis ulang
> di sini supaya satu dokumen (05) jadi sumber kebenaran urutan, bukan dua
> tempat yang bisa berbeda.

**[x] T22b — Halaman kelola outlet**
Ditemukan saat T22 (penerimaan gudang): outlet gudang pusat sengaja
dibuat lewat `bootstrap-production.ts` (sekali, saat setup), bukan
dashboard -- karena belum ada halaman kelola outlet sama sekali. Owner
yang buka cabang kedua tidak boleh perlu menghubungi developer untuk itu
-- kekurangan yang sama seperti karyawan (T15b) dan perangkat (T15c)
dulu sebelum keduanya dapat halaman sendiri.

Dikerjakan lebih awal dari urutan §8.g (T22a-T22-T22d-T22c-T22b) di
`docs/05-RENCANA-FASE-2.md` -- sengaja dimajukan sambil menunggu
konfirmasi owner soal alur dua sisi (§8), karena outlet gudang tetap
perlu dibuat lewat dashboard apa pun jawabannya. Cakupan: daftar,
tambah (owner-only, permission `settings.business`), ubah (owner+
manajer, permission BARU `outlet.manage` -- belum ada di tabel
BLUEPRINT §7, ditambahkan T22b), nonaktifkan (ditolak kalau outlet
sedang punya shift terbuka). Tidak ada hapus permanen. Peringatan
eksplisit di form untuk field berdampak struk/legal (pajak, service
charge), field yang mengubah perilaku sistem (is_central_kitchen), dan
perubahan day_cutoff_time pada outlet yang sudah punya transaksi.

**[x] T22a — Brand (label/laporan) + product_outlets (ketersediaan katalog kasir)**
Prasyarat sebelum Indosteak bisa digabung ke business yang sama
(`docs/05-RENCANA-FASE-2.md` §8.a/§8.b). Tabel `brands` (cuma label +
pengelompokan laporan per brand) DAN tabel terpisah `product_outlets`
(SATU-SATUNYA yang menentukan ketersediaan produk per outlet -- KOREKSI
dari rencana awal yang salah memakai `brand_id` untuk ini, dibatalkan
setelah field data: menu Indokopi sengaja dijual di outlet Indosteak
untuk promosi, ada snack yang beririsan antar brand). Aturan baca
`product_outlets`: produk TANPA baris = tersedia di SEMUA outlet
(default), produk yang PUNYA baris = HANYA outlet yang punya barisnya
(whitelist). `outlets.brand_id` wajib diisi (di-backfill dari nama
bisnis untuk data yang sudah ada, tidak perlu migrasi data manual);
`products.brand_id` nullable. Trigger cross-tenant baru:
`check_outlet_brand_business_id`, `check_product_brand_business_id`,
`check_product_outlet_business_id` (migration 0021, pola sama T21/T22).
Katalog kasir (`get-pos-catalog.ts`) dan form produk (brand + checklist
outlet) sudah disambungkan.

**[x] T22e — POS harus tahu device ini mewakili outlet yang mana**
Ditemukan saat mengerjakan T22a: `getPosCatalog()` dan 4 halaman lain
(`shift/open`, `shift/close`, `receipt/page`, `receipt/list-orders`)
masing-masing menebak sendiri "outlet aktif pertama business ini" --
benar secara kebetulan dengan satu outlet, salah total begitu ada dua.

Diselesaikan lewat `lib/pos/device-pairing.ts` -- pairing SEKALI per
tablet, tersimpan cookie httpOnly (`pos_device_id`, TIDAK PERNAH
ditebak/dipilih ulang tiap shift), divalidasi ulang ke tabel `devices`
di SETIAP request (device dinonaktifkan/dihapus/pindah bisnis otomatis
dianggap belum ter-pairing). Halaman baru `/pos/setup` (gerbang
`employee.manage`, sama seperti `/devices`) untuk memasangkan; kelima
tempat yang dulu menebak sekarang satu sumber kebenaran ini.

Tiga penyempurnaan dari diskusi sebelum eksekusi:
1. **Pemulihan kalau cookie hilang** (cache dibersihkan/tablet
   di-reset/incognito): localStorage menyimpan PETUNJUK (bukan sumber
   kebenaran, server selalu validasi ulang lewat cookie) -- siapa pun
   yang duduk di kasir (termasuk tanpa `employee.manage`) tetap melihat
   "sebelumnya terhubung sebagai X di outlet Y, hubungi manajer", bukan
   halaman kosong.
2. **Deteksi tabrakan**: kolom baru `devices.last_paired_at` (migration
   0022) + peringatan (non-blocking) kalau device yang sedang
   dipasangkan SAAT INI punya shift terbuka -- indikasi kuat ada tablet
   lain yang masih memakainya, nomor struk (`last_seq`) dan stok bisa
   bentrok.
3. **Label permanen di layar kasir**: "{outlet} · {device}" kecil di
   header `/pos` dan subtitle `shift/open`/`shift/close` -- kasir sadar
   tabletnya salah pasang SEBELUM transaksi, bukan setelah stok
   terpotong dari outlet keliru.

Dibuktikan lewat Playwright sungguhan (bukan cuma typecheck): device
dipasangkan ke outlet KEDUA (bukan outlet pertama yang dibuat) resolve
benar; kasir tanpa izin yang membuka `/pos` tanpa pairing melihat pesan
jelas, bukan crash; localStorage hint bertahan lewat cookie yang
dihapus paksa dan tampil ke user tanpa izin sekalipun. Test unit
(`lib/pos/__tests__/device-pairing.test.ts`) membuktikan penolakan
device lintas-bisnis dan peringatan tabrakan shift-terbuka.

**[x] T22 — Transfer stok dua sisi: request → approve/reject → send → receive**
Menggantikan T22 v1 (satu langkah, langsung 'received' saat dibuat)
sepenuhnya, sesuai §8 di `docs/05-RENCANA-FASE-2.md`. Approve MURNI
keputusan ya/tidak (tidak menetapkan angka apa pun -- angka pertama
dikunci di send). `sent_qty` (gudang, saat kirim) dan `received_qty`
(outlet, saat terima) dua kolom terpisah -- alasan wajib server-side
kalau `sent_qty != requested_qty` (kenapa gudang mengirim beda dari
yang diminta) MAUPUN kalau `received_qty != sent_qty` (selisih di
jalan), dicatat sebagai movement `transfer_loss` bernilai rupiah yang
SENGAJA TIDAK mengubah saldo siapa pun -- lihat
`docs/04-CATATAN-TEKNIS.md` §18 sebelum menyentuh bagian itu.

Tiga syarat adopsi (bukan pelengkap, instruksi eksplisit pemilik --
mereka pakai WhatsApp sekarang, kalau sistem lebih ribet mereka kembali
ke WA): halaman request satu layar (pilih bahan, ketik jumlah, kirim,
tanpa field wajib lain), tombol "Ulangi Permintaan Terakhir" (isi form
dari request terakhir outlet yang sama), dan approve/send yang
baris-barisnya SUDAH terisi sesuai permintaan/persetujuan (tinggal
konfirmasi kalau tidak ada yang berubah, bukan diketik ulang).

Trigger baru menggantikan cancel-only v1: `check_stock_transfer_transition`
(state machine penuh -- transisi mana yang valid dari status mana, dan
kolom mana yang boleh berubah per transisi) dan
`check_transfer_item_immutable_core` (field permintaan awal terkunci
selamanya). Migration 0023+0024 (dipecah dua supaya `drizzle-kit
generate` tidak minta prompt rename interaktif yang tidak tersedia di
lingkungan kerja ini) sudah di prod, termasuk backfill data v1 (anggap
outlet "minta" dan gudang "kirim" persis sejumlah yang dulu tercatat
diterima -- satu-satunya angka yang ada dari sistem lama).

Badge jumlah "menunggu persetujuan" di nav dashboard (tampil di semua
halaman, bukan cuma `/stock-transfers`) + kolom "menunggu sejak" yang
ditandai merah kalau lewat `businesses.transfer_request_alert_hours`
(default 4 jam, elapsed wall-clock sederhana bukan kalender jam
operasional) -- lihat T26b untuk kenapa notifikasi dorong beneran
belum dibangun sekarang.

**[ ] T26b — Notifikasi dorong permintaan transfer (push browser atau WhatsApp)**
Ditemukan saat T22: badge in-app + kolom "menunggu sejak" (sudah
dibangun, lihat T22 di atas) cukup KALAU gudang sudah membuka
dashboard secara rutin, tapi TIDAK proaktif seperti WhatsApp (HP
berbunyi tanpa perlu buka apa pun). Solusi yang benar-benar setara WA
butuh dependency/infrastruktur baru yang belum ada di stack ini (push
notification browser, atau integrasi WhatsApp Business API) --
SENGAJA belum dibangun sekarang, keputusan pemilik: lihat dulu apakah
badge cukup dari pemakaian nyata Indokopi, baru putuskan perlu ini
atau tidak. Pola sama seperti T26 (notifikasi stok menipis) yang juga
sengaja MVP-in-app-dulu.

**[ ] T24b — Seed data demo (bahan & resep)**
30 bahan dengan satuan dan konversi, resep untuk 25 menu dari T10,
termasuk satu sub-resep semi-finished untuk menguji rekursi.

## Fase 3 — Laba bersih

T29 karyawan & absensi · T30 payroll · T31 beban operasional & aset ·
T32 laporan Laba Rugi · T33 dashboard KPI

**[ ] T34 — Export laporan ke Excel (.xlsx)**
Permintaan eksplisit owner (temuan lapangan putaran 3,
`docs/05-RENCANA-FASE-2.md` §8 poin 10). Semua laporan penjualan, stok,
dan keuangan bisa diunduh sebagai `.xlsx` yang rapi (format, bukan CSV
mentah) -- bukan cuma laporan yang sudah ada saat tugas ini dikerjakan,
tapi pola yang dipakai ulang untuk laporan baru berikutnya juga.
Ditaruh di AKHIR Fase 3 (bukan Fase 2) karena baru masuk akal setelah
seluruh jenis laporan (penjualan, stok/variance, Laba Rugi, KPI) sudah
ada untuk diekspor -- mengerjakannya lebih awal berarti mengekspor
laporan yang belum lengkap. **Belum dikerjakan, jangan mulai sebelum
diminta eksplisit.**

> Penomoran: T30 sudah dipakai untuk payroll di Fase 3 -- tugas ini diberi
> nomor T34 (lanjutan T29-T33), bukan T30, supaya tidak tabrakan.

---

## Aturan main

- Jangan lompat fase. Godaan terbesar adalah bikin UI cantik sebelum logikanya benar.
- Tugas yang terasa butuh lebih dari satu sesi agent, pecah dulu jadi dua.
- Kalau satu tugas macet lebih dari dua jam, itu tanda spesifikasinya kurang jelas — perbaiki dokumen, jangan paksa agent menebak.

---

## Fase 6 — Order Mandiri Pelanggan (belum dijadwalkan)

**[ ] T50 — Kiosk / QR Order**
Layar untuk pelanggan memesan sendiri, terpisah dari layar kasir.
- Mode tanpa login, sesi per meja atau per nomor antrean
- Katalog, modifier, dan kalkulator dipakai ulang dari Fase 1
- Status order baru 'pending_confirmation' sebelum masuk 'open'
- Kasir punya layar antrean untuk konfirmasi dan tarik order ke pembayaran
- Nomor antrean dicetak untuk pelanggan, order menunggu di kasir

Catatan: ini produk terpisah dari layar kasir. Layar kasir (`/pos`) tetap
untuk staf. Jangan digabung.
