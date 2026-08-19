# 05 — Rencana Fase 2 (revisi setelah data lapangan Indokopi)

> Status: T21, T22b, T22a, T22e & T22 selesai. §8 (pivot dua brand + alur dua
> sisi + pengolahan gudang), termasuk koreksi putaran 3 (§8.b
> ketersediaan produk, §8.c risiko adopsi/UX request) **sudah disetujui
> penuh** — lihat §8.9 dan §9. **T22d (barang masuk gudang) berikutnya** --
> prasyarat T22c karena butuh stok gudang untuk diuji.

---

## 1. Kenapa rencana lama diubah

Data lapangan dari Indokopi (sistem lama mereka, dipakai bertahun-tahun):

- Gudang pusat, stok dikirim ke outlet.
- Sistem lama punya dua mode: material/resep, dan stok sederhana.
- **Stok opname melenceng ~90% dan berulang selama 3-4 bulan.**
- Akibatnya: menu terblokir tidak bisa dijual padahal barang fisik ada.
- Karena stok kacau, cost tidak pernah jelas.
- Mereka tidak pernah menghitung modal per gelas — harga jual ditentukan
  dengan membandingkan cafe lain.

**Diagnosis:** masalah utamanya bukan rumus HPP. Masalahnya adalah stok yang
tidak pernah bisa dipercaya angkanya, sampai-sampai owner menyerah dan tidak
pernah mencoba menghitung cost sama sekali. HPP yang "tidak pernah dihitung"
di Indokopi adalah **gejala** dari ketidakpercayaan itu, bukan sebab.

Rencana Fase 2 yang lama (`docs/01-TASK-BOARD.md`: T21 skema → T22 CRUD bahan
→ T23 resep/BOM → T24 pembelian → T25 potong stok → T26 opname → T27 waste →
T28 laporan) menaruh resep/HPP di awal dan opname/waste di akhir — urutan
yang masuk akal kalau tujuannya "menghitung HPP secepat mungkin", tapi salah
kalau tujuan sebenarnya adalah **membuat owner percaya lagi pada angka
stoknya**. Dokumen ini menata ulang urutannya berdasarkan itu.

---

## 2. Yang SUDAH ada, jangan dibangun ulang

Penting ditulis eksplisit supaya tidak ada yang membangun ulang sesuatu yang
sudah selesai dan teruji:

- **`docs/BLUEPRINT.md` §3.3 (M05 — Inventory, Resep & HPP)** sudah punya
  skema SQL lengkap: `units`, `ingredients`, `stock_levels`, `stock_movements`
  (ledger append-only, `movement_type` enum sudah mencakup
  `purchase/sale/waste/opname_adjust/transfer_in/transfer_out/production_in/
  production_out/refund_in/initial/manual_adjust`), `recipes`,
  `recipe_items`, `suppliers`, `purchases`, `purchase_items`,
  `stock_opnames`, `opname_items`, `waste_logs`, `stock_transfers`,
  `stock_transfer_items`. Rencana ini **memakai skema itu**, bukan
  menggantinya — lihat §3 untuk penyesuaian kecil yang perlu ditambahkan.
- **`lib/calc/cogs.ts` (T04) sudah dibangun dan lolos test** (TC-08 s.d.
  TC-12 di `docs/03-CALC-SPEC.md` bagian B): HPP dari resep, rekursif untuk
  bahan semi-finished, WAC (weighted average cost), alokasi ongkir,
  variance. **Kalkulatornya sudah beres — yang belum ada cuma data stok
  yang layak dimasukkan ke dalamnya.** Ini alasan teknis kenapa resep/HPP
  aman ditaruh paling akhir: begitu ledger-nya jalan dan dipercaya,
  menyambungkan HPP tinggal manggil fungsi yang sudah ada.
- **RBAC untuk semua aksi stok sudah didefinisikan** di
  `src/lib/auth/permissions.ts`: `stock.purchase`, `stock.opname_input`,
  `stock.opname_approve`, `stock.waste`, `stock.transfer` — semua sudah
  punya baris matriks role yang terisi (bukan placeholder). Tidak perlu
  permission key baru untuk apa pun di rencana ini.

---

## 3. Penyesuaian terhadap skema BLUEPRINT (butuh keputusan Anda — lihat §6)

Skema BLUEPRINT sudah 90% cocok. Tiga penyesuaian konkret yang diminta data
lapangan:

**3.1 Kategori waste** — `waste_logs.reason` di BLUEPRINT saat ini:
`'expired','damaged','spill','staff_meal','complimentary','training'`.
Diminta: tumpah, **gagal produksi**, kedaluwarsa, minuman staf, komplimen,
tester. "Gagal produksi" (barista salah bikin, over-extract, dll — minuman
jadi yang harus dibuang) beda dari "damaged" (barang rusak/pecah) — ini
kategori BARU, bukan cuma ganti nama. Set akhir yang diusulkan:
`spill, failed_production, expired, staff_drink, complimentary, tester`.
`waste_logs` sudah punya `product_id` (waste produk jadi) DAN
`ingredient_id` (waste bahan mentah) terpisah — "gagal produksi" akan pakai
`product_id`.

**3.2 Opname: alasan wajib kalau ada selisih** — `opname_items.note` di
BLUEPRINT nullable, tidak ada aturan yang memaksanya diisi. Field data:
*"Opname dengan selisih WAJIB beralasan, dan nilai selisihnya dicatat
sebagai kerugian. Bukan sekadar menyamakan angka."* Ini HARUS ditegakkan di
server (bukan cuma validasi UI) — pola yang sama seperti write-once
`counted_cash` di T15: guard eksplisit sebelum baris opname bisa disimpan,
bukan cuma `required` di form.

**3.3 Gudang pusat sebagai sumber transfer** — `stock_transfers` di
BLUEPRINT sudah `from_outlet_id`/`to_outlet_id` (keduanya `references
outlets(id)`) — secara teknis SUDAH cukup untuk alur "gudang kirim ke
outlet" **kalau** gudang pusat dimodelkan sebagai satu baris di tabel
`outlets` (tanpa device/POS terpasang). Tabel `outlets` saat ini tidak
punya kolom pembeda "ini gudang, bukan toko" — lihat pertanyaan terbuka §6.1
untuk dua opsi.

---

## 4. Keputusan desain yang tidak boleh dilanggar (sudah dicek kompatibel dengan skema BLUEPRINT)

- **Stok nol atau minus TIDAK memblokir penjualan.** Movement `sale` tetap
  ditulis ke ledger walau `qty_on_hand` hasilnya negatif — dicatat +
  peringatan, transaksi tetap jalan. Dicek: `stock_levels.qty_on_hand` di
  BLUEPRINT **tidak punya CHECK constraint** yang memaksa non-negatif — skema
  sudah kompatibel, ini murni aturan di layer aplikasi (fungsi pemotongan
  stok saat bayar tidak pernah melempar error karena stok kurang, cuma
  menulis movement + flag).
