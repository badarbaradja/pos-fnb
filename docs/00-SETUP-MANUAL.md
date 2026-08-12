# 00 — Setup Manual (Yang Kamu Kerjakan Sendiri)

Bagian ini jangan diserahkan ke agent. Ini akun, kredensial, dan keputusan — agent tidak boleh memegangnya.
Estimasi waktu: 60–90 menit.

---

## Langkah 1 — Akun yang perlu dibuat (semua gratis)

| Layanan | Untuk apa | Catatan penting |
|---|---|---|
| GitHub | Repo + CI + backup otomatis | Repo **private** |
| Supabase | Database + auth | **Pilih region Singapore (ap-southeast-1)**, jangan US |
| Cloudflare | Deploy nanti | Belum perlu disentuh sekarang |

Yang **tidak** perlu sekarang: Vercel, domain berbayar, payment gateway.

## Langkah 2 — Buat proyek Supabase

1. New Project → nama `pos-fnb-dev` → region **Southeast Asia (Singapore)**
2. Simpan password database di password manager. Kalau hilang, harus reset.
3. Ambil dari Settings → API:
   - `Project URL`
   - `anon public key`
   - `service_role key` ← **rahasia**, hanya untuk server, jangan pernah masuk kode client
4. Ambil dari Settings → Database: `Connection string` (mode Session pooler)

Bikin **dua** proyek kalau memungkinkan: `pos-fnb-dev` dan nanti `pos-fnb-prod`. Free tier mengizinkan dua proyek per organisasi. Jangan pernah bereksperimen di database yang sudah dipakai klien.

## Langkah 3 — Inisialisasi repo lokal

```bash
npx create-next-app@latest pos-fnb --typescript --tailwind --app --eslint --src-dir
cd pos-fnb
git init && git add -A && git commit -m "chore: initial commit"
```

Lalu salin file-file starter kit ini ke root proyek:
```
CLAUDE.md
.env.example
docs/BLUEPRINT.md        ← blueprint yang sudah kamu punya, rename jadi ini
docs/00-SETUP-MANUAL.md
docs/01-TASK-BOARD.md
docs/02-PROMPT-PACK.md
docs/03-CALC-SPEC.md
```

Buat `.env.local` dari `.env.example`, isi kredensial Supabase.
Pastikan `.env.local` masuk `.gitignore` — cek dua kali, ini kesalahan yang mahal.

Push ke GitHub sebagai repo private.

## Langkah 4 — Pasang backup otomatis SEKARANG, bukan nanti

Supabase free tier tidak punya backup otomatis. Buat `.github/workflows/backup.yml`:

```yaml
name: Nightly DB Backup
on:
  schedule: [{ cron: '0 19 * * *' }]   # 02:00 WIB
  workflow_dispatch:
jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: sudo apt-get update && sudo apt-get install -y postgresql-client
      - name: Dump
        env:
          DB_URL: ${{ secrets.SUPABASE_DB_URL }}
        run: |
          pg_dump "$DB_URL" --no-owner --no-acl \
            | gzip > backup-$(date +%Y%m%d).sql.gz
      - uses: actions/upload-artifact@v4
        with:
          name: db-backup-${{ github.run_id }}
          path: backup-*.sql.gz
          retention-days: 30
```

Tambahkan `SUPABASE_DB_URL` di GitHub → Settings → Secrets → Actions.

**Uji restore-nya satu kali** ke database lokal. Backup yang belum pernah diuji restore bukan backup, cuma perasaan tenang.

## Langkah 5 — Pasang agent

**Claude Code:**
```bash
npm install -g @anthropic-ai/claude-code
cd pos-fnb
claude
```
`CLAUDE.md` akan terbaca otomatis di setiap sesi.

**Cursor:** rename `CLAUDE.md` jadi `.cursorrules` di root.

Cek agent sudah baca aturannya — tanya: *"Apa aturan tipe data untuk uang di proyek ini?"* Kalau jawabannya bukan `decimal.js` dan `numeric`, berarti file konteks belum terbaca.

## Langkah 6 — Keputusan yang harus kamu ambil sebelum coding

Jawab tiga ini dan tulis jawabannya di `CLAUDE.md` §8:

1. **Klien pertama siapa?** Cari sekarang, jangan setelah jadi. Satu cafe kenalan yang mau jadi pilot akan menghemat berminggu-minggu fitur yang salah.
2. **Kapan stok dipotong?** Rekomendasi: saat order dibayar (Opsi B di blueprint §4.2). Konsisten sejak awal.
3. **Service charge milik siapa?** Dibagikan ke karyawan (jadi liabilitas) atau milik usaha (jadi pendapatan)? Tanya calon klienmu.

---

## Ritme kerja yang saya sarankan

- **Satu sesi agent = satu tugas dari task board.** Jangan menumpuk.
- **Commit setiap tugas selesai.** Kalau agent merusak sesuatu, `git reset` itu murah.
- **Review kode yang dihasilkan agent**, terutama di `lib/calc/` dan migration database. Kalau kamu tidak paham satu baris, minta penjelasan sebelum di-commit — kamu yang akan dipanggil klien jam 9 malam, bukan agent.
- **Jalankan `npm run test` sebelum commit.** Selalu.
