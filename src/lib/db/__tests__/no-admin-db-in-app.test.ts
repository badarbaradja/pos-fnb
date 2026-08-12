/**
 * T07 — Test permanen: tidak ada satu file pun di src/app/ (lapisan UI:
 * Server Component, Client Component, Server Action, Route Handler) yang
 * boleh mengimpor getAdminDb(). Itu koneksi yang melewati RLS sepenuhnya
 * (CLAUDE.md §3.4) — kalau lapisan UI bisa memanggilnya, satu kesalahan
 * ketik (getAdminDb alih-alih getUserDb) membocorkan data lintas tenant.
 *
 * Murni pemeriksaan filesystem, tidak butuh koneksi database — selalu
 * jalan, tidak di-skip.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const APP_DIR = path.resolve(__dirname, "../../../app");

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true })
    .map((entry) => entry.toString())
    .filter((entry) => /\.(ts|tsx)$/.test(entry))
    .map((entry) => path.join(dir, entry));
}

describe("src/app/ tidak boleh mengimpor getAdminDb", () => {
  it("tidak ada referensi getAdminDb di file manapun dalam src/app/", () => {
    const files = listSourceFiles(APP_DIR);

    // Kalau folder ini nanti punya banyak file (setelah T08+), pastikan
    // pemeriksaan ini benar-benar memeriksa sesuatu, bukan lolos karena
    // daftar filenya kosong akibat path salah.
    expect(files.length).toBeGreaterThan(0);

    const offenders = files.filter((file) =>
      readFileSync(file, "utf8").includes("getAdminDb")
    );

    expect(offenders).toEqual([]);
  });
});
