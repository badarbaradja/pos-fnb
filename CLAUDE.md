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
- **Tanggal bisnis TIDAK PERNAH dari `new Date().toISOString().slice(0, 10)`** (atau turunannya seperti `.split("T")[0]`) — itu tanggal UTC, bukan tanggal bisnis. Selalu lewat `businessDate(createdAt, timezone, dayCutoffTime)` (`src/lib/utils/business-date.ts`), dan nilainya **dihitung di server** (Server Component/Server Action/route handler), tidak pernah di komponen klien lewat `new Date()` browser — jam perangkat viewer bisa melenceng atau beda zona. Bug ini pernah SUNGGUHAN terjadi (25 September 2026): bocor dua kali sekaligus — di berkas tes (`bagi-hasil-report.test.ts`, `shift.test.ts`, menyebabkan 4 tes merah palsu setiap suite dijalankan pukul 00:00–07:00 WIB, saat UTC masih tanggal kemarin) dan di kode aplikasi sungguhan (`payout-dialog.tsx`, default tanggal pembayaran ke pemilik titipan salah satu hari kalau dibuka dini hari) — sebelum ditemukan dan diperbaiki.

### 3.4 Multi-tenant
- Setiap tabel bisnis wajib punya kolom `business_id`.
- Setiap tabel wajib `enable row level security`. Tabel baru tanpa RLS = kebocoran data lintas klien.
- Primary key pakai UUID v7. **Aturan siapa yang generate ID:**
  - Orders, order_items, payments, shifts → di-generate **di client** (syarat mode offline).
  - CRUD dashboard (produk, bahan, karyawan, dll.) → boleh di server.
  - `gen_random_uuid()` di Postgres hanya sebagai **fallback**, tidak pernah jadi sumber ID utama.
- **`getAdminDb()` (`src/lib/db/client.ts`) hanya untuk operasi sistem** (migration, cron, sync, verifikasi PIN kasir, seed) — role `postgres` yang dipakainya punya `BYPASSRLS` eksplisit di Supabase, jadi FORCE ROW LEVEL SECURITY sekalipun tidak menahannya (ditemukan di T07). Setiap pemakaiannya wajib disertai komentar satu baris yang menjelaskan kenapa RLS perlu dilewati.
- **Query apa pun yang mengambil data atas nama user wajib lewat `getUserDb(accessToken)`.** Tidak ada pengecualian. Jangan pernah pakai `getAdminDb()` untuk melayani request satu user tertentu.
- **PENGECUALIAN TERTULIS (19 September 2026, disetujui pemilik proyek): endpoint integrasi tarikan untuk sistem laporan Koperumnas** — `GET /api/integrasi/omzet-harian` (`src/app/api/integrasi/omzet-harian/route.ts`). Ini pekerjaan **sistem-ke-sistem**, bukan atas nama user: tidak ada sesi Supabase, jadi `getUserDb()` tidak punya token untuk dipakai. Batas pengecualiannya, jangan dilebarkan tanpa persetujuan baru:
  1. Koneksi admin dipanggil HANYA di `src/lib/integrasi/omzet-harian.ts` (`ambilOmzetHarianIntegrasi`). `src/app/` tetap TIDAK BOLEH menyebut `getAdminDb` (tes `no-admin-db-in-app` tidak dilonggarkan).
  2. Hanya AGREGAT per outlet per hari bisnis (jumlah order, uang diterima, penjualan bersih, refund) — tidak ada nama karyawan, pelanggan, produk, atau transaksi individual.
  3. Baca-saja, terikat ke SATU bisnis (`INTEGRASI_BUSINESS_ID`), rentang maksimal 14 hari, dijaga token Bearer statis (`INTEGRASI_LAPORAN_TOKEN`, min. 32 karakter, dibandingkan waktu-konstan; salah/kosong = 401, belum dikonfigurasi = 503).
  4. Endpoint baru yang butuh koneksi admin BUKAN otomatis boleh memakai pola ini — tiap endpoint baru butuh pengecualian tertulis sendiri di sini.
