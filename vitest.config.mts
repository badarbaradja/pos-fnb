import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    // 30s cukup untuk test yang berdiri sendiri (dikalibrasi untuk import
    // yang diperlambat antivirus di mesin ini). Tapi test integrasi paling
    // berat (mis. void-refund: 2x payOrder + void + refund + 2 query audit
    // log, ~15 round-trip Postgres sungguhan berurutan) makan 10-16 detik
    // SAAT BERDIRI SENDIRI, dan lebih lambat lagi di bawah beban serial
    // penuh (isolate:false + fileParallelism:false di atas) karena satu
    // pool yang sama dipakai bergantian oleh 13 file, bukan 13 pool
    // paralel. 30s jadi terlalu mepet untuk lonjakan latensi jaringan
    // sesaat ke Supabase dev (WAN, bukan localhost) -- itu penyebab test
    // yang lolos sendirian gagal saat full run. 60s bukan menutupi
    // kebocoran koneksi (sudah diperbaiki di bawah), tapi mengoreksi
    // asumsi budget waktu yang memang sudah berubah begitu eksekusi
    // dibuat serial.
    testTimeout: 60000,
    // beforeAll di test integrasi (mis. tenant-isolation.test.ts) melakukan
    // beberapa panggilan Supabase Admin API berurutan (createUser x2, insert
    // profiles/memberships, dst.) -- default hookTimeout Vitest (10s) sudah
    // sempit bahkan tanpa beban serial. Samakan dengan testTimeout supaya
    // hook setup tidak jadi titik gagal terpisah dengan anggaran lebih ketat
    // dari test itu sendiri.
    hookTimeout: 60000,
    // Test integrasi (13 file) berbagi satu koneksi Postgres sungguhan lewat
    // getAdminDb() -- singleton di-cache per modul (lib/db/client.ts). Default
    // Vitest mengisolasi module registry PER FILE dan menjalankan file secara
    // paralel di banyak thread, jadi tiap file dapat pool getAdminDb() SENDIRI
    // (default max 10 koneksi postgres-js) dan semuanya dibuka bersamaan --
    // total koneksi ke Supabase bisa jauh melebihi limit free tier, membuat
    // query lain timeout/hang. Gejalanya: test gagal saat `vitest run` penuh
    // tapi lolos saat file yang sama dijalankan sendirian.
    //
    // isolate:false membuat SEMUA file test berbagi satu module registry,
    // jadi cachedAdminDb di lib/db/client.ts sungguh-sungguh SATU pool untuk
    // seluruh run (bukan satu per file). fileParallelism:false memastikan
    // file dijalankan satu per satu, jadi tidak ada dua file yang sama-sama
    // membuka koneksi baru secara bersamaan sebelum pool pertama sempat
    // dipakai ulang. Kombinasi keduanya membatasi total koneksi admin ke
    // maksimum SATU pool (10 koneksi) untuk seluruh `npm run test`, bukan
    // 10 x jumlah file.
    isolate: false,
    fileParallelism: false,
  },
});