- **Konversi satuan mustahil salah.** Semua stok tersimpan dalam
  `base_unit` (BLUEPRINT sudah begitu). Input SELALU di `purchase_unit` (atau
  satuan lain yang dipilih user), dikonversi otomatis via `units.factor`,
  dan **hasil konversinya ditampilkan ke user sebelum disimpan** (bukan
  disimpan diam-diam) — supaya user bisa mengoreksi kalau salah pilih
  satuan, sebelum jadi baris ledger permanen (append-only, tidak bisa
  diedit setelah tersimpan).

---

## 5. Urutan tugas (prioritas kepercayaan dulu, HPP terakhir)

Estimasi kasar per tugas, asumsi satu sesi kerja fokus per beberapa hari
(pola sama seperti Fase 0/1 — kalkulator/aturan dulu ditulis test-nya,
implementasi baru nanti untuk yang menyentuh angka finansial). **Total
kasar: 5-7 minggu.**

**T21 — Skema inventori inti + CRUD bahan & satuan** *(3-5 hari)*
`units`, `ingredients`, `stock_levels`, `stock_movements` (ledger,
append-only, tidak pernah UPDATE/DELETE — koreksi = movement baru, sudah
aturan CLAUDE.md §3.2). CRUD dashboard minimal untuk bahan + satuan +
konversi — wajib ada duluan secara teknis sebelum ledger bisa dites
sungguhan (tidak bisa mencatat mutasi bahan yang belum terdaftar).
`base_unit` terkunci setelah ada movement yang mereferensikannya (pola sama
kode karyawan/serial perangkat — identitas, bukan sekadar label).

**T22 — Penerimaan dari gudang (transfer masuk)** *(3-4 hari)*
**Prioritas tertinggi setelah T21** — ini "tersangka utama" penyebab
desync 90% menurut data lapangan. `stock_transfers` + `stock_transfer_items`
(BLUEPRINT). Alur SEUTUHNYA sederhana: pilih bahan, qty terima (input di
satuan beli, konversi ke base unit ditampilkan sebelum simpan), nomor
dokumen referensi (surat jalan/DO), catatan opsional. Setiap baris terima =
satu `stock_movement` (`transfer_in`), `balance_after` tercatat otomatis di
ledger (bukan dihitung ulang tiap query).

**T23 — Kartu stok per bahan** *(2-3 hari)*
Laporan murni baca dari `stock_movements` (tidak ada tabel baru) — riwayat
mutasi per bahan per outlet, urut waktu, saldo berjalan langsung dari
`balance_after` yang sudah tersnapshot di ledger. Filter tanggal + jenis
movement + alasan. Ini alat TELUSUR MUNDUR untuk menemukan titik awal
penyimpangan — harus cepat dibuka dan gampang dibaca staf gudang, bukan
cuma developer.

**T24 — Waste** *(2-3 hari)*
`waste_logs`, kategori sesuai §3.1. Waste bahan mentah atau produk jadi
(skema sudah mendukung keduanya). Setiap waste = `stock_movement` (`waste`,
qty negatif) + `total_cost` dari `avg_cost` saat ini.

**T25 — Opname dengan alasan wajib** *(4-5 hari)*
`stock_opnames` + `opname_items` (BLUEPRINT) + penegakan §3.2 (alasan wajib
kalau `variance_qty != 0`, ditolak di server). `variance_value` dicatat
jelas sebagai kerugian (field sudah ada di skema) — laporannya masuk P&L
nanti di Fase 3, tapi PENCATATANNYA harus benar dari awal supaya tidak perlu
migrasi data ulang nanti.

**T26 — Notifikasi** *(2-3 hari)*
Stok menipis (`qty_on_hand <= min_stock`), stok minus (`qty_on_hand < 0`),
selisih opname di atas ambang. **MVP: panel alert di dashboard, query
langsung dari `stock_levels`/`opname_items`** — TIDAK ada tabel
`notifications` baru, tidak ada push/email dulu. Cukup untuk skala sekarang;
kalau nanti butuh push/email, itu perubahan terpisah, bukan bagian dari
fondasi kepercayaan stok ini.

**T27 — Resep/BOM + sambungkan HPP** *(5-6 hari)*
`recipes` + `recipe_items` (BLUEPRINT, sudah mendukung sub-resep
semi-finished rekursif). CRUD resep per produk/varian. Pemotongan stok
otomatis saat bayar (`sale`, dari `recipe_items × qty terjual`, TIDAK
blokir penjualan kalau stok kurang — §4). HPP per produk tinggal memanggil
`lib/calc/cogs.ts` yang **sudah ada dan sudah lolos test** — bagian
"kalkulator" dari tugas ini sebenarnya sudah selesai sejak T04, yang
dikerjakan di sini murni menyambungkannya ke data resep + ledger yang baru
dipercaya.

**T27b (BARU, ditemukan saat T22a) — Peringatan stok menipis di layar
kasir** *(1-2 hari)*
Dikonfirmasi saat T22a: layar kasir SAMA SEKALI tidak menampilkan stok
hari ini -- `PosProduct` (`get-pos-catalog.ts`) tidak punya field stok
apa pun, `product-card.tsx`/`product-grid.tsx` tidak merender apa pun
terkait stok. Kasir baru tahu bahan habis SETELAH menerima pesanan yang
ternyata tidak bisa dibuat. Diletakkan SETELAH T27 (bukan lebih awal)
karena baru bisa akurat begitu `recipe_items` menghubungkan produk ke
bahan -- sebelum itu tidak ada cara tahu "produk X butuh bahan apa saja"
untuk dicek. Desain: badge/indikator visual di kartu produk kalau SALAH
SATU bahan resepnya (dari `stock_levels.qty_on_hand`) di bawah/sama
dengan `min_stock`, atau sudah negatif -- **TIDAK memblokir tap/pesan**
(keputusan §4 berlaku sama persis di sini: stok minus tidak pernah
memblokir penjualan, cuma peringatan). Kasir tetap bisa memesan produk
yang stoknya menipis/habis; keputusan lanjut-atau-tidak tetap di tangan
kasir/manajer di lapangan (mis. cek fisik dulu), sistem cuma memberi
info lebih awal dari sebelumnya (sebelumnya: tidak ada info sama
sekali).

**T28 — Laporan stok & variance teoritis vs aktual** *(3-4 hari)*
Pemakaian teoretis (resep × qty terjual) vs aktual (ledger: stok awal +
pembelian − stok akhir opname). Laporan waste per alasan/bahan/tren.
Laporan margin HPP per produk.

**T24b (sudah tercatat di `01-TASK-BOARD.md`) — Seed data demo (bahan &
resep)** tetap di posisi SETELAH T27 (butuh resep untuk seed, bukan
sebelumnya).

---

## 6. Pertanyaan terbuka — butuh keputusan Anda sebelum T21 mulai

