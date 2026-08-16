# 05 — Rencana Fase 2 (revisi setelah data lapangan Indokopi)

> Status: **menunggu konfirmasi**. Belum ada kode yang ditulis untuk dokumen
> ini. Jangan mulai T21 dst. sebelum bagian "Pertanyaan terbuka" di bawah
> dijawab.

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

**T28 — Laporan stok & variance teoritis vs aktual** *(3-4 hari)*
Pemakaian teoretis (resep × qty terjual) vs aktual (ledger: stok awal +
pembelian − stok akhir opname). Laporan waste per alasan/bahan/tren.
Laporan margin HPP per produk.

**T24b (sudah tercatat di `01-TASK-BOARD.md`) — Seed data demo (bahan &
resep)** tetap di posisi SETELAH T27 (butuh resep untuk seed, bukan
sebelumnya).

---

## 6. Pertanyaan terbuka — butuh keputusan Anda sebelum T21 mulai

**6.1 Gudang pusat: dimodelkan sebagai apa?**
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

**Menunggu konfirmasi Anda** — jawaban §6.1-6.3, plus persetujuan urutan
T21-T28 di atas — sebelum saya mulai coding T21.
