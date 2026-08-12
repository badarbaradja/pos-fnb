# 02 — Prompt Pack

Prompt siap tempel untuk agent. Satu prompt = satu sesi = satu commit.
Setelah agent selesai, jalankan `npm run test && npm run typecheck` sebelum commit.

---

## Prompt pembuka (jalankan sekali di sesi pertama)

```
Baca CLAUDE.md, docs/BLUEPRINT.md, docs/01-TASK-BOARD.md, dan docs/03-CALC-SPEC.md.

Lalu jawab singkat, tanpa menulis kode apa pun:
1. Apa yang sedang kita bangun, dalam 3 kalimat?
2. Sebutkan 5 aturan yang tidak boleh kamu langgar.
3. Apa tugas pertama yang harus dikerjakan, dan kenapa urutannya begitu?
4. Adakah bagian dokumen yang menurutmu ambigu atau bertentangan?

Jangan mulai coding sampai saya bilang mulai.
```

Kalau jawaban nomor 2 tidak menyebut `decimal.js` dan `business_date`, konteksnya belum masuk — ulangi.

---

## T01 — Setup tooling

```
Kerjakan T01 dari docs/01-TASK-BOARD.md.

Pasang dan konfigurasikan: Vitest, Drizzle ORM + drizzle-kit, decimal.js, zod,
date-fns + date-fns-tz, @supabase/supabase-js, uuidv7.

Buat script npm: dev, build, typecheck, lint, test, test:watch, db:generate, db:migrate.
Aktifkan TypeScript strict mode dan noUncheckedIndexedAccess.
Buat satu test dummy untuk memastikan Vitest jalan.

Jangan menambah dependency lain di luar daftar di atas.
Setelah selesai, tampilkan isi package.json dan hasil `npm run test`.
```

## T02 — Utilitas dasar

```
Kerjakan T02.

Buat:
- src/lib/utils/money.ts — wrapper Decimal, formatIDR(), roundTo(value, step),
  parseMoney(). Semua fungsi menerima dan mengembalikan Decimal, kecuali formatIDR
  yang mengembalikan string.
- src/lib/utils/business-date.ts — fungsi businessDate() sesuai CALC-SPEC bagian F.
- src/lib/utils/id.ts — generateId() memakai UUID v7.

Tulis test dulu berdasarkan TC-15 di CALC-SPEC, termasuk kasus outlet zona WITA
dengan proses berjalan di UTC. Baru implementasikan.

Larangan: jangan pakai tipe number untuk uang di mana pun.
```

## T03 — Kalkulator struk ★

```
Kerjakan T03. Ini bagian paling kritikal di seluruh proyek — kerjakan pelan-pelan.

Baca docs/03-CALC-SPEC.md bagian A secara utuh.

Langkah:
1. Buat file test src/lib/calc/__tests__/order-calculator.test.ts berisi
   TC-01 sampai TC-07 PERSIS seperti di spesifikasi. Jangan mengubah angka
   ekspektasi sedikit pun.
2. Jalankan test — semuanya harus MERAH dulu.
3. Baru implementasikan src/lib/calc/order-calculator.ts sampai semua hijau.

Aturan:
- Fungsi murni. Tanpa akses database, tanpa fetch, tanpa Date.now().
- Semua aritmetika pakai Decimal.
- Urutan langkah 1-10 di spesifikasi tidak boleh ditukar.
- Kalau ada test yang tidak bisa lolos, JANGAN ubah angka ekspektasinya.
  Berhenti dan laporkan ke saya bagian spesifikasi mana yang bermasalah.
```

## T04 — Kalkulator HPP

```
Kerjakan T04. Baca CALC-SPEC bagian B.

Implementasikan src/lib/calc/cogs.ts:
- calculateRecipeCost() — rekursif untuk bahan semi-finished, maksimal 5 level,
  deteksi circular reference dan lempar error dengan pesan yang menyebut nama bahannya
- calculateNewAvgCost() — WAC, tangani kasus qtyLama <= 0
- allocateShippingCost() — pastikan total alokasi persis sama dengan ongkir
- calculateVariance()

Test dulu dari TC-08 sampai TC-12. Tambahkan test circular reference sendiri.
```

## T05 — P&L, KPI, shift