**6.1 Gudang pusat: dimodelkan sebagai apa? — SUDAH DIPUTUSKAN, beda dari draft awal di bawah**
~~Opsi A/B di bawah ini~~ digantikan keputusan sungguhan: pakai kolom
`outlets.is_central_kitchen` yang SUDAH ADA sejak T06 (BLUEPRINT §3.1) dan
belum pernah dipakai — bukan kolom baru `outlets.type`. Alasan: menambah
kolom kedua yang menyatakan hal serupa menciptakan dua sumber kebenaran.
Sudah dibangun (T22, migration 0017/0019). Draft asli dibiarkan di bawah
sebagai jejak keputusan, bukan dihapus:

<details>
<summary>Draft opsi asli (sudah tidak dipakai)</summary>

- **Opsi A (simpel, tanpa migrasi baru):** gudang jadi satu baris biasa di
  tabel `outlets`, tidak pernah diberi device/POS. Risiko: halaman yang
  mengasumsikan "semua outlet = titik jual" (mis. dropdown filter laporan
  penjualan) bisa ikut menampilkan "Gudang Pusat" sebagai pilihan yang
  membingungkan.
- **Opsi B (lebih bersih, satu migrasi kecil):** tambah kolom
  `outlets.type` (`'retail' | 'warehouse'`), filter eksplisit di
  dropdown-dropdown yang seharusnya cuma menampilkan toko.
- Rekomendasi: **Opsi B** — biaya migrasinya kecil, dan mencegah kebingungan
  yang sama persis dengan yang sedang coba diperbaiki (data yang membingung-
  kan operasional).

</details>

**6.2 Opname butuh approval manajer, atau cukup staf gudang input langsung?**
BLUEPRINT sudah punya alur `draft → submitted → approved` dan permission
`stock.opname_approve` terpisah dari `stock.opname_input` — tapi data
lapangan tidak menyebutkan apakah Indokopi mau pakai approval atau langsung.
Ini mempengaruhi kompleksitas UI T25 secara langsung (satu langkah vs dua
langkah dengan status).

**6.3 Ambang notifikasi (T26)** — "stok menipis" butuh `min_stock` per
bahan (sudah ada kolom di `stock_levels`, owner yang isi per bahan). "Selisih
opname di atas ambang" butuh angka batas — nominal rupiah tetap (mis.
Rp 50.000), atau persentase dari nilai stok bahan itu? Tidak ada info dari
lapangan soal ini, jangan ditebak.

**6.4 (baru, diangkat saat CRUD ingredients T21) — Satu bahan, beberapa
kemasan beli berbeda: apakah `purchase_unit` tunggal per ingredient cukup?**
Desain saat ini (`ingredients.purchase_unit` + `purchase_factor`, satu
nilai per bahan) mengasumsikan satu bahan selalu dibeli dalam SATU jenis
kemasan. Tapi kasus seperti susu UHT — kadang dibeli per liter, kadang
per dus isi 12 — punya DUA rasio konversi berbeda untuk bahan yang sama.
Skema sekarang tidak bisa menangkap ini tanpa salah satunya dipaksakan
tidak akurat.

Ini relevan untuk T22 (penerimaan dari gudang, mekanisme stok-masuk yang
memang sudah direncanakan) dan untuk pembelian dari supplier eksternal
kalau/kapan itu jadi kebutuhan nyata (§7). Belum diputuskan solusinya
sekarang — opsi kasar yang perlu Anda konfirmasi nanti dengan Indokopi:
(a) `ingredients` boleh punya beberapa baris "kemasan beli" per bahan
(perlu tabel baru, mis. `ingredient_purchase_units`), atau (b) form
penerimaan/pembelian membiarkan pilih satuan APA PUN dari `units` lalu
konversi manual per baris (fleksibel tapi lebih rawan salah ketik --
persis masalah yang sedang dihindari), atau (c) kalau ternyata jarang
terjadi di praktik, cukup catat sebagai keterbatasan yang diterima.
**Jangan diselesaikan sekarang** -- tanyakan ke user saat sampai di T22,
setelah dikonfirmasi ke Indokopi apakah pola beli-kemasan-ganda ini
benar terjadi.

---

## 7. Yang TIDAK dikerjakan dulu (tetap di rencana lama, tidak berubah urutannya)

`purchases`/`purchase_items`/`suppliers` (pembelian dari supplier EKSTERNAL,
beda dari T22 yang internal gudang→outlet) sengaja tidak dimasukkan ke
urutan revisi ini — field data cuma menyebutkan "gudang pusat kirim ke
outlet", tidak menyebutkan pola pembelian ke supplier luar. Kemungkinan
gudang pusat sendiri yang beli dari supplier (di luar cakupan sistem ini
untuk sekarang, kalau gudang tidak pakai outlet POS) — perlu dikonfirmasi
kalau/kapan ini jadi kebutuhan nyata, jangan dibangun spekulatif sekarang.

---

---

## 8. Data lapangan lanjutan (setelah T22 mulai diverifikasi) — dua brand, alur dua sisi, pengolahan gudang

Temuan baru dari klien, SETELAH T21 selesai dan T22 (versi satu-langkah)
sudah diverifikasi lewat browser. Ini membatalkan beberapa keputusan T22
yang sudah dibangun — bukan berarti pekerjaan itu sia-sia (lihat §8.7),
tapi arahnya berubah. **Belum ada kode yang disentuh untuk bagian ini.**

**Ringkasan temuan:**
1. Satu pemilik, dua brand (Indokopi/cafe, Indosteak/resto), berbagi SATU
   gudang pusat. Fokus sekarang Indokopi, tapi harus disiapkan untuk
   keduanya sejak awal (bukan ditambal belakangan).
2. Alur barang yang diinginkan DUA SISI: outlet request → gudang approve
   → gudang kirim → outlet terima. Tanpa approve, stok tidak bertambah.
   Siapa request/kirim/approve harus terlihat.
3. Pengolahan di gudang (bahan mentah → siap pakai, mis. ayam 5 kg → 20
   porsi) TIDAK TERCATAT sama sekali di sistem lama — **kemungkinan besar
   sumber utama desync 90%**, bukan cuma kesalahan opname biasa.
4. Material sudah dalam satuan "porsi" (bukan gram/ml mentah). Cost =
   harga di gudang (biaya menghasilkan 1 porsi). Modal outlet = harga
   porsi itu saat diterima dari gudang.
5. "Recycle Bin" — lokasi/konsep untuk barang basi/rusak, dinilai sebagai
   kerugian.

**Ringkasan temuan putaran ketiga** (setelah T22a mulai dikerjakan, T22b
selesai) -- detail lengkap masing-masing ada di subbagian terkait, ini
cuma daftar cepat:
6. **KOREKSI §8.b**: brand TIDAK menentukan ketersediaan produk di
   katalog kasir -- itu keputusan salah dari putaran sebelumnya, dibatal-
   kan. Menu Indokopi sengaja dijual di outlet Indosteak sebagai
   perkenalan brand, ada snack yang beririsan. Ketersediaan sekarang
   pakai tabel `product_outlets` terpisah dari `brand_id`. Detail: §8.b.
7. **Terkonfirmasi**, bukan lagi asumsi: sistem lama punya "request" tapi
   TIDAK punya "receive" -- ini penyebab langsung lubang yang §8.h coba
   tutup. Tim gudang akan memakai sistem. Detail: §8.c.
