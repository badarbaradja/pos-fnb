import { describe, expect, it } from "vitest";
import { assertValidDatabaseUrl } from "../validate-database-url";

/**
 * Semua connection string di sini DUMMY -- bukan kredensial sungguhan,
 * pola host mengikuti format Supabase pooler yang publik dari
 * .env.example, bukan project nyata.
 */
describe("assertValidDatabaseUrl", () => {
  it("connection string wajar tanpa karakter bermasalah -> tidak throw", () => {
    expect(() =>
      assertValidDatabaseUrl(
        "postgresql://postgres.xxxx:GoodPass123@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres"
      )
    ).not.toThrow();
  });

  it("password mengandung '@' tidak di-encode (>1 '@' di authority) -> throw, sebut penyebabnya", () => {
    expect(() =>
      assertValidDatabaseUrl(
        "postgresql://postgres.xxxx:my@pass@word@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres"
      )
    ).toThrow(/karakter khusus|URL-encode/i);
  });

  it("password mengandung '@' DAN ']' tidak di-encode -> throw", () => {
    expect(() =>
      assertValidDatabaseUrl(
        "postgresql://postgres.xxxx:my@pass]word@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres"
      )
    ).toThrow(/karakter khusus|URL-encode/i);
  });

  it("password dengan '@' yang SUDAH di-encode (%40) -> tidak throw", () => {
    expect(() =>
      assertValidDatabaseUrl(
        "postgresql://postgres.xxxx:my%40pass@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres"
      )
    ).not.toThrow();
  });

  it("bukan URL sama sekali -> throw", () => {
    expect(() => assertValidDatabaseUrl("bukan-url-sama-sekali")).toThrow();
  });

  it("string kosong -> throw", () => {
    expect(() => assertValidDatabaseUrl("")).toThrow();
  });
});