- **PENGECUALIAN TERTULIS (25 September 2026, disetujui pemilik proyek): handoff satu pintu masuk dari reportkoperumnasgroup** — `GET /handoff` (`src/app/handoff/route.ts`), lewat `src/lib/auth/handoff.ts`, DAN pengelola tautannya di `/team` (`src/lib/auth/identity-links.ts`, dipanggil dari `src/app/(dashboard)/team/actions.ts`). Beda dari pengecualian omzet-harian di atas — di sini justru ADA user yang login (baik reportkoperumnasgroup yang mengirim token, maupun owner yang mengelola tautan di `/team`), tapi tabelnya sendiri (`report_identity_links`, `handoff_nonces`) SENGAJA tidak punya policy RLS sama sekali (lihat komentarnya di `lib/db/schema.ts`) — jadi `getUserDb()` biasa pun tidak bisa membacanya walau pemanggilnya user asli. Batas pengecualiannya, jangan dilebarkan tanpa persetujuan baru:
  1. Koneksi admin dipanggil HANYA di `lib/auth/handoff.ts` (dipakai `/handoff`) dan `lib/auth/identity-links.ts` (dipakai `/team`). Kedua tempat itu SELALU didahului gerbang izin app-layer (`requirePermission`/`requirePermissionDb`, bukan RLS) SEBELUM menyentuh admin db — `/handoff` sendiri tidak butuh sesi (endpoint publik dituju browser tanpa login pos-fnb), tapi `/team`'s pengelola tautan WAJIB `membership.manage` (owner-only).
  2. Token dari reportkoperumnasgroup (lihat `lib/auth/handoff-token.ts`) TIDAK PERNAH jadi sumber role/outlet — cuma pembawa email, diverifikasi tanda tangan+kedaluwarsa+nonce sekali-pakai, lalu dicocokkan ke `report_identity_links` yang SUDAH ada (diisi manual owner, bukan otomatis dari token). Sesi sungguhan yang terbentuk sesudahnya (lewat `generateLink()` + `/auth/callback`) membaca role/outlet dari `memberships` SEPERTI BIASA — RLS dan gerbang peran TIDAK tahu bedanya dari login password (dibuktikan di `src/lib/auth/__tests__/handoff.test.ts`).
  3. Endpoint/tabel baru yang butuh koneksi admin BUKAN otomatis boleh memakai pola ini — pengecualian tertulis sendiri, sama seperti aturan omzet-harian di atas.
- **RLS adalah lapisan terakhir, bukan satu-satunya.** Setiap query tetap memfilter `business_id` secara eksplisit, jangan mengandalkan RLS saja untuk kebenaran hasil.

### 3.5 Logika bisnis
- **Semua rumus tinggal di `src/lib/calc/` sebagai fungsi murni** — input objek, output objek, tanpa akses database, tanpa `fetch`, tanpa side effect. Ini supaya bisa dijalankan identik di server dan di client offline.
- Setiap fungsi di `lib/calc/` wajib punya unit test sebelum dipakai di UI.
- **Jangan pernah mengarang aturan bisnis.** Urutan kalkulasi struk, rumus HPP, dan definisi laba ada di `docs/03-CALC-SPEC.md`. Kalau spesifikasinya tidak menyebutkan suatu kasus, tanya — jangan menebak.
- Tarif pajak, service charge, dan pembulatan **selalu dibaca dari setting outlet**, tidak pernah di-hardcode.
- **Pengecualian:** Helper aritmetika generik (`round2`, `roundTo`) boleh tinggal di `lib/utils/money.ts` karena dipakai lintas modul. Yang wajib di `lib/calc/` adalah rumus BISNIS — kalkulasi yang menghasilkan nilai finansial.