8. **Risiko adopsi**: mereka minta stok lewat WhatsApp sekarang. Kalau
   alur request di sistem lebih ribet dari ngetik WA, mereka kembali ke
   WA dan alur dua sisi ini kosong. Halaman request wajib sangat ringan
   (target <30 detik utk 5 bahan) + tombol "ulangi permintaan terakhir".
   Detail: §8.c.
9. **Skala dikonfirmasi**: 2 outlet Indosteak, 1 outlet Indokopi, 1
   gudang pusat (4 outlet total, cocok dengan asumsi §8.a). Jumlah menu
   belum diketahui pasti, tapi "cukup banyak" -- tidak mengubah desain,
   dicatat untuk konteks skala saja.
10. **Tugas baru** (dicatat di task board, TIDAK dikerjakan sekarang):
    export laporan ke .xlsx, permintaan eksplisit owner. Lihat
    `docs/01-TASK-BOARD.md` T34.

### 8.a Model tenancy — satu business, banyak outlet

**Rekomendasi: satu `businesses` row, empat (atau lebih) `outlets`** —
Gudang Pusat, Indokopi, Indosteak Cempaka Putih, Indosteak Pakansari.
Bukan dua `businesses` terpisah.

Alasan: trigger `check_ingredient_outlet_business_id` dan
`check_transfer_outlet_business_id`/`check_transfer_item_business_id`
(T21/T22) sengaja menolak memasangkan bahan/outlet lintas `business_id`
— itu untuk mencegah kebocoran data ANTAR PELANGGAN SaaS yang berbeda
(BLUEPRINT §9.5, tenant isolation). Indokopi dan Indosteak BUKAN dua
pelanggan berbeda — satu pemilik, satu operasi, kebetulan dua nama
dagang yang berbagi infrastruktur (gudang). Itu persis definisi "satu
business dengan banyak outlet" yang sistem ini sudah dirancang untuk
menangani sejak awal, bukan kasus baru.

**Konsekuensi untuk data Indokopi yang sudah ter-bootstrap:** kecil,
TIDAK ADA migrasi data. `businesses`, outlet Indokopi, karyawan, produk,
bahan yang sudah ada tetap seperti apa adanya — business_id-nya tidak
berubah. Yang ditambahkan cuma outlet BARU (Gudang Pusat, dua outlet
Indosteak) ke business_id yang SAMA, lewat mekanisme yang sudah ada
(`bootstrap-production.ts`, atau T22b kalau halaman kelola outlet sudah
jadi). Satu-satunya hal yang mungkin perlu diubah: nama `businesses.name`
kalau "Indokopi" dirasa tidak lagi mewakili (opsional, sekadar label,
tidak ada yang bergantung padanya secara struktural) — bisa diganti nama
badan usaha/holding kalau owner mau, atau dibiarkan.

**KEPUTUSAN (§8.9 no. 1 & 7g):** disetujui satu business, banyak
outlet. Laporan Laba Rugi Fase 3 **harus bisa dipisah per brand** --
dua brand ini punya struktur biaya berbeda, digabung bikin keduanya
tidak terbaca. Tapi cukup **filter di laporan yang sudah direncanakan**
(`GROUP BY`/`WHERE brand_id` di laporan P&L Fase 3 yang sama), BUKAN
membangun laporan terpisah/duplikat. Ini konsisten dengan §8.b —
`brand_id` sebagai kolom filter, bukan alasan memecah fitur.

### 8.b Ketersediaan produk per outlet — KOREKSI dari keputusan awal: dua konsep terpisah

> **KOREKSI (setelah data lapangan lanjutan):** keputusan awal di bawah ini
> ("`brand_id` menentukan ketersediaan produk di katalog kasir") SALAH,
> dibatalkan. Field data baru: menu Indokopi SENGAJA dijual di dalam
> outlet Indosteak sebagai perkenalan brand, dan ada snack yang beririsan
> antar brand. Brand dan ketersediaan produk adalah DUA HAL BERBEDA yang
> kebetulan sering (tapi tidak selalu) sejalan -- tidak boleh dipakai satu
> kolom untuk mewakili keduanya. Desain final ada di bawah "KEPUTUSAN
> FINAL". Draft awal (yang salah) dibiarkan di bawahnya sebagai jejak,
> bukan dihapus -- sama perlakuan seperti draft §6.1.

**KEPUTUSAN FINAL — dua konsep terpisah, bukan satu:**

1. **`products.brand_id`** (nullable) — CUMA untuk label dan laporan per
   brand (§8.a). TIDAK mempengaruhi apa yang tampil di katalog kasir sama
   sekali. Produk boleh NULL kalau tidak jelas satu brand (jarang dipakai
   untuk ini sekarang, tapi kolom tetap ada untuk pelaporan).
2. **Tabel baru `product_outlets`** (junction, `product_id`, `outlet_id`)
   — SATU-SATUNYA yang menentukan ketersediaan. Aturan baca: **produk
   TANPA baris sama sekali di tabel ini = tersedia di SEMUA outlet**
   (default terbuka). Produk yang PUNYA baris di tabel ini = HANYA
   tersedia di outlet-outlet yang punya barisnya (default tertutup,
   whitelist eksplisit). Ini menghindari kebutuhan mengisi ratusan baris
   untuk kasus umum ("produk ini dijual di semua outlet", mayoritas menu)
   sambil tetap bisa menyatakan pengecualian dengan presisi (menu
   Indokopi yang cuma dijual di outlet Indosteak tertentu, snack yang
   beririsan sebagian, dll — kasus per-produk, bukan per-brand).

Katalog kasir (`get-pos-catalog.ts`) filter: `product ikut kalau TIDAK
ADA baris product_outlets utk produk itu, ATAU ada baris product_outlets
dengan outlet_id = outlet yang sedang login`. Laporan tetap bisa
`GROUP BY`/`WHERE brand_id` seperti rencana awal §8.a -- itu bagian yang
TIDAK berubah dari keputusan awal.

**Kenapa bukan cukup `brand_id` + nullable-berarti-semua (rencana awal):**
itu memaksa satu produk hanya bisa "milik satu brand" atau "milik semua
brand" -- tidak ada posisi tengah "produk brand A yang JUGA dijual
terbatas di beberapa outlet brand B". Field data justru bilang itu
kasusnya (menu Indokopi masuk outlet Indosteak buat promosi). `brand_id`
tidak bisa mewakili pengecualian granular per-outlet seperti itu, cuma
`product_outlets` yang bisa.

**Konsekuensi untuk data yang sudah ada:** produk Indokopi yang sudah ada
TIDAK perlu backfill apa pun ke `product_outlets` -- karena "tanpa baris
= tersedia di semua outlet" adalah default, produk lama otomatis tetap
tampil di outlet Indokopi tanpa migrasi data sama sekali. `brand_id`
tetap di-backfill ke "Indokopi" untuk keperluan label/laporan (tidak
berubah dari rencana awal).

