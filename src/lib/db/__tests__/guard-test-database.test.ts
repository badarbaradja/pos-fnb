/**
 * Test untuk pengaman database uji sendiri (lib/db/guard-test-database.ts).
 * MURNI unit test -- tidak butuh koneksi apa pun, selalu jalan (tidak
 * digerbang skipIf), karena ini justru penjaga yang harus terbukti benar
 * SEBELUM test integrasi mana pun dipercaya.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertTestDatabaseIsAllowed,
  checkTestDatabaseAllowed,
  extractSupabaseProjectRef,
  setupTestDatabaseGuard,
} from "../guard-test-database";

const ALLOWED_REF = "txmkbklzhleavjhzrckm"; // sama dengan ALLOWED_TEST_PROJECT_REFS
const OTHER_REF = "zzzzznotallowedrefzz"; // project ref LAIN (bukan yang diizinkan) -- bukan ref produksi sungguhan, cuma untuk membuktikan penolakan bekerja untuk ref APA PUN yang tidak dikenal

function poolerUrl(ref: string): string {
  return `postgresql://postgres.${ref}:SomePassw0rd@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres`;
}

function directUrl(ref: string): string {
  return `postgresql://postgres:SomePassw0rd@db.${ref}.supabase.co:5432/postgres`;
}

describe("extractSupabaseProjectRef", () => {
  it("bentuk pooler (postgres.<ref>@...) -> ref terbaca", () => {
    expect(extractSupabaseProjectRef(poolerUrl(ALLOWED_REF))).toBe(ALLOWED_REF);
  });

  it("bentuk koneksi langsung (db.<ref>.supabase.co) -> ref terbaca", () => {
    expect(extractSupabaseProjectRef(directUrl(ALLOWED_REF))).toBe(ALLOWED_REF);
  });

  it("bukan URL Postgres Supabase sama sekali -> null, TIDAK menebak", () => {
    expect(extractSupabaseProjectRef("postgresql://localhost:5432/mydb")).toBeNull();
  });

  it("bukan URL sama sekali -> null", () => {
    expect(extractSupabaseProjectRef("bukan-url")).toBeNull();
  });
});

describe("checkTestDatabaseAllowed", () => {
  it("ref yang diizinkan (bentuk pooler) -> lolos", () => {
    const result = checkTestDatabaseAllowed(poolerUrl(ALLOWED_REF), undefined);
    expect(result.allowed).toBe(true);
  });

  it("ref yang diizinkan (bentuk koneksi langsung) -> lolos", () => {
    const result = checkTestDatabaseAllowed(directUrl(ALLOWED_REF), undefined);
    expect(result.allowed).toBe(true);
  });

  it("ref LAIN yang tidak dikenal (mis. produksi) -> DITOLAK, pesan menyebut ref yang ditemukan dan yang diharapkan", () => {
    const result = checkTestDatabaseAllowed(poolerUrl(OTHER_REF), undefined);
    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error("harus ditolak");
    expect(result.message).toContain(OTHER_REF);
    expect(result.message).toContain(ALLOWED_REF);
  });

  it("DATABASE_URL kosong (string kosong) -> DITOLAK -- tidak tahu = tolak", () => {
    const result = checkTestDatabaseAllowed("", undefined);
    expect(result.allowed).toBe(false);
  });

  it("DATABASE_URL undefined -> DITOLAK -- tidak tahu = tolak", () => {
    const result = checkTestDatabaseAllowed(undefined, undefined);
    expect(result.allowed).toBe(false);
  });

  it("DATABASE_URL rusak/tidak bisa diurai -> DITOLAK", () => {
    const result = checkTestDatabaseAllowed("bukan-url-sama-sekali", undefined);
    expect(result.allowed).toBe(false);
  });

  it("override diset ('1') -> LOLOS dengan peringatan, walau ref TIDAK dikenal", () => {
    const result = checkTestDatabaseAllowed(poolerUrl(OTHER_REF), "1");
    expect(result.allowed).toBe(true);
    if (!result.allowed) throw new Error("harus lolos");
    expect(result.warning).toBeTruthy();
  });

  it("override diset TAPI bukan '1' persis (mis. 'true') -> TETAP DITOLAK -- harus diketik sadar, bukan truthy sembarangan", () => {
    const result = checkTestDatabaseAllowed(poolerUrl(OTHER_REF), "true");
    expect(result.allowed).toBe(false);
  });
});

describe("assertTestDatabaseIsAllowed", () => {
  it("ref yang diizinkan -> tidak melempar", () => {
    expect(() => assertTestDatabaseIsAllowed(poolerUrl(ALLOWED_REF), undefined)).not.toThrow();
  });

  it("ref yang tidak dikenal -> melempar", () => {
    expect(() => assertTestDatabaseIsAllowed(poolerUrl(OTHER_REF), undefined)).toThrow();
  });

  it("override diset -> tidak melempar walau ref tidak dikenal", () => {
    expect(() => assertTestDatabaseIsAllowed(poolerUrl(OTHER_REF), "1")).not.toThrow();
  });

  it("PENYIMPANGAN DISENGAJA (didokumentasikan di kode): DATABASE_URL SAMA SEKALI TIDAK ADA (undefined) -> tidak melempar, karena tidak ada test integrasi yang akan jalan tanpanya (semua digerbang skipIf(!hasEnv) yang sama)", () => {
    expect(() => assertTestDatabaseIsAllowed(undefined, undefined)).not.toThrow();
  });

  it("string kosong diperlakukan SAMA seperti tidak ada -- tidak melempar", () => {
    expect(() => assertTestDatabaseIsAllowed("", undefined)).not.toThrow();
  });
});

describe("setupTestDatabaseGuard -- override HANYA dari environment proses sungguhan, bukan berkas dotenv", () => {
  let tempDir: string | undefined;
  let originalDatabaseUrl: string | undefined;
  let originalOverride: string | undefined;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
    // Pulihkan process.env PERSIS seperti sebelum test ini -- file test
    // lain di run yang sama (isolate:false) bergantung pada nilai asli
    // masih ada sesudah test ini selesai.
    if (originalDatabaseUrl === undefined) delete process.env["DATABASE_URL"];
    else process.env["DATABASE_URL"] = originalDatabaseUrl;
    if (originalOverride === undefined) delete process.env["ALLOW_TEST_DB_OVERRIDE"];
    else process.env["ALLOW_TEST_DB_OVERRIDE"] = originalOverride;
  });

  it("ALLOW_TEST_DB_OVERRIDE yang HANYA ditulis di berkas .env (bukan di-export shell/CI) TIDAK melewatkan pengaman -- tetap DITOLAK untuk ref tidak dikenal", () => {
    originalDatabaseUrl = process.env["DATABASE_URL"];
    originalOverride = process.env["ALLOW_TEST_DB_OVERRIDE"];

    // Simulasikan kondisi PERSIS seperti vitest.setup.ts pertama kali jalan
    // di mesin bersih -- override TIDAK pernah di-export di environment
    // proses sungguhan, DATABASE_URL juga belum ada sebelum file dimuat.
    delete process.env["ALLOW_TEST_DB_OVERRIDE"];
    delete process.env["DATABASE_URL"];

    tempDir = mkdtempSync(join(tmpdir(), "guard-test-db-"));
    const envPath = join(tempDir, ".env.fake");
    writeFileSync(
      envPath,
      [
        "ALLOW_TEST_DB_OVERRIDE=1",
        "DATABASE_URL=postgresql://postgres.zzzzznotallowedrefzz:pw@aws-0-x.pooler.supabase.com:5432/postgres",
      ].join("\n")
    );

    // Baris ALLOW_TEST_DB_OVERRIDE=1 di berkas ini TIDAK BOLEH dihitung --
    // kalau kode lama (baca override SESUDAH loadEnv) masih dipakai, test
    // ini akan GAGAL (tidak melempar, padahal seharusnya melempar).
    expect(() => setupTestDatabaseGuard([envPath])).toThrow(/zzzzznotallowedrefzz/);
  });

  it("ALLOW_TEST_DB_OVERRIDE yang SUNGGUHAN ada di environment proses SEBELUM dipanggil (setara `ALLOW_TEST_DB_OVERRIDE=1 npm test` di shell/CI) TETAP berfungsi", () => {
    originalDatabaseUrl = process.env["DATABASE_URL"];
    originalOverride = process.env["ALLOW_TEST_DB_OVERRIDE"];

    process.env["ALLOW_TEST_DB_OVERRIDE"] = "1"; // ini yang mensimulasikan shell/CI, bukan berkas
    delete process.env["DATABASE_URL"];

    tempDir = mkdtempSync(join(tmpdir(), "guard-test-db-"));
    const envPath = join(tempDir, ".env.fake");
    writeFileSync(
      envPath,
      "DATABASE_URL=postgresql://postgres.zzzzznotallowedrefzz:pw@aws-0-x.pooler.supabase.com:5432/postgres"
    );

    expect(() => setupTestDatabaseGuard([envPath])).not.toThrow();
  });
});