### 3.6 Dependency & Lingkungan
- **DILARANG** memakai flag `--no-package-lock`. `package-lock.json` wajib ikut di-commit.
- **DILARANG** mengedit versi dependency di `package.json` secara manual. Selalu lewat `npm install <paket>`.
- Node.js minimal **v22.12**. Kalau `node --version` di bawah itu, berhenti dan laporkan.
- Jangan pasang `@vitejs/plugin-react`, `vite`, atau `vite-tsconfig-paths` sampai fase UI. Vitest sudah menangani alias path sendiri, dan Vite 8 + rolldown bermasalah dengan native binding di Windows.
- `testTimeout` diset 30 detik karena antivirus memperlambat import di mesin ini.
- Kalau `npm install` gagal (EPERM, paket korup, `.bin` kosong), **JANGAN mencoba workaround sendiri**. Laporkan ke saya dan tunggu.
- **DILARANG** menjalankan `drizzle-kit push` pada database apa pun setelah baseline migration terpasang. `push` menerapkan perubahan langsung tanpa mencatat ke `drizzle.__drizzle_migrations`, sehingga riwayat migration dan kondisi database jadi tidak sinkron — ini yang terjadi di T06 dan butuh baseline manual untuk dipulihkan. Selalu pakai `db:generate` lalu `db:migrate`.
  `push` juga terbukti menerapkan RLS policy TANPA kondisi USING/WITH CHECK-nya (ditemukan di T07). Policy terpasang tapi tidak membatasi apa pun. Ini alasan tambahan kenapa `push` dilarang.
- Perubahan schema yang tidak bisa diekspresikan di `schema.ts` (fungsi SQL, trigger, FK ke schema `auth`) ditulis manual ke file migration hasil generate, dengan `CREATE OR REPLACE` atau guard `IF NOT EXISTS` agar idempoten.
- Hapus script diagnostik sementara setelah dipakai, jangan di-commit.

### 3.7 Penanganan galat Server Action di klien
- **Setiap pemanggilan Server Action dari event handler (bukan lewat `useActionState`) wajib dibungkus `try { ... } catch (err) { ... }` yang menampilkan galatnya ke pengguna** (`toast.error(err instanceof Error ? err.message : strings.common.unexpectedError)`), plus `console.error` untuk jejak debug.
- **`try { ... } finally { ... }` TANPA `catch` DILARANG.** `finally` cuma memastikan `setIsPending(false)` jalan — kalau Server Action **throw** (bukan `return { error }`), exception itu lolos tanpa pernah menyentuh `toast.error()`. Pengguna tidak lihat apa pun; kasir mengira sistem macet atau (lebih parah) mengira transaksinya berhasil.
- Ini bukan teori: audit menyeluruh (September 2026) menemukan 29 titik dengan pola ini, termasuk checkout F&B, checkout thrifting, void, refund, dan keempat langkah shift — jalur uang, tempat "gagal tanpa suara" paling mahal.
- Pola yang BENAR:
  ```tsx
  async function handleConfirm() {
    setIsPending(true);
    try {
      const result = await someAction(...);
      if (result.error) { toast.error(result.error); return; }
      if (result.success) { /* ...sukses... */ }
    } catch (err) {
      console.error("<label singkat>:", err);
      toast.error(err instanceof Error ? err.message : strings.common.unexpectedError);
    } finally {
      setIsPending(false);
    }
  }
  ```
- `useActionState` + `useEffect` yang merender `state.error` lewat toast SUDAH aman (exception di Server Action otomatis jadi error state, tidak pernah lolos diam-diam) — aturan ini soal pola imperatif (`async function handleX()` atau `startTransition(async () => {...})`) yang jauh lebih mudah lupa `catch`-nya.
- Efek yang mengosongkan state (kosongkan keranjang, tutup dialog, pindah halaman struk) **hanya boleh dipanggil dari cabang `result.success`**, tidak pernah dari luar blok itu — supaya galat/exception apa pun tidak bisa membuat UI terlihat seolah transaksi berhasil padahal belum tersimpan.

## 4. Konvensi kode