<details>
<summary>Draft awal §8.b (SALAH, dibatalkan -- dibiarkan sebagai jejak keputusan)</summary>

Tanpa pembatasan, layar kasir Indokopi akan menampilkan steak Indosteak
begitu keduanya satu business. Dua opsi:

**Opsi 1 (diusulkan): tabel `brands` baru.** `brands (id, business_id,
name)`, lalu `outlets.brand_id` dan `products.brand_id`. Katalog kasir
(`get-pos-catalog.ts`) filter produk berdasar `brand_id` outlet yang
sedang login, bukan cuma `business_id`.

**Opsi 2 (alternatif lebih sederhana): tabel junction `product_outlets`
(many-to-many)** — tanpa konsep "brand" sama sekali, produk ditempel
langsung ke outlet mana pun yang menjualnya.

**Kenapa condong ke Opsi 1:** dua outlet Indosteak (Cempaka Putih,
Pakansari) hampir pasti berbagi SATU menu yang sama — dengan Opsi 2,
outlet baru butuh 40+ produk ditempel manual satu-satu (rawan lupa,
rawan beda-beda tanpa sengaja antar cabang). Dengan Opsi 1, outlet baru
di bawah brand yang sama otomatis mewarisi seluruh menu brand itu, tanpa
kerja tambahan. Brand juga langsung menjawab pertanyaan pelaporan per
brand di §8.a. Kalau nanti ternyata SATU produk perlu tersedia di dua
brand berbeda (jarang, tapi mungkin, mis. minuman kemasan yang dijual di
kedua tempat) — itu kasus minoritas yang bisa ditangani belakangan
(mis. `products.brand_id` nullable = "semua brand"), bukan alasan
memilih Opsi 2 dari awal.

**Konsekuensi untuk data yang sudah ada:** seluruh produk Indokopi yang
sudah ada di-backfill satu kali ke `brand_id` = brand "Indokopi" (satu
migration data + satu UPDATE, bukan re-entry manual).

**KEPUTUSAN (§8.9 no. 2) -- DIBATALKAN, lihat koreksi di atas:** disetujui
pakai `brands`, DENGAN satu jalan keluar tambahan: **`products.brand_id`
boleh NULL, artinya "tersedia di semua outlet/brand"**. Ini untuk barang
bersama seperti air botol atau es batu yang dijual di cafe maupun resto —
tanpa ini, barang bersama harus diduplikasi per brand dan stoknya pecah
dua, persis jenis kekacauan yang sedang dihilangkan. Konsekuensi ke
katalog kasir (`get-pos-catalog.ts`): filter jadi `WHERE brand_id =
:outletBrandId OR brand_id IS NULL`, bukan `WHERE brand_id =
:outletBrandId` saja. `outlets.brand_id` sendiri TETAP wajib diisi
(tidak nullable) — cuma `products.brand_id` yang punya makna khusus saat
NULL, karena setiap outlet harus jelas satu brand, sedangkan produk
boleh lintas brand.

</details>

### 8.c Alur request → approve → kirim → terima

`stock_transfers.status` (BLUEPRINT: `draft|sent|received|cancelled`)
**tidak cukup** — perlu `requested` dan `approved` sebagai status
eksplisit, bukan cuma `draft`. Status yang diusulkan:

```
requested -> approved -> sent -> received
          -> rejected (gudang tolak permintaan)
(approved/sent/received) -> cancelled (lihat §8.f, mekanisme cancel T22 tetap dipakai)
```

Kolom yang perlu ditambah ke `stock_transfers` (selain yang sudah ada
dari T22 -- `received_at/by`, `cancel_reason/cancelled_at/cancelled_by`):
`requested_by`, `requested_at`, `approved_by`, `approved_at` — `sent_at`
sudah ada dari BLUEPRINT tapi belum pernah dipakai (T22 v1 melompatinya),
sekarang benar-benar terpakai. Ini menjawab syarat "siapa yang request,
apa saja, siapa yang kirim, siapa yang approve" secara langsung — setiap
kolom punya jawabannya sendiri, bukan disimpulkan dari `note` bebas.

**Kapan ledger (stock_movements `transfer_in`, penambahan stok) ditulis?**
Diusulkan tetap di langkah TERAKHIR ("outlet terima") — cara membaca
"tanpa approve, stok tidak bertambah" adalah rantai `approve` WAJIB ada
di jalur sebelum stok bisa bertambah (tidak bisa lompat request→terima),
bukan berarti approve ITU SENDIRI yang menaikkan stok. Ini konsisten
dengan prinsip akuntansi stok yang sudah dipakai: jangan anggap barang
"milikmu" sebelum benar-benar diterima secara fisik.

**Qty: TIGA angka berbeda, bukan satu.** Skema T22 saat ini cuma punya
SATU `entered_qty`/`qty` per baris (diisi sekali, saat terima). Alur baru
butuh: `requested_qty` (diminta outlet, saat request) dan `sent_qty`
(yang BENAR-BENAR dikirim gudang, diisi gudang saat kirim — bisa lebih
kecil dari yang diminta kalau stok gudang tidak cukup) dan
`received_qty` (yang BENAR-BENAR sampai di outlet, diisi outlet saat
terima — **TIDAK diasumsikan sama dengan `sent_qty`**). Desain lengkap
penanganan selisih `sent_qty` vs `received_qty` ada di §8.h (poin baru,
titik kebocoran utama menurut Anda) — ini membalik keputusan collapse
qty_sent/qty_received di T22 v1 (BLUEPRINT §3.3), yang benar SAAT ITU
karena belum ada sisi gudang yang mengirim terpisah dari yang diterima.

**Siapa boleh apa:** `stock.transfer` (sudah ada) dipakai untuk
request+terima. Untuk `approve`, permission BARU `stock.transfer_approve`
— pola PERSIS sama seperti `stock.opname_input` vs `stock.opname_approve`
yang sudah ada di matriks RBAC (pemisahan tugas: yang input bukan yang
menyetujui). Perlu ditambah ke `src/lib/auth/permissions.ts` (migrasi
kode, bukan migrasi database).

**KEPUTUSAN (§8.9 no. 3):** `stock.transfer_approve` dipegang **manajer
gudang** (bukan self-approve oleh staf gudang biasa yang juga
mengirim) — pemisahan tugas tetap terjaga: staf gudang menyiapkan/
mengirim, manajer gudang yang menyetujui permintaan sebelum barang
disiapkan.

**TERKONFIRMASI ke lapangan:** sistem lama Indokopi punya "request" tapi
TIDAK punya "receive" -- diminta 20 telur, datang 13, tidak ada tempat
mencatat 13-nya. Ini PERSIS lubang yang ditutup `sent_qty`/`received_qty`
terpisah di §8.h. Desain itu dipertahankan seperti apa adanya. Tim gudang
akan benar-benar memakai sistem ini (dikonfirmasi eksplisit) -- alur dua
sisi jalan terus, bukan cuma rencana di atas kertas.