```
Kerjakan T05. Baca CALC-SPEC bagian C, D, E.

Buat src/lib/calc/pnl.ts, kpi.ts, shift.ts.

Perhatian khusus: SETIAP pembagian harus aman terhadap pembagi nol dan
mengembalikan null, bukan NaN atau Infinity. Buat test eksplisit untuk ini
di setiap fungsi yang membagi.

Test dari TC-13 dan TC-14.
```

## T06 — Skema database inti

```
Kerjakan T06. Baca BLUEPRINT bagian 3.1.

Buat src/lib/db/schema.ts dengan Drizzle untuk: businesses, outlets, profiles,
memberships, employees, devices, permissions_override.

Aturan:
- Ikuti tipe data di BLUEPRINT bagian 3.0 persis: numeric(16,2) untuk nilai
  transaksi, numeric(20,8) untuk unit cost, numeric(16,4) untuk kuantitas.
- Primary key uuid, default di-generate aplikasi.
- Setiap tabel wajib punya migration RLS.
- Buat helper SQL auth_business_ids() seperti di BLUEPRINT bagian 9.5.

Terakhir, buat test yang query pg_tables dan GAGAL kalau ada tabel di schema
public tanpa RLS aktif. Test ini akan kita pakai selamanya.
```

## T07 — Auth & permission

```
Kerjakan T07.

- Login owner/manajer via Supabase Auth (email + password)
- Login kasir via PIN 6 digit, hash bcrypt, terikat ke outlet
- src/lib/auth/session.ts: getSession(), getCurrentBusiness()
- src/lib/auth/permissions.ts: matriks RBAC dari BLUEPRINT bagian 7 sebagai
  konstanta, plus requirePermission(key) untuk dipakai di Server Action

Wajib: tulis test integrasi yang membuktikan user dari bisnis A tidak bisa
membaca satu baris pun milik bisnis B, baik lewat query langsung maupun
lewat Server Action.
```

## T12 — Layar kasir (contoh prompt untuk UI)

```
Kerjakan T12. Baca dulu src/lib/calc/order-calculator.ts.

Buat layar kasir di app/(pos)/pos/page.tsx:
- Kiri: grid produk dengan tab kategori, kolom pencarian, tombol item favorit
- Kanan: keranjang, ubah qty, hapus item, catatan per item, ringkasan total
- Modal modifier saat produk yang punya modifier group dipilih
- State keranjang pakai Zustand

ATURAN KERAS: tidak boleh ada satu pun operasi aritmetika uang di dalam komponen
React. Setiap kali keranjang berubah, panggil calculateOrder() dan render hasilnya.
Kalau kamu menemukan diri menulis a + b untuk uang di komponen, berhenti — itu
tanda logikanya salah tempat.

Target performa: dari tap produk sampai keranjang ter-update di bawah 100ms.
Katalog di-cache di memori saat shift dibuka, jangan query per tap.

UI bahasa Indonesia, semua string lewat src/lib/i18n/id.ts.
```

---

## Prompt utilitas

**Saat agent mulai melenceng:**
```
Berhenti. Baca ulang CLAUDE.md bagian 3.
Sebutkan aturan mana yang barusan kamu langgar, lalu perbaiki.
```

**Sebelum commit:**
```
Jalankan npm run typecheck, npm run lint, dan npm run test.
Tampilkan hasilnya. Kalau ada yang merah, perbaiki dulu.
Lalu ringkas dalam 5 baris: file apa saja yang berubah dan kenapa.
```

**Review keamanan berkala (jalankan tiap akhir fase):**
```
Audit seluruh kode yang sudah ada terhadap checklist ini:
1. Ada tabel tanpa RLS?
2. Ada service_role key yang bisa terekspos ke client?
3. Ada Server Action tanpa requirePermission()?
4. Ada tipe number dipakai untuk uang?
5. Ada query laporan yang memfilter created_at, bukan business_date?
6. Ada rumus bisnis yang ditulis di luar src/lib/calc/?

Laporkan temuan sebagai daftar, jangan langsung memperbaiki.
```

**Saat menambah fitur di luar rencana:**
```
Sebelum coding, jawab dulu:
- Fitur ini menyentuh file apa saja?
- Perlu migration database?
- Ada rumus baru yang belum ada di CALC-SPEC?
Kalau jawaban terakhir ya, kita tulis spesifikasinya dulu di CALC-SPEC,
baru implementasi. Jangan mengarang rumus.
```
