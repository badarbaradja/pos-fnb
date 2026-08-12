# CLAUDE.md — Konteks Proyek untuk AI Agent

> File ini dibaca otomatis oleh Claude Code di setiap sesi.
> Kalau pakai Cursor: rename jadi `.cursorrules`. Kalau pakai Windsurf: `.windsurfrules`.
> **Jangan hapus atau ringkas file ini.** Kalau ada aturan baru, tambahkan di bagian yang sesuai.

---

## 1. Apa yang sedang kita bangun

Sistem POS (Point of Sale) + pembukuan untuk cafe dan restoran di Indonesia.
Pembeda utama dari kompetitor: sistem ini menghitung sampai **laba bersih**, bukan cuma omzet.

Ada tiga aliran data yang bertemu di laporan Laba Rugi:
1. Penjualan (POS) → pendapatan
2. Inventori + resep → HPP → laba kotor
3. Gaji karyawan + beban operasional → laba bersih

Spesifikasi lengkap ada di `docs/BLUEPRINT.md`. **Baca file itu sebelum mengerjakan tugas apa pun yang menyentuh skema database atau perhitungan.**

## 2. Stack

| Layer | Teknologi | Catatan |
|---|---|---|
| Framework | Next.js 15 (App Router) | TypeScript strict mode |
| Database | Supabase Postgres (region Singapore) | Free tier untuk sekarang |
| ORM | Drizzle ORM | SQL-first, migration eksplisit |
| Validasi | Zod | Satu skema dipakai client + server |
| State server | TanStack Query | |
| State lokal | Zustand | Keranjang order, sesi shift |
| UI | Tailwind + shadcn/ui | |
| Uang | decimal.js | **Wajib**, lihat aturan §4 |
| Tanggal | date-fns + date-fns-tz | Zona `Asia/Jakarta` default |
| Test | Vitest | |
| Deploy | Cloudflare Workers (OpenNext) | Nanti, jangan dipikirkan sekarang |

## 3. Aturan yang TIDAK BOLEH dilanggar

Kalau ada instruksi yang bertentangan dengan aturan di bawah, **berhenti dan tanya dulu** — jangan diam-diam melanggar.

### 3.1 Uang dan angka
- **Dilarang keras memakai tipe `number` JavaScript untuk uang.** Selalu `Decimal` dari `decimal.js`, atau `string` saat lewat batas jaringan.
- Di Postgres: `numeric(16,2)` untuk nilai transaksi, `numeric(20,8)` untuk unit cost bahan, `numeric(16,4)` untuk kuantitas stok. Tidak pernah `float`/`real`/`double precision`.
- Pembulatan hanya dilakukan **sekali di akhir**, tidak di setiap langkah.
- Kalau menjumlahkan hasil alokasi (mis. diskon dibagi ke banyak baris), baris terakhir menyerap sisa pembulatan supaya totalnya persis.

### 3.2 Immutability
- Tabel `stock_movements` bersifat **append-only**. Tidak pernah ada UPDATE atau DELETE. Koreksi = movement baru.
- `order_items` menyimpan **snapshot**: `product_name`, `unit_price`, `unit_cogs`, `category_name`. Laporan historis tidak boleh berubah kalau master data diedit.
- Master data (produk, bahan, karyawan) tidak pernah dihapus — set `is_active = false`.
- Order tidak pernah dihapus, hanya berubah status.

### 3.3 Waktu
- Semua kolom timestamp bertipe `timestamptz`.
- Setiap transaksi wajib punya `business_date DATE` yang **terpisah** dari `created_at`, dihitung dari `outlet.day_cutoff_time`. Cafe tutup jam 2 pagi — transaksi jam 01:30 masuk laporan hari sebelumnya.
- Semua query laporan memfilter pakai `business_date`, **bukan** `created_at`.
- Jangan pernah memakai zona waktu server untuk logika bisnis.

### 3.4 Multi-tenant
- Setiap tabel bisnis wajib punya kolom `business_id`.
- Setiap tabel wajib `enable row level security`. Tabel baru tanpa RLS = kebocoran data lintas klien.
- Primary key pakai UUID v7 yang di-generate di aplikasi, bukan `serial`/`identity` (agar mode offline nanti bisa jalan).