**RISIKO YANG HARUS DITANGANI DALAM DESAIN — halaman request harus lebih
ringan dari WhatsApp, bukan cuma "sama saja":** cara mereka minta stok
SEKARANG adalah ngetik pesan WhatsApp ke gudang. Kalau alur request di
sistem terasa lebih repot daripada itu, mereka kembali ke WA dan seluruh
alur dua sisi ini kosong tidak terpakai -- persis pola yang sudah
terjadi pada pengolahan gudang (§8.d) yang dilewati karena sistem lama
tidak menyediakan tempat mencatatnya. Syarat desain KONKRET untuk
halaman request (bukan cuma "harus simpel", itu tidak bisa diverifikasi):
- Satu layar: pilih bahan dari daftar (bukan dropdown per baris yang
  harus dibuka satu-satu), ketik jumlah, kirim. Tanpa field wajib lain.
- Target terukur: **request 5 bahan selesai di bawah 30 detik** -- ini
  jadi kriteria lolos/gagal saat verifikasi browser nanti (§8.f pola
  verifikasi T22), bukan cuma perasaan "kelihatannya cepat".
- Tombol **"Ulangi permintaan terakhir"** -- kebanyakan permintaan
  mingguan isinya mirip (field data eksplisit). Menyalin baris-baris
  dari `stock_transfer_items` punya outlet ini yang paling baru,
  qty-nya boleh diedit sebelum kirim ulang, bukan langsung terkirim
  otomatis.
Ini bukan detail UI yang bisa disusun belakangan -- kalau halaman
request-nya lambat, seluruh premis §8.h (menutup lubang selisih
kirim/terima) tidak berguna karena tidak ada yang memakai sistemnya
sama sekali.

### 8.d Pencatatan pengolahan gudang — PALING PENTING

Ini akar masalah yang paling mungkin menjelaskan desync 90% -- bukan
cuma opname yang salah, tapi satu TAHAP PENUH (konversi mentah→porsi)
yang tidak pernah punya tempat dicatat di sistem lama.

**Skema yang dibutuhkan sudah ada di BLUEPRINT, belum dipakai:**
`recipes` (dengan `output_ingredient_id` untuk sub-resep/semi-finished)
+ `recipe_items` + `movement_type` enum sudah punya `production_in`/
`production_out`. Tidak perlu tabel baru untuk mencatat KONVERSI itu
sendiri — cuma perlu UI dan fungsi murni yang menuliskannya.

