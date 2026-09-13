/**
 * Pembatasan akses per outlet -- Tahap 5 (13 September 2026, §29): RLS
 * LEVEL DATABASE untuk `orders`. `auth_outlet_ids(business_id)` BARU
 * (parameter business_id, BUKAN tanpa argumen seperti `auth_business_ids()`
 * -- lihat migrasi 0033 kenapa itu penting untuk user dengan membership di
 * lebih dari satu bisnis). `auth_business_ids()` sendiri TIDAK disentuh.
 *
 * Semua tes di sini lewat koneksi RLS SUNGGUHAN (`getUserDb()` via sesi
 * Supabase Auth asli, pola sama `lib/memberships/__tests__/manage.test.ts`
 * kelas 2 "RLS MURNI") -- BUKAN `getAdminDb()` untuk operasi yang DIUJI.
 * `getAdminDb()` cuma untuk hal yang secara struktural tidak mungkin
 * dilakukan user yang belum ada (bikin outlet/auth user/membership lain).
 *
 * Lima skenario yang disepakati CEO:
 * 1. owner -- lihat orders SEMUA outlet.
 * 2. accountant -- sama (walau outlet_ids-nya sendiri di kolom tidak
 *    pernah diisi -- membuktikan auth_outlet_ids() memang memaksa NULL
 *    dari ROLE, bukan cuma kebetulan datanya NULL).
 * 3. manajer dibatasi outlet A -- lihat outlet A, NOL baris outlet B.
 * 4. membership outlet_ids KOSONG -- nol baris SAMA SEKALI.
 * 5. INSERT/UPDATE ke orders outlet terlarang -- DITOLAK DATABASE (bukan
 *    cuma tidak muncul di SELECT -- policy SELECT yang benar tidak
 *    otomatis berarti INSERT/UPDATE juga terjaga).
 *
 * Plus satu pembuktian EMPIRIS (bukan cuma dipercaya dari teori RLS
 * Postgres): `order_items` policy-nya cuma `EXISTS (SELECT 1 FROM orders
 * WHERE ... business_id = any(auth_business_ids()))` -- TIDAK cek outlet
 * sama sekali. Secara teori, EXISTS itu tunduk lagi ke policy
 * `orders_select` MILIK `orders` sendiri (RLS Postgres berlaku ulang di
 * setiap akses tabel, termasuk di dalam subquery policy lain, selama
 * bukan SECURITY DEFINER yang bypass) -- jadi begitu `orders_select`
 * diperketat outlet, `order_items` SEHARUSNYA ikut terwarisi otomatis.
 * Dibuktikan di sini. Kalau ternyata BOCOR, itu TEMUAN BARU yang dicatat
 * terpisah -- TIDAK diperbaiki di file/PR ini (di luar lingkup "orders
 * sendiri", instruksi eksplisit CEO).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { eq } from "drizzle-orm";
import { getAdminDb, getUserDb, type UserDbHandle } from "@/lib/db/client";
import { createSupabaseAdminClient, createSupabaseAnonClient } from "@/lib/auth/supabase";
import { brands, memberships, orderItems, orders, outlets, profiles } from "@/lib/db/schema";
import { createUserDbFixture, type UserDbFixture } from "./helpers/user-db-fixture";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

describe.skipIf(!hasEnv)("Pembatasan akses per outlet, Tahap 5 -- RLS orders (auth_outlet_ids)", () => {
  const PREFIX = `TEST_RLSORD_${Date.now()}`;
  const adminDb = getAdminDb(); // setup: outlet/auth user/membership lain, sebelum ada sesi -- CLAUDE.md §3.4
  const admin = createSupabaseAdminClient();
  const extraUserIds: string[] = [];
  const extraCloses: Array<() => Promise<void>> = [];

  let owner: UserDbFixture;
  let outletAId: string;
  let outletBId: string;
  let orderAId: string;
  let orderBId: string;

  let accountantDb: UserDbHandle["db"];
  let managerADb: UserDbHandle["db"];
  let managerEmptyDb: UserDbHandle["db"];

  async function createSignedInMembership(
    label: string,
    role: "accountant" | "manager",
    outletIds: string[] | null
  ): Promise<UserDbHandle["db"]> {
    const email = `${PREFIX.toLowerCase()}_${label}@example.com`;
    const password = "T3st-RlsOrders-P@ssw0rd!";
    const { data: authUser, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !authUser.user) {
      throw error ?? new Error(`Gagal membuat auth user uji ${label}`);
    }
    extraUserIds.push(authUser.user.id);
    await adminDb.insert(profiles).values({ id: authUser.user.id, fullName: `${PREFIX} ${label}` });
    await adminDb.insert(memberships).values({ businessId: owner.businessId, userId: authUser.user.id, role, outletIds });

    const anon = createSupabaseAnonClient();
    const { data: signIn, error: signInError } = await anon.auth.signInWithPassword({ email, password });
    if (signInError || !signIn.session) {
      throw signInError ?? new Error(`Gagal login user uji ${label}`);
    }
    const { db, close } = await getUserDb(signIn.session.access_token);
    extraCloses.push(close);
    return db;
  }

  beforeAll(async () => {
    owner = await createUserDbFixture(PREFIX);

    const [brand] = await adminDb
      .insert(brands)
      .values({ businessId: owner.businessId, name: `${PREFIX}_brand` })
      .returning({ id: brands.id });
    const [oA] = await adminDb
      .insert(outlets)
      .values({ businessId: owner.businessId, brandId: brand!.id, code: "ROA", name: "Outlet A" })
      .returning({ id: outlets.id });
    const [oB] = await adminDb
      .insert(outlets)
      .values({ businessId: owner.businessId, brandId: brand!.id, code: "ROB", name: "Outlet B" })
      .returning({ id: outlets.id });
    outletAId = oA!.id;
    outletBId = oB!.id;

    // Order sungguhan lewat db OWNER asli (RLS aktif, owner unrestricted)
    // -- bukan getAdminDb(), supaya data uji pun lewat jalur produksi.
    const [orderA] = await owner.db
      .insert(orders)
      .values({ businessId: owner.businessId, outletId: outletAId, number: `${PREFIX}-A1`, businessDate: "2026-09-13" })
      .returning({ id: orders.id });
    orderAId = orderA!.id;

    const [orderB] = await owner.db
      .insert(orders)
      .values({ businessId: owner.businessId, outletId: outletBId, number: `${PREFIX}-B1`, businessDate: "2026-09-13" })
      .returning({ id: orders.id });
    orderBId = orderB!.id;

    accountantDb = await createSignedInMembership("accountant", "accountant", null);
    managerADb = await createSignedInMembership("managera", "manager", [outletAId]);
    managerEmptyDb = await createSignedInMembership("managerempty", "manager", []);
  });

  afterAll(async () => {
    for (const close of extraCloses) {
      await close().catch(() => undefined);
    }
    for (const userId of extraUserIds) {
      await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    }
    await owner.cleanup();
  });

  it("data uji terbentuk (dua outlet, satu order tiap outlet)", () => {
    expect(outletAId).toBeTruthy();
    expect(outletBId).toBeTruthy();
    expect(orderAId).toBeTruthy();
    expect(orderBId).toBeTruthy();
  });

  describe("1-2. owner dan accountant -- lihat orders SEMUA outlet", () => {
    it("owner: kedua order (A dan B) muncul", async () => {
      const rows = await owner.db.select({ id: orders.id }).from(orders).where(eq(orders.businessId, owner.businessId));
      expect(rows.map((r) => r.id).sort()).toEqual([orderAId, orderBId].sort());
    });

    it("accountant: kedua order (A dan B) muncul juga, walau outlet_ids kolomnya sendiri tidak pernah diisi (NULL dipaksa dari ROLE)", async () => {
      const rows = await accountantDb.select({ id: orders.id }).from(orders).where(eq(orders.businessId, owner.businessId));
      expect(rows.map((r) => r.id).sort()).toEqual([orderAId, orderBId].sort());
    });
  });

  describe("3. Manajer dibatasi outlet A -- lihat outlet A, NOL baris outlet B", () => {
    it("cuma order A yang muncul, order B tidak terlihat sama sekali", async () => {
      const rows = await managerADb.select({ id: orders.id }).from(orders).where(eq(orders.businessId, owner.businessId));
      expect(rows.map((r) => r.id)).toEqual([orderAId]);
    });
  });

  describe("4. Membership outlet_ids KOSONG -- nol baris sama sekali", () => {
    it("tidak satu order pun muncul, termasuk yang seharusnya 'boleh' kalau array kosong salah dibaca sebagai null", async () => {
      const rows = await managerEmptyDb.select({ id: orders.id }).from(orders).where(eq(orders.businessId, owner.businessId));
      expect(rows).toHaveLength(0);
    });
  });

  describe("5. INSERT/UPDATE ke outlet terlarang -- DITOLAK DATABASE", () => {
    it("INSERT manajer A ke outlet B -- DITOLAK (violates row-level security policy), bukan cuma tidak muncul di SELECT", async () => {
      await expect(
        managerADb.insert(orders).values({
          businessId: owner.businessId,
          outletId: outletBId,
          number: `${PREFIX}-MANAGERA-TRY`,
          businessDate: "2026-09-13",
        })
      ).rejects.toThrow();

      const [row] = await adminDb.select().from(orders).where(eq(orders.number, `${PREFIX}-MANAGERA-TRY`));
      expect(row).toBeUndefined();
    });

    it("UPDATE manajer A ke order outlet B -- NOL baris berubah (RLS UPDATE menyaring baris, bukan melempar), baris TETAP tidak berubah", async () => {
      const updated = await managerADb
        .update(orders)
        .set({ note: "dicoba manajer A" })
        .where(eq(orders.id, orderBId))
        .returning({ id: orders.id });
      expect(updated).toHaveLength(0);

      const [after] = await adminDb.select({ note: orders.note }).from(orders).where(eq(orders.id, orderBId));
      expect(after!.note).toBeNull();
    });

    it("INSERT/UPDATE manajer A ke outlet A SENDIRI -- BERHASIL (bukti gerbang tidak menolak semua, cuma yang di luar cakupan)", async () => {
      const inserted = await managerADb
        .insert(orders)
        .values({ businessId: owner.businessId, outletId: outletAId, number: `${PREFIX}-MANAGERA-OK`, businessDate: "2026-09-13" })
        .returning({ id: orders.id });
      expect(inserted).toHaveLength(1);

      const updated = await managerADb
        .update(orders)
        .set({ note: "manajer A ubah order A miliknya sendiri" })
        .where(eq(orders.id, orderAId))
        .returning({ id: orders.id });
      expect(updated).toHaveLength(1);
    });
  });

  describe("Temuan empiris -- apakah order_items ikut terwarisi otomatis?", () => {
    let itemBId: string;

    beforeAll(async () => {
      const [item] = await owner.db
        .insert(orderItems)
        .values({
          orderId: orderBId,
          productName: "Uji Barang Outlet B",
          qty: "1",
          unitPrice: "10000",
          grossAmount: "10000",
          netAmount: "10000",
        })
        .returning({ id: orderItems.id });
      itemBId = item!.id;
    });

    it("manajer A (TIDAK berwenang outlet B) SELECT order_items outlet B -- diharapkan NOL baris (warisan otomatis lewat EXISTS ke orders_select)", async () => {
      const rows = await managerADb.select({ id: orderItems.id }).from(orderItems).where(eq(orderItems.id, itemBId));
      expect(rows).toHaveLength(0);
    });

    it("owner TETAP bisa lihat order_items outlet B (bukti policy order_items sendiri tidak ikut rusak oleh perubahan orders)", async () => {
      const rows = await owner.db.select({ id: orderItems.id }).from(orderItems).where(eq(orderItems.id, itemBId));
      expect(rows).toHaveLength(1);
    });
  });
});