### 3.5 Logika bisnis
- **Semua rumus tinggal di `src/lib/calc/` sebagai fungsi murni** — input objek, output objek, tanpa akses database, tanpa `fetch`, tanpa side effect. Ini supaya bisa dijalankan identik di server dan di client offline.
- Setiap fungsi di `lib/calc/` wajib punya unit test sebelum dipakai di UI.
- **Jangan pernah mengarang aturan bisnis.** Urutan kalkulasi struk, rumus HPP, dan definisi laba ada di `docs/03-CALC-SPEC.md`. Kalau spesifikasinya tidak menyebutkan suatu kasus, tanya — jangan menebak.
- Tarif pajak, service charge, dan pembulatan **selalu dibaca dari setting outlet**, tidak pernah di-hardcode.

## 4. Konvensi kode

- **Kode, nama variabel, nama tabel, dan komentar: bahasa Inggris.**
- **Teks yang dilihat pengguna: bahasa Indonesia.** Semua string UI lewat `src/lib/i18n/id.ts`, jangan ditulis langsung di JSX.
- Nama tabel: `snake_case`, jamak (`order_items`, `stock_movements`).
- Nama file komponen: `kebab-case.tsx`. Nama komponen: `PascalCase`.
- Server Action untuk mutasi dari dashboard. Route Handler (`app/api/...`) untuk apa pun yang dipanggil dari luar: webhook, cron, sync.
- Format uang di UI selalu lewat helper `formatIDR()`, jangan `toLocaleString()` langsung.

## 5. Struktur folder

```
src/
├── app/
│   ├── (auth)/          # login
│   ├── (pos)/           # layar kasir, fullscreen, tanpa nav
│   ├── (dashboard)/     # dashboard owner/manajer
│   └── api/             # webhook, cron, sync
├── lib/
│   ├── db/              # schema.ts, migrations/, queries/
│   ├── calc/            # ★ SEMUA RUMUS DI SINI + __tests__/
│   ├── auth/            # session, permissions
│   ├── i18n/            # string bahasa Indonesia
│   └── utils/           # money.ts, business-date.ts, receipt-number.ts
├── components/{pos,dashboard,ui}/
└── types/
```

## 6. Definition of Done

Sebuah tugas dianggap selesai kalau **semua** ini terpenuhi:

- [ ] `npm run typecheck` lolos tanpa error
- [ ] `npm run lint` lolos
- [ ] `npm run test` lolos, termasuk test baru untuk kode yang ditambahkan
- [ ] Tidak ada `any` tanpa komentar alasan
- [ ] Tidak ada `console.log` yang tertinggal
- [ ] Kalau menyentuh database: migration Drizzle sudah dibuat dan RLS sudah diaktifkan
- [ ] Kalau menyentuh `lib/calc/`: test golden case di `docs/03-CALC-SPEC.md` masih hijau

## 7. Cara kerja yang saya harapkan dari kamu

1. **Baca dulu, tulis kemudian.** Sebelum mengubah file, baca file terkait dan `docs/BLUEPRINT.md` bagian yang relevan.
2. **Satu tugas satu commit.** Jangan menggabungkan refactor besar dengan fitur baru.
3. **Rencanakan sebelum eksekusi.** Untuk tugas yang menyentuh lebih dari 3 file, tulis rencana singkat dulu dan tunggu konfirmasi.
4. **Test dulu untuk logika bisnis.** Untuk apa pun di `lib/calc/`, tulis test dari spesifikasi sebelum menulis implementasinya.
5. **Jangan menambah dependency baru tanpa izin.** Kalau butuh, jelaskan kenapa yang sudah ada tidak cukup.
6. **Kalau ragu, tanya.** Menebak aturan bisnis lebih mahal daripada bertanya.
7. **Jangan menyentuh file di `docs/`** kecuali diminta eksplisit.

## 8. Yang sedang dikerjakan sekarang

> Update bagian ini setiap ganti fase.

**Fase: 0 — Fondasi**
**Tugas aktif:** T01 (setup proyek)
**Belum boleh disentuh:** modul inventori, payroll, laporan keuangan. Fokus dulu ke fondasi + kalkulator.