**Konsekuensi struktural yang tidak bisa dihindari: gudang butuh
`stock_levels`-nya SENDIRI.** Ini membalik keputusan T22 sebelumnya
("stok gudang sengaja tidak dilacak, karena purchases/suppliers
ditunda") — sekarang HARUS dilacak, minimal untuk bahan yang diproses
(ayam mentah harus punya saldo di gudang supaya ada yang dikurangi saat
diproses). Ini TIDAK berarti seluruh fitur `purchases`/`suppliers` (T24
lama, §7) harus dibangun penuh sekarang — cukup jalan MINIMAL untuk
mencatat "bahan mentah masuk gudang" (mis. movement_type `initial` atau
`purchase` sederhana, form serupa T22 tapi outlet-nya gudang sendiri),
BUKAN alur PO/supplier lengkap.

**Bentuk UI yang diusulkan (supaya tidak dilewati staf gudang):**
Satu halaman "Catat Pengolahan", satu resep dipilih dari dropdown (mis.
"Ayam Siap Masak"), DUA angka diisi manual per batch:
- Berapa bahan mentah yang BENAR-BENAR dipakai (mis. 5 kg ayam)
- Berapa hasil yang BENAR-BENAR didapat (mis. 20 porsi)

**Kenapa DUA angka manual, bukan satu dihitung otomatis dari rasio
resep:** hasil olahan makanan hampir tidak pernah konsisten sempurna
(kadang 18 porsi dari 5 kg, kadang 22, tergantung ukuran ayam/keahlian
staf). Kalau sistem MEMAKSA rasio tetap (5 kg selalu = 20 porsi persis),
datanya jadi bohong -- sama persis masalah yang sedang diperbaiki. Resep
di sistem tetap berguna sebagai ANGKA REFERENSI ditampilkan di preview
("resep standar: 5 kg -> 20 porsi, kamu masukkan 5 kg -> 20 porsi" atau
"-> 18 porsi, beda 2 dari standar") -- bukan alat hitung paksa. Selisih
antara resep standar dan hasil aktual ini justru bahan baku laporan
variance produksi nanti (T28-setara, `calculateVariance` di `cogs.ts`
sudah ada dan siap dipakai untuk ini).

Submit satu kali menulis DUA movement sekaligus dalam satu transaksi:
`production_out` (bahan mentah berkurang di stock_levels gudang) +
`production_in` (porsi bertambah di stock_levels gudang) -- pola atomik
yang sama seperti T22 (`SELECT ... FOR UPDATE` + `calculateNewAvgCost`).

**KEPUTUSAN (§8.9 no. 5):** disetujui KUAT — dua-angka-manual, jangan
pernah menurunkan hasil dari rasio tetap. Selisih hasil olahan yang
sesungguhnya adalah DATA (bahan untuk laporan variance), bukan
gangguan yang perlu dihilangkan. Ini bagian paling penting di seluruh
Fase 2 menurut Anda — prioritas dijaga di urutan tugas §8.g.

**KEPUTUSAN (§8.9 no. 4):** dijawab lewat poin baru §8.i — bahan mentah
masuk gudang BUKAN opsional, jadi prasyarat (T22d), dengan field
minimal: bahan, qty, satuan, harga, tanggal, supplier opsional, nomor
nota opsional. Belum PO/hutang supplier/alokasi ongkir penuh (tetap T24
lama, §7).

### 8.e Recycle Bin — usul: kategori waste, BUKAN outlet

**Rekomendasi: kategori/alasan di `waste_logs.reason`** (sudah
direncanakan di §3.1, tinggal ditambah, mis. `expired`/`damaged` yang
sudah ada mungkin sudah cukup mewakili "basi/rusak" -- perlu dicek lagi
ke istilah yang dipakai Indokopi persis).

**Kenapa bukan outlet/lokasi:** "Recycle Bin" sebagai LOKASI kemungkinan
adalah AKAL-AKALAN sistem lama yang tidak punya fitur waste sungguhan --
barang basi "dipindah" ke lokasi fiktif ini supaya tidak mengotori
laporan stok normal, padahal maksud aslinya sekadar "ini rugi, buang
catatannya di sini". Kalau kita ikut membuatnya jadi outlet SUNGGUHAN di
sistem baru, itu mewarisi cara kerja yang justru sedang diperbaiki --
butuh transfer-ke-Recycle-Bin sebagai langkah tambahan, padahal
`movement_type: waste` (BLUEPRINT, sudah ada) sudah PERSIS mendeskripsikan
kejadian yang sebenarnya: barang keluar dari stok karena rusak/basi,
titik, tidak perlu "pindah ke suatu tempat" dulu.

**KEPUTUSAN (§8.9 no. 6):** disetujui — kategori waste, bukan outlet/
lokasi terpisah.

### 8.f Yang sudah dibangun T22 (survive) vs yang berubah

**Survive, tidak perlu dibangun ulang:**
- Pola pilihan satuan input (`purchase_unit` ATAU `base_unit`) + preview
  dua baris sebelum simpan -- dipakai lagi persis sama untuk "outlet
  terima" DAN kemungkinan untuk form pengolahan gudang (§8.d).
- Kolom `entered_*` (apa yang benar-benar diketik, terpisah dari hasil
  konversi) -- makin penting sekarang, bukan cuma untuk penerimaan tapi
  berpotensi juga untuk pencatatan pengolahan.
- Pembatalan dengan movement pembalik penuh + peringatan saldo minus
  (banner persisten + kartu stok bertanda) -- polanya tetap dipakai,
  cuma titik pemicunya mungkin bertambah (bisa juga membatalkan sebelum
  "terima", bukan cuma sesudah).
- Trigger cross-tenant (`check_*_business_id`) -- pola yang sama akan
  dipasang lagi untuk tabel baru (`brands`, kolom baru di
  `stock_transfers`/items, kalau ada FK ke dua entitas ber-business_id
  terpisah).
- `outlets.is_central_kitchen` sebagai penanda gudang -- makin relevan,
  bukan kurang.
- `assertRowsAffected` + cleanup fixture generik -- infrastruktur umum,
  tidak terpengaruh sama sekali.

**Berubah/perlu ditambah:**
- `stock_transfers.status` dari satu-langkah ('received' langsung) jadi
  state machine penuh (§8.c) -- `receiveStockTransferWithDb` dipecah
  jadi beberapa fungsi (`requestStockTransferWithDb`,
  `approveStockTransferWithDb`/`sendStockTransferWithDb`,
  `receiveStockTransferWithDb` yang sekarang jadi KONFIRMASI, bukan
  entri qty pertama kali).
- Halaman daftar `/stock-transfers` perlu menampilkan status +
  siapa-kapan di setiap tahap (§8.c), bukan cuma nomor/outlet/status.
- Gudang butuh `stock_levels` sendiri (§8.d) -- sebelumnya sengaja
  tidak dilacak.
- Perlu tabel `brands` + kolom `products.brand_id` (label/laporan) DAN
  tabel terpisah `product_outlets` (ketersediaan katalog kasir, §8.b,
  dikoreksi dari rencana awal) -- keduanya prasyarat SEBELUM Indosteak
  digabung ke business yang sama.
- Permission baru `stock.transfer_approve` (§8.c).
- Catatan BLUEPRINT.md §3.3 soal "T22 v1 sengaja melompati handshake
  sent" (ditulis saat T22 pertama kali) perlu DIPERBARUI sekalian --
  keputusan itu sudah tidak berlaku, jangan dibiarkan jadi dokumentasi
  yang salah.

### 8.h Selisih kirim vs terima — titik kebocoran utama (BARU, dari Anda)

Gudang kirim 20, yang sampai di outlet 18. Alur §8.c di atas (dan T22 v1
sebelumnya) diam-diam mengasumsikan `received_qty` selalu sama dengan
`sent_qty` — itu salah, dan menurut Anda ini kemungkinan titik kebocoran
UTAMA yang selama ini tidak tertangkap sama sekali.

**Desain:** `stock_transfer_items` menyimpan `sent_qty` (diisi gudang
saat kirim) DAN `received_qty` (diisi outlet saat terima) sebagai dua
kolom terpisah, bukan satu. Kalau `received_qty != sent_qty`:
- Wajib isi alasan di sisi penerima — kolom baru `qty_diff_reason`,
  ditegakkan di SERVER (guard sebelum baris tersimpan), pola yang sama
  persis seperti "alasan wajib kalau opname selisih" di §3.2 — bukan
  cuma `required` di form.
- Selisihnya dicatat sebagai kerugian BERNILAI, bukan hilang begitu
  saja: movement baru, `movement_type` **`transfer_loss`** (nilai enum
  baru, perlu migration `ALTER TYPE movement_type ADD VALUE` — pola
  yang sama persis seperti penambahan `transfer_cancel` di migration
  0019), qty negatif sebesar `sent_qty - received_qty`, `unit_cost`
  diambil dari harga baris transfer itu sendiri supaya nilainya
  terhitung (bukan cuma qty kosong tanpa rupiah). Movement ini terikat
  ke `stock_transfer_id`, supaya bisa ditelusuri balik ke siapa yang
  kirim/approve baris itu.
- Laporan "selisih pengiriman" (bagian dari T28, atau dipercepat kalau
  prioritasnya naik setelah data awal masuk) tinggal query
  `stock_movements WHERE movement_type = 'transfer_loss'`, di-join ke
  `stock_transfers` untuk kelompokkan per pengirim dan per periode.

**Ledger di outlet mencatat `received_qty`, BUKAN `sent_qty`** — yang
benar-benar sampai secara fisik, bukan yang diklaim dikirim. Konsisten
dengan prinsip §8.c: jangan anggap barang "milikmu" sebelum benar-benar
diterima.

Ini membalik keputusan collapse `qty_sent`/`qty_received` jadi satu
`qty` yang diambil di T22 v1 dan dicatat di BLUEPRINT §3.3 sebagai
"penyimpangan disengaja" — keputusan itu benar SAAT ITU karena belum
ada sisi gudang yang mengirim terpisah dari yang menerima. Sekarang
ada, jadi alasannya sudah tidak berlaku dan catatan di BLUEPRINT.md
perlu diperbarui saat T22 revisi dikerjakan (sudah masuk daftar §8.f).

### 8.i Barang masuk gudang — prasyarat, bukan opsional (BARU, dari Anda)

Konsekuensi dari §8.d: begitu gudang punya `stock_levels` sendiri dan
pengolahan MENGONSUMSI bahan mentah dari situ, bahan mentah itu harus
punya jalan masuk lebih dulu. Tanpa ini, stok gudang akan selalu minus
sejak hari pertama — pengolahan tidak bisa diuji sama sekali tanpa ada
bahan di gudang untuk dikonsumsi.

**Bentuk minimal yang dibutuhkan** (BUKAN purchase order penuh — itu
tetap T24 lama di §7, dengan hutang supplier dan alokasi ongkir):
bahan, qty, satuan, harga, tanggal, supplier (opsional), nomor nota
(opsional). Satu movement `purchase` atau `initial` sederhana ke
`stock_levels` gudang, mengikuti pola form yang sama seperti T22
(pilihan satuan + preview dua baris sebelum simpan, §4) — bedanya
cuma outlet tujuannya gudang sendiri, dan tidak ada `stock_transfer_id`
di baliknya (ini murni barang masuk dari LUAR sistem, bukan transfer
antar outlet).

**Ditempatkan sebagai T22d, SEBELUM T22c** (lihat §8.g) — bukan sekadar
prasyarat konseptual, tapi prasyarat PENGUJIAN: T22c (pencatatan
pengolahan) tidak bisa diverifikasi ujung ke ujung tanpa T22d berjalan
lebih dulu untuk mengisi stok gudang yang akan dikonsumsi.

### 8.g Urutan tugas yang diusulkan (revisi dari §5)

Menggantikan urutan T22 tunggal di §5 dengan:

**T22a — Brand + ketersediaan produk per outlet** *(2-3 hari)* — PRASYARAT
sebelum Indosteak digabung ke business yang sama. Tabel `brands`,
`outlets.brand_id`, `products.brand_id`, filter katalog kasir per brand,
backfill data Indokopi yang sudah ada ke brand "Indokopi".

**T22 (revisi) — Alur transfer dua sisi: request → approve → kirim →
terima** *(6-7 hari, naik dari estimasi asli 3-4 hari — termasuk §8.h
selisih kirim/terima)* — state machine status (§8.c), permission
`stock.transfer_approve` dipegang manajer gudang, halaman
request/approve/list dengan jejak siapa-kapan lengkap, kolom
`sent_qty`/`received_qty`/`qty_diff_reason` + movement `transfer_loss`
(§8.h). Mekanisme penerimaan+pembalikan yang sudah ada (T22 v1) jadi
LANGKAH TERAKHIR dari alur ini, bukan dibuang.

**T22d — Barang masuk gudang (BARU, §8.i)** *(2-3 hari)* — PRASYARAT
PENGUJIAN sebelum T22c: gudang butuh stok bahan mentah untuk dikonsumsi
sebelum "Catat Pengolahan" bisa diuji ujung ke ujung. Form minimal
(bahan, qty, satuan, harga, tanggal, supplier opsional, nomor nota
opsional), mengikuti pola preview T22 (§4), movement `purchase`/
`initial` sederhana ke `stock_levels` gudang. BUKAN purchase order
penuh (tetap T24 lama, §7).

**T22c — Pencatatan pengolahan gudang** *(4-5 hari)* — PALING PENTING
(§8.d, disetujui kuat). `recipes`/`recipe_items` untuk output
semi-finished, halaman "Catat Pengolahan" dua-angka-manual (TIDAK PERNAH
diturunkan dari rasio tetap), movement `production_in`/`production_out`,
gudang dapat `stock_levels` sendiri (sudah terisi lewat T22d).

**T22b — Halaman kelola outlet** *(sudah tercatat di
`01-TASK-BOARD.md`)* — sekarang lebih mendesak (perlu untuk menambah
outlet Indosteak + gudang tanpa lewat script), tapi tetap bisa
menyusul setelah T22a-T22c kalau waktunya mepet (penambahan outlet
sekali-sekali masih bisa lewat `bootstrap-production.ts` sementara).

T23 (kartu stok) - T28 (laporan) di §5 TIDAK berubah urutannya, cuma
perlu diperluas nanti supaya sadar `brand_id`/gudang (mis. kartu stok
dan laporan variance juga relevan untuk gudang, bukan cuma outlet
retail) -- detail itu dikerjakan saat sampai ke masing-masing tugas,
bukan sekarang. Laporan "selisih pengiriman" (§8.h) masuk cakupan T28.

### 8.9 Daftar pertanyaan — SEMUA TERJAWAB

1. Laporan per brand: **harus bisa dipisah**, tapi cukup filter di
   laporan P&L Fase 3 yang sudah direncanakan, bukan laporan terpisah.
2. ~~`brands` disetujui, dengan `products.brand_id` nullable = "semua
   outlet".~~ **DIKOREKSI (putaran 3, §8.b):** `brand_id` cuma untuk
   label/laporan. Ketersediaan katalog kasir pakai tabel terpisah
   `product_outlets` (tanpa baris = tersedia di semua outlet).
3. Approve transfer: **manajer gudang** (bukan self-approve staf).
4. Bahan mentah masuk gudang: **minimal** (bahan, qty, satuan, harga,
   tanggal, supplier/nomor nota opsional) — jadi T22d, prasyarat T22c.
5. Pencatatan pengolahan dua-angka-manual: **disetujui kuat**, jangan
   pernah diturunkan dari rasio tetap.
6. Recycle Bin sebagai kategori waste: **disetujui**.
7. Detail Indosteak yang belum disebutkan (nama resmi, jumlah outlet
   persis, zona waktu) — **belum dijawab eksplisit**, tapi TIDAK
   memblokir mulai coding T22a: struktur `brands`/`outlets` yang
   dibangun tidak bergantung pada nilai-nilai itu, cuma perlu
   dikonfirmasi sebelum outlet Indosteak di-bootstrap ke produksi
   nanti (beda tahap dari menulis kode-nya).

Plus temuan baru dari Anda, sudah masuk desain: **§8.h** (selisih
`sent_qty` vs `received_qty`, movement `transfer_loss`) dan **§8.i**
(T22d, barang masuk gudang sebagai prasyarat).

**Masih terbuka, TIDAK memblokir T22a-T22d** (soal tugas yang lebih
belakangan): §6.2 (opname perlu approval manajer atau langsung — punya
T25), §6.3 (ambang notifikasi — punya T26), §6.4 (satu bahan banyak
kemasan beli — dikonfirmasi ke Indokopi saat sampai ke sana).

---

## 9. Urutan tugas final

```
[x] T22b — Halaman kelola outlet (dimajukan duluan, lihat 01-TASK-BOARD.md)
[x] T22a — Brand (label/laporan) + product_outlets (ketersediaan, dikoreksi dari brand_id)
[x] T22e — POS harus tahu device ini mewakili outlet yang mana (temuan T22a, lihat 01-TASK-BOARD.md -- device pairing lewat cookie+/pos/setup)
[x] T22  — Transfer dua sisi: request→approve/reject→send→receive (lihat 01-TASK-BOARD.md)
[ ] T26b — Notifikasi dorong permintaan transfer (backlog, lihat 01-TASK-BOARD.md, diputuskan setelah lihat pemakaian nyata)
[ ] T22d — Barang masuk gudang (prasyarat T22c)            (2-3 hari)
[ ] T22c — Pencatatan pengolahan gudang (PALING PENTING)   (4-5 hari)
[ ] T23  — Kartu stok per bahan (sudah ada di §5, tidak berubah)
[ ] T24-T28 — sesuai §5, diperluas belakangan sadar brand_id/gudang
[ ] T34  — Export laporan ke .xlsx (backlog, lihat 01-TASK-BOARD.md, TIDAK dikerjakan sekarang)
```

Total tambahan dari pivot ini (T22a + T22 revisi + T22d + T22c) sekitar
**14-18 hari** di luar T22b, di atas rencana T22 v1 semula (3-4 hari) —
kenaikan besar, tapi sepadan dengan temuan bahwa pengolahan gudang yang
tidak tercatat kemungkinan adalah akar dari desync 90% yang jadi alasan
proyek ini dimulai.

**Menunggu konfirmasi Anda untuk mulai coding T22a** (migration akan
ditunjukkan dulu sebelum dijalankan, seperti biasa) — belum ada kode
yang ditulis untuk bagian pivot ini.
