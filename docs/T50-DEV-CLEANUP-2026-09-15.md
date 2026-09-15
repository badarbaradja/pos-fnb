# T50 — Pembersihan database dev (15 September 2026)

Dicatat di branch ini (BUKAN di `master`) supaya siapa pun yang
melanjutkan T50 tahu persis apa yang terjadi ke database dev sebelum
melanjutkan.

## Apa yang terjadi

Migrasi `0037_outlet_tokens_self_order.sql` (tabel `outlet_tokens`)
sempat diterapkan LANGSUNG ke database dev di luar `master` -- kode
T50 (termasuk migrasi ini) sendiri belum pernah ter-commit sampai
15 September 2026 (lihat commit pertama branch ini). Akibatnya
`__drizzle_migrations` di dev sempat punya baris (`id=38`) yang tidak
tercatat di `_journal.json` milik `master`, dan tabel `outlet_tokens`
(sengaja dibuat TANPA RLS -- lihat komentar di `schema.ts`) membuat
tes permanen `src/lib/db/__tests__/rls.test.ts` ("tidak ada tabel
tanpa rowsecurity aktif") gagal di `master` yang bersih sekalipun --
kegagalan yang tidak ada hubungannya dengan pekerjaan apa pun yang
sedang berjalan di `master`.

## Yang dijalankan untuk membersihkan (15 September 2026)

```sql
drop table if exists outlet_tokens;
delete from drizzle.__drizzle_migrations where id = 38;
```

Tabel kosong (0 baris) saat di-drop -- tidak ada data yang hilang.
Setelah ini, `__drizzle_migrations` dev kembali berhenti di id=37,
cocok persis dengan `_journal.json` `master` (migrasi 0036 --
`search_path_auth_functions`). `rls.test.ts` dikonfirmasi hijau lagi
sesudahnya.

## Untuk siapa pun yang melanjutkan T50

Database dev SEKARANG tidak lagi punya `outlet_tokens` -- kalau mau
lanjut T50, migrasi `0037_outlet_tokens_self_order.sql` di branch ini
perlu diterapkan ULANG (`npm run db:migrate`) sebelum kode T50 bisa
jalan lagi terhadap dev.

**Sebelum di-merge ke `master`**, ada keputusan wajib soal RLS
`outlet_tokens` -- dicatat sebagai syarat merge di
`docs/RENCANA-PEMBANGUNAN-KASIR-THRIFTING.md` (repo
`reportkoperumnasgroup`), BUKAN diulang di sini.
