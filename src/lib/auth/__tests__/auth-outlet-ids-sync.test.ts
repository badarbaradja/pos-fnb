/**
 * Pembatasan akses per outlet -- Tahap 5 (13 September 2026, §29): bukti
 * SINKRONISASI antara `UNRESTRICTED_OUTLET_ROLES` (TypeScript,
 * lib/auth/outlet-scope.ts) dan `auth_outlet_ids()` (SQL, migrasi 0033).
 * Dua tempat, satu aturan -- kalau salah satu berubah tanpa yang lain,
 * laporan bisa benar di app layer tapi salah di database (atau
 * sebaliknya) tanpa ada yang sadar.
 *
 * SENGAJA bukan tes cocok-teks (parse source SQL function lalu
 * dibandingkan ke array TS) -- itu rapuh dan tidak benar-benar
 * membuktikan PERILAKU. Tes ini, untuk SETIAP role di `userRoleEnum`
 * (nilai ASLI dari database, bukan daftar hardcode di sini):
 *
 * 1. Set membership sungguhan ke role itu + outlet_ids tertentu.
 * 2. Panggil `auth_outlet_ids(businessId)` LANGSUNG lewat koneksi
 *    Postgres user itu (RLS asli, sesi Supabase Auth sungguhan).
 * 3. Bandingkan ke `computeAllowedOutletIds(role, outletIds)` (fungsi TS
 *    murni) dipanggil dengan INPUT YANG SAMA.
 *
 * Kalau nanti `UNRESTRICTED_OUTLET_ROLES` diubah di TS tanpa mengubah
 * CASE di `auth_outlet_ids()` (atau sebaliknya), test case role yang
 * berubah GAGAL -- karena membandingkan dua OUTPUT sungguhan, bukan dua
 * salinan konstanta yang bisa drift berdua tanpa ketahuan.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { eq, sql } from "drizzle-orm";
import { getAdminDb, getUserDb, type UserDbHandle } from "@/lib/db/client";
import { createSupabaseAdminClient, createSupabaseAnonClient } from "@/lib/auth/supabase";
import { memberships, profiles, userRoleEnum } from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";
import { createUserDbFixture, type UserDbFixture } from "@/lib/db/__tests__/helpers/user-db-fixture";
import { computeAllowedOutletIds } from "../outlet-scope";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

describe.skipIf(!hasEnv)("Sinkronisasi UNRESTRICTED_OUTLET_ROLES (TS) <-> auth_outlet_ids() (SQL)", () => {
  const PREFIX = `TEST_SYNCOID_${Date.now()}`;
  const adminDb = getAdminDb(); // setup: user tunggal yang role-nya diganti-ganti -- CLAUDE.md §3.4
  const admin = createSupabaseAdminClient();

  let owner: UserDbFixture;
  let probeUserId: string;
  let probeDb: UserDbHandle["db"];
  let probeClose: () => Promise<void>;

  async function authOutletIds(businessId: string): Promise<string[] | null> {
    const rows = await probeDb.execute<{ ids: string[] | null }>(
      sql`select auth_outlet_ids(${businessId}::uuid) as ids`
    );
    return Array.from(rows as unknown as { ids: string[] | null }[])[0]!.ids;
  }

  beforeAll(async () => {
    owner = await createUserDbFixture(PREFIX);

    const email = `${PREFIX.toLowerCase()}_probe@example.com`;
    const password = "T3st-SyncOid-P@ssw0rd!";
    const { data: authUser, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !authUser.user) {
      throw error ?? new Error("Gagal membuat auth user probe");
    }
    probeUserId = authUser.user.id;
    await adminDb.insert(profiles).values({ id: probeUserId, fullName: `${PREFIX} probe` });
    // Baris membership awal -- role/outlet_ids-nya di-UPDATE ulang per
    // test case di bawah, satu user dipakai berulang (role tidak
    // pernah dibawa di JWT, selalu dibaca ulang dari tabel per statement).
    await adminDb.insert(memberships).values({ businessId: owner.businessId, userId: probeUserId, role: "manager" });

    const anon = createSupabaseAnonClient();
    const { data: signIn, error: signInError } = await anon.auth.signInWithPassword({ email, password });
    if (signInError || !signIn.session) {
      throw signInError ?? new Error("Gagal login user probe");
    }
    const { db, close } = await getUserDb(signIn.session.access_token);
    probeDb = db;
    probeClose = close;
  });

  afterAll(async () => {
    await probeClose?.();
    await admin.auth.admin.deleteUser(probeUserId).catch(() => undefined);
    await owner.cleanup();
  });

  it("data uji terbentuk", () => {
    expect(owner.businessId).toBeTruthy();
    expect(probeUserId).toBeTruthy();
  });

  it(`userRoleEnum mencakup persis 7 role yang diuji di sini -- kalau enum bertambah, tes ini gagal duluan sebelum diam-diam melewatkan role baru`, () => {
    expect([...userRoleEnum.enumValues].sort()).toEqual(
      ["accountant", "cashier", "kitchen", "manager", "owner", "waiter", "warehouse"].sort()
    );
  });

  for (const role of userRoleEnum.enumValues) {
    describe(`role "${role}"`, () => {
      it(`outlet_ids = null -> auth_outlet_ids() dan computeAllowedOutletIds() SEPAKAT`, async () => {
        await adminDb.update(memberships).set({ role, outletIds: null }).where(eq(memberships.userId, probeUserId));

        const sqlResult = await authOutletIds(owner.businessId);
        const tsResult = computeAllowedOutletIds(role, null);
        expect(sqlResult).toEqual(tsResult);
      });

      it(`outlet_ids = array spesifik -> auth_outlet_ids() dan computeAllowedOutletIds() SEPAKAT`, async () => {
        const ids = [generateId(), generateId()].sort();
        await adminDb.update(memberships).set({ role, outletIds: ids }).where(eq(memberships.userId, probeUserId));

        const sqlResult = await authOutletIds(owner.businessId);
        const tsResult = computeAllowedOutletIds(role, ids);
        expect(sqlResult === null ? null : [...sqlResult].sort()).toEqual(tsResult === null ? null : [...tsResult].sort());
      });

      it(`outlet_ids = array KOSONG -> auth_outlet_ids() dan computeAllowedOutletIds() SEPAKAT`, async () => {
        await adminDb.update(memberships).set({ role, outletIds: [] }).where(eq(memberships.userId, probeUserId));

        const sqlResult = await authOutletIds(owner.businessId);
        const tsResult = computeAllowedOutletIds(role, []);
        expect(sqlResult).toEqual(tsResult);
      });
    });
  }
});