- **Kode, nama variabel, nama tabel, dan komentar: bahasa Inggris.**
- **Teks yang dilihat pengguna: bahasa Indonesia.** Semua string UI lewat `src/lib/i18n/id.ts`, jangan ditulis langsung di JSX.
- Nama tabel: `snake_case`, jamak (`order_items`, `stock_movements`).
- Nama file komponen: `kebab-case.tsx`. Nama komponen: `PascalCase`.
- Server Action untuk mutasi dari dashboard. Route Handler (`app/api/...`) untuk apa pun yang dipanggil dari luar: webhook, cron, sync.
- Format uang di UI selalu lewat helper `formatIDR()`, jangan `toLocaleString()` langsung.
- **Modul dengan direktif `"use server"` HANYA boleh mengekspor fungsi dan tipe.** Konstanta, array, dan objek diletakkan di modul `lib/` terpisah tanpa direktif, lalu diimpor langsung oleh client component. Nilai non-fungsi tidak selamat melewati batas serialisasi server action dan gagal di runtime Workers, bukan saat typecheck — ditemukan di T15c (`paymentMethodTypeValues.map()` → `TypeError: g.map is not a function` di produksi).

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
- [ ] `npm run build` lolos tanpa error (typecheck+lint tidak menangkap
      semua kesalahan — mis. rantai import server-only yang bocor ke
      Client Component cuma ketahuan saat build, ditemukan T15b)
- [ ] `npm run test` lolos, termasuk test baru untuk kode yang ditambahkan
- [ ] Tidak ada `any` tanpa komentar alasan
- [ ] Tidak ada `console.log` yang tertinggal
- [ ] Kalau menyentuh database: migration Drizzle sudah dibuat dan RLS sudah diaktifkan
- [ ] Kalau menyentuh `lib/calc/`: test golden case di `docs/03-CALC-SPEC.md` masih hijau
- [ ] Kalau menyentuh middleware/proxy/config runtime (`middleware.ts`,
      `next.config.ts`, `open-next.config.ts`, `wrangler.jsonc`): wajib
      jalankan `npx opennextjs-cloudflare build` sampai selesai tanpa
      error, bukan cuma `npm run build` — `next build` sendiri tidak
      menangkap ketidakcocokan runtime Cloudflare (mis. Proxy Next.js 16
      yang selalu Node.js runtime tapi @opennextjs/cloudflare belum
      mendukungnya sama sekali), baru ketahuan di tahap bundling OpenNext.
      Ini pernah bikin deploy produksi Indokopi gagal total walau
      `npm run build` hijau.

## 7. Cara kerja yang saya harapkan dari kamu

1. **Baca dulu, tulis kemudian.** Sebelum mengubah file, baca file terkait dan `docs/BLUEPRINT.md` bagian yang relevan.
2. **Satu tugas satu commit.** Jangan menggabungkan refactor besar dengan fitur baru.
3. **Rencanakan sebelum eksekusi.** Untuk tugas yang menyentuh lebih dari 3 file, tulis rencana singkat dulu dan tunggu konfirmasi. **Tidak ada mekanisme persetujuan otomatis.** Persetujuan hanya sah kalau datang dari saya sebagai pesan — bukan timeout, bukan default sistem, bukan asumsi apa pun. Kalau saya tidak menjawab, rencana belum disetujui, titik. Kalau menurutmu suatu keputusan tidak perlu jawaban saya, jangan ajukan sebagai pertanyaan yang menunggu persetujuan — putuskan sendiri dan sebutkan alasannya secara eksplisit, supaya saya bisa mengoreksi kalau salah.
4. **Test dulu untuk logika bisnis.** Untuk apa pun di `lib/calc/`, tulis test dari spesifikasi sebelum menulis implementasinya.
5. **Jangan menambah dependency baru tanpa izin.** Kalau butuh, jelaskan kenapa yang sudah ada tidak cukup.
6. **Kalau ragu, tanya.** Menebak aturan bisnis lebih mahal daripada bertanya.
7. **Jangan menyentuh file di `docs/`** kecuali diminta eksplisit.

## 8. Yang sedang dikerjakan sekarang

> Update bagian ini setiap ganti fase.

**Fase: 2 — Inventory & HPP**
**Tugas aktif:** T21 (fondasi inventori: skema, bahan, satuan, ledger stok, kartu stok)
