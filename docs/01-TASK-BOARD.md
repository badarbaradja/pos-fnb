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

**[ ] T09c — Upload gambar produk**
Supabase Storage bucket 'products', kebijakan akses per business_id,
komponen upload dengan kompresi client-side (maks 500KB, resize ke 800px),
preview, dan hapus gambar lama saat diganti.

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

**[ ] T16 — Void & refund**
Void sebelum/sesudah kirim ke dapur, refund sebagian, wajib alasan, catat audit log.

**[ ] T17 — Laporan penjualan dasar**
Ringkasan harian, per produk, per kategori, per kasir, per metode bayar, riwayat transaksi dengan filter. Semua filter pakai `business_date`.

**[ ] T18 — Dashboard owner**
Omzet hari ini, jumlah transaksi, average check, grafik 7 hari, item terlaris.

**[ ] T19 — Deploy**
Cloudflare Workers via OpenNext + Supabase prod. Uji semua alur di production sebelum kasih ke klien.

**[ ] T20 — Uji lapangan**
Pasang paralel di cafe pilot selama seminggu, jalan bersama sistem lama mereka. Catat semua keluhan. Ini lebih berharga dari dua minggu coding.

---

## Fase 2 — Inventori & HPP (setelah klien pilot puas)

T21 skema inventori · T22 CRUD bahan & satuan · T23 resep/BOM · T24 pembelian & supplier ·
T25 pemotongan stok otomatis saat bayar · T26 opname · T27 waste · T28 laporan stok & variance

**[ ] T24b — Seed data demo (bahan & resep)**
30 bahan dengan satuan dan konversi, resep untuk 25 menu dari T10,
termasuk satu sub-resep semi-finished untuk menguji rekursi.

## Fase 3 — Laba bersih

T29 karyawan & absensi · T30 payroll · T31 beban operasional & aset ·
T32 laporan Laba Rugi · T33 dashboard KPI

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
