/**
 * T07 — Test integrasi paling kritikal di proyek ini: buktikan user dari
 * satu bisnis TIDAK BISA membaca satu baris pun milik bisnis lain, lewat
 * KETIGA jalur akses data yang ada di codebase ini:
 *   1. Query langsung via Supabase client terautentikasi (PostgREST)
 *   2. Server Action (lib/auth/actions.ts -> lib/auth/outlets.ts)
 *   3. getUserDb(accessToken) -- koneksi Drizzle langsung yang membawa
 *      konteks user, jalur yang WAJIB dipakai kode produksi (CLAUDE.md §3.4)
 * Ditambah satu test yang MENDOKUMENTASIKAN (bukan menguji sebagai celah)
 * bahwa getAdminDb() sengaja melewati RLS sepenuhnya -- lihat komentar di
 * lib/db/client.ts soal kenapa itu tidak bisa "diperbaiki".
 *
 * Butuh koneksi Supabase sungguhan (NEXT_PUBLIC_SUPABASE_URL,
 * NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL) —
 * di-skip otomatis kalau belum diisi, bukan hijau palsu.
 *
 * Data uji diberi prefix TEST_ISOLATION_ dan dibersihkan di afterAll,
 * bukan di akhir blok test, supaya tetap jalan walau ada test yang gagal
 * di tengah.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
import { inArray } from "drizzle-orm";
import {
  createSupabaseAdminClient,
  createSupabaseAnonClient,
  createSupabaseClientWithToken,
} from "../supabase";
import { listMyOutletsWithClient } from "../outlets";
import { getAdminDb, getUserDb } from "../../db/client";
import { outlets } from "../../db/schema";

loadEnv({ path: [".env.local", ".env"], quiet: true });

const hasEnv = Boolean(
  process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"] &&
    process.env["DATABASE_URL"]
);

describe.skipIf(!hasEnv)("Isolasi tenant — bisnis A tidak boleh bocor ke bisnis B", () => {
  const admin = createSupabaseAdminClient();
  const RUN_ID = Date.now();
  const PASSWORD = "T3st-Isolation-P@ssw0rd!";

  let businessAId: string | undefined;
  let businessBId: string | undefined;
  let outletAId: string | undefined;
  let outletBId: string | undefined;
  let userAId: string | undefined;
  let userBId: string | undefined;
  let tokenA: string | undefined;

  beforeAll(async () => {
    // --- Bisnis A + outlet A ---
    const { data: businessA, error: businessAError } = await admin
      .from("businesses")
      .insert({ name: `TEST_ISOLATION_A_${RUN_ID}` })
      .select("id")
      .single();
    if (businessAError || !businessA) {
      throw businessAError ?? new Error("gagal membuat business A uji");
    }
    businessAId = businessA["id"] as string;

    const { data: brandA, error: brandAError } = await admin
      .from("brands")
      .insert({ business_id: businessAId, name: `TEST_ISOLATION_A_brand_${RUN_ID}` })
      .select("id")
      .single();
    if (brandAError || !brandA) {
      throw brandAError ?? new Error("gagal membuat brand A uji");
    }

    const { data: outletA, error: outletAError } = await admin
      .from("outlets")
      .insert({
        business_id: businessAId,
        brand_id: brandA["id"] as string,
        code: "ISOA",
        name: `TEST_ISOLATION_A_outlet_${RUN_ID}`,
      })
      .select("id")
      .single();
    if (outletAError || !outletA) {
      throw outletAError ?? new Error("gagal membuat outlet A uji");
    }
    outletAId = outletA["id"] as string;

    // --- Bisnis B + outlet B ---
    const { data: businessB, error: businessBError } = await admin
      .from("businesses")
      .insert({ name: `TEST_ISOLATION_B_${RUN_ID}` })
      .select("id")
      .single();
    if (businessBError || !businessB) {
      throw businessBError ?? new Error("gagal membuat business B uji");
    }
    businessBId = businessB["id"] as string;

    const { data: brandB, error: brandBError } = await admin
      .from("brands")
      .insert({ business_id: businessBId, name: `TEST_ISOLATION_B_brand_${RUN_ID}` })
      .select("id")
      .single();
    if (brandBError || !brandB) {
      throw brandBError ?? new Error("gagal membuat brand B uji");
    }

    const { data: outletB, error: outletBError } = await admin
      .from("outlets")
      .insert({
        business_id: businessBId,
        brand_id: brandB["id"] as string,
        code: "ISOB",
        name: `TEST_ISOLATION_B_outlet_${RUN_ID}`,
      })
      .select("id")
      .single();
    if (outletBError || !outletB) {
      throw outletBError ?? new Error("gagal membuat outlet B uji");
    }
    outletBId = outletB["id"] as string;

    // --- User A (auth.users + profiles + membership ke bisnis A) ---
    const emailA = `test-isolation-a-${RUN_ID}@example.com`;
    const { data: authA, error: authAError } = await admin.auth.admin.createUser({
      email: emailA,
      password: PASSWORD,
      email_confirm: true,
    });
    if (authAError || !authA.user) {
      throw authAError ?? new Error("gagal membuat auth user A");
    }
    userAId = authA.user.id;

    await admin.from("profiles").insert({ id: userAId, full_name: `TEST_ISOLATION_A_user_${RUN_ID}` });
    await admin.from("memberships").insert({
      business_id: businessAId,
      user_id: userAId,
      role: "owner",
    });

    // --- User B (auth.users + profiles + membership ke bisnis B) ---
    const emailB = `test-isolation-b-${RUN_ID}@example.com`;
    const { data: authB, error: authBError } = await admin.auth.admin.createUser({
      email: emailB,
      password: PASSWORD,
      email_confirm: true,
    });
    if (authBError || !authB.user) {
      throw authBError ?? new Error("gagal membuat auth user B");
    }
    userBId = authB.user.id;

    await admin.from("profiles").insert({ id: userBId, full_name: `TEST_ISOLATION_B_user_${RUN_ID}` });
    await admin.from("memberships").insert({
      business_id: businessBId,
      user_id: userBId,
      role: "owner",
    });

    // --- Login sungguhan sebagai user A -> access token asli ---
    const anon = createSupabaseAnonClient();
    const { data: signInA, error: signInAError } = await anon.auth.signInWithPassword({
      email: emailA,
      password: PASSWORD,
    });
    if (signInAError || !signInA.session) {
      throw signInAError ?? new Error("gagal login sebagai user A uji");
    }
    tokenA = signInA.session.access_token;
  });

  afterAll(async () => {
    // Cascade DB (onDelete: "cascade") sudah menghapus outlets/memberships
    // saat businesses dihapus, dan profiles saat auth user dihapus -- tapi
    // tetap hapus eksplisit satu-satu supaya cleanup tidak bergantung diam-
    // diam ke perilaku cascade, dan supaya kegagalan satu langkah tidak
    // menghentikan langkah lain.
    const cleanups: Array<() => Promise<unknown>> = [
      async () => {
        if (userAId) await admin.auth.admin.deleteUser(userAId);
      },
      async () => {
        if (userBId) await admin.auth.admin.deleteUser(userBId);
      },
      async () => {
        if (businessAId) await admin.from("businesses").delete().eq("id", businessAId);
      },
      async () => {
        if (businessBId) await admin.from("businesses").delete().eq("id", businessBId);
      },
    ];

    for (const cleanup of cleanups) {
      try {
        await cleanup();
      } catch (err) {
        // Jangan biarkan satu kegagalan cleanup menghentikan yang lain --
        // tapi tetap tampilkan supaya tidak tertelan diam-diam.
        console.error("Cleanup gagal (dilanjutkan):", err);
      }
    }
  });

  it("data uji benar-benar terbentuk sebelum diuji (bukan hijau karena kosong)", () => {
    expect(businessAId).toBeTruthy();
    expect(businessBId).toBeTruthy();
    expect(outletAId).toBeTruthy();
    expect(outletBId).toBeTruthy();
    expect(userAId).toBeTruthy();
    expect(userBId).toBeTruthy();
    expect(tokenA).toBeTruthy();
    expect(businessAId).not.toBe(businessBId);
  });

  it("query langsung: user A cuma melihat outlet bisnis A, tidak satu pun outlet bisnis B", async () => {
    const supabaseA = createSupabaseClientWithToken(tokenA!);

    const { data, error } = await supabaseA.from("outlets").select("id, business_id");
    expect(error).toBeNull();

    const ids = (data ?? []).map((row) => row["id"] as string);
    expect(ids).toContain(outletAId);
    expect(ids).not.toContain(outletBId);
  });

  it("lewat Server Action (listMyOutletsWithClient): sama, user A tidak melihat outlet bisnis B", async () => {
    const supabaseA = createSupabaseClientWithToken(tokenA!);

    const result = await listMyOutletsWithClient(supabaseA);
    const ids = result.map((o) => o.id);

    expect(ids).toContain(outletAId);
    expect(ids).not.toContain(outletBId);
    expect(result.every((o) => o.businessId === businessAId)).toBe(true);
  });

  it("getUserDb(tokenA): jalur produksi untuk query Drizzle atas nama user -- RLS membatasi ke bisnis A saja", async () => {
    const { db, close } = await getUserDb(tokenA!);
    try {
      const rows = await db
        .select()
        .from(outlets)
        .where(inArray(outlets.businessId, [businessAId!, businessBId!]));

      const ids = rows.map((r) => r.id);
      expect(ids).toContain(outletAId);
      expect(ids).not.toContain(outletBId);
    } finally {
      await close();
    }
  });

  it("getAdminDb sengaja melewati RLS (didokumentasikan, bukan bug)", async () => {
    // getAdminDb() pakai role "postgres" yang punya atribut BYPASSRLS
    // eksplisit di Supabase (dikonfirmasi lewat query pg_roles) -- SENGAJA
    // melihat semua baris lintas-tenant, tidak peduli RLS atau FORCE ROW
    // LEVEL SECURITY. Ini bukan celah yang lolos tanpa sengaja: yang
    // menjaga keamanan adalah DISIPLIN PEMANGGIL (getAdminDb() cuma untuk
    // operasi sistem, CLAUDE.md §3.4) dan test berikutnya yang memastikan
    // src/app/ tidak pernah mengimpornya.
    const db = getAdminDb();
    const rows = await db
      .select()
      .from(outlets)
      .where(inArray(outlets.businessId, [businessAId!, businessBId!]));

    const ids = rows.map((r) => r.id);
    expect(ids).toContain(outletAId);
    expect(ids).toContain(outletBId);
  });
});
