/**
 * Pembatasan akses per outlet -- Tahap 0 (13 September 2026): halaman
 * kelola tim/membership. Butuh koneksi Supabase sungguhan, sama seperti
 * lib/employees/__tests__/manage.test.ts -- di-skip otomatis kalau env
 * belum diisi.
 *
 * Dua kelas tes disengaja dipisah jelas di sini (permintaan CEO -- "bukan
 * kodenya ada, tapi tes yang membuktikan apa yang ditolak"):
 * 1. Perilaku lib/memberships/manage.ts lewat db OWNER asli (RLS aktif,
 *    bukan getAdminDb()) -- aturan bisnis: role assignable, outlet_ids
 *    null-vs-array-kosong, larangan self-edit, larangan kelola baris
 *    owner/accountant.
 * 2. RLS MURNI, dari sudut pandang MANAJER (bukan owner) yang mencoba
 *    menulis langsung ke tabel memberships/profiles TANPA lewat
 *    lib/memberships/manage.ts sama sekali -- membuktikan policy
 *    memberships_insert/memberships_update/profiles_select_business_owner
 *    di schema.ts benar-benar menolak, bukan cuma dicegah app layer.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { and, eq } from "drizzle-orm";
import { getAdminDb, getUserDb, type UserDbHandle } from "@/lib/db/client";
import {
  createSupabaseAdminClient,
  createSupabaseAnonClient,
  createSupabaseClientWithToken,
} from "@/lib/auth/supabase";
import { requirePermission } from "@/lib/auth/permissions";
import { auditLogs, brands, memberships, outlets, profiles } from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";
import { createUserDbFixture, type UserDbFixture } from "@/lib/db/__tests__/helpers/user-db-fixture";
import { inviteMembershipWithDb, listMembershipsWithDb, updateMembershipWithDb } from "../manage";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

describe.skipIf(!hasEnv)("Pembatasan akses per outlet, Tahap 0 -- kelola membership", () => {
  const PREFIX = `TEST_TEAM_${Date.now()}`;
  const adminDb = getAdminDb(); // setup fixture (outlet/user lain) sebelum ada sesi -- CLAUDE.md §3.4
  const admin = createSupabaseAdminClient();
  const extraUserIds: string[] = [];

  let owner: UserDbFixture;
  let outletA: string;
  let outletB: string;

  let managerDb: UserDbHandle["db"];
  let managerClose: () => Promise<void>;
  let managerSupabase: ReturnType<typeof createSupabaseClientWithToken>;

  async function createSignedInUser(label: string, role: "manager" | "accountant" | null) {
    const email = `${PREFIX.toLowerCase()}_${label}@example.com`;
    const password = "T3st-Team-P@ssw0rd!";
    const { data: authUser, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !authUser.user) {
      throw error ?? new Error(`Gagal membuat auth user uji ${label}`);
    }
    extraUserIds.push(authUser.user.id);
    await adminDb.insert(profiles).values({ id: authUser.user.id, fullName: `${PREFIX} ${label}` });
    if (role) {
      await adminDb.insert(memberships).values({ businessId: owner.businessId, userId: authUser.user.id, role });
    }

    const anon = createSupabaseAnonClient();
    const { data: signIn, error: signInError } = await anon.auth.signInWithPassword({ email, password });
    if (signInError || !signIn.session) {
      throw signInError ?? new Error(`Gagal login user uji ${label}`);
    }
    return { userId: authUser.user.id, accessToken: signIn.session.access_token };
  }

  beforeAll(async () => {
    owner = await createUserDbFixture(PREFIX);

    const [brand] = await adminDb
      .insert(brands)
      .values({ businessId: owner.businessId, name: `${PREFIX}_brand` })
      .returning({ id: brands.id });
    const [oA] = await adminDb
      .insert(outlets)
      .values({ businessId: owner.businessId, brandId: brand!.id, code: "TMA", name: "Outlet A" })
      .returning({ id: outlets.id });
    const [oB] = await adminDb
      .insert(outlets)
      .values({ businessId: owner.businessId, brandId: brand!.id, code: "TMB", name: "Outlet B" })
      .returning({ id: outlets.id });
    outletA = oA!.id;
    outletB = oB!.id;

    const manager = await createSignedInUser("manager", "manager");
    const { db, close } = await getUserDb(manager.accessToken);
    managerDb = db;
    managerClose = close;
    managerSupabase = createSupabaseClientWithToken(manager.accessToken);
  });

  afterAll(async () => {
    await managerClose?.();
    for (const userId of extraUserIds) {
      await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    }
    await owner.cleanup();
  });

  it("data uji benar-benar terbentuk sebelum diuji (bukan hijau karena kosong)", () => {
    expect(owner.businessId).toBeTruthy();
    expect(outletA).toBeTruthy();
    expect(outletB).toBeTruthy();
  });

  describe("lib/memberships/manage.ts lewat db owner (aturan bisnis)", () => {
    it("listMembershipsWithDb: baris awal cuma owner sendiri, emailListTruncated false (jauh dari batas 1000)", async () => {
      const result = await listMembershipsWithDb(owner.db, owner.businessId);
      const ownRow = result.rows.find((r) => r.userId === owner.userId);
      expect(ownRow).toBeTruthy();
      expect(ownRow?.role).toBe("owner");
      expect(ownRow?.outletIds).toBeNull();
      expect(result.emailListTruncated).toBe(false);
    });

    it("inviteMembershipWithDb: role 'owner' ditolak sebelum sampai ke database (bukan di assignableMembershipRoles)", async () => {
      const result = await inviteMembershipWithDb(owner.db, owner.businessId, owner.userId, {
        email: `${PREFIX.toLowerCase()}_ownerattempt@example.com`,
        fullName: "Percobaan Owner",
        role: "owner",
        outletIds: null,
      });
      expect(result.error).toBeTruthy();
      expect(result.success).toBeUndefined();
    });

    it("inviteMembershipWithDb: role 'accountant' ditolak", async () => {
      const result = await inviteMembershipWithDb(owner.db, owner.businessId, owner.userId, {
        email: `${PREFIX.toLowerCase()}_acctattempt@example.com`,
        fullName: "Percobaan Akuntan",
        role: "accountant",
        outletIds: null,
      });
      expect(result.error).toBeTruthy();
    });

    it("inviteMembershipWithDb: outlet_ids array KOSONG ditolak -- harus null (semua outlet) atau minimal 1", async () => {
      const result = await inviteMembershipWithDb(owner.db, owner.businessId, owner.userId, {
        email: `${PREFIX.toLowerCase()}_emptyoutlets@example.com`,
        fullName: "Percobaan Array Kosong",
        role: "cashier",
        outletIds: [],
      });
      expect(result.error).toBeTruthy();
    });

    it("inviteMembershipWithDb: outlet yang tidak dimiliki bisnis ini ditolak", async () => {
      const result = await inviteMembershipWithDb(owner.db, owner.businessId, owner.userId, {
        email: `${PREFIX.toLowerCase()}_foreignoutlet@example.com`,
        fullName: "Percobaan Outlet Asing",
        role: "cashier",
        outletIds: [generateId()],
      });
      expect(result.error).toBeTruthy();
    });

    it("inviteMembershipWithDb: undang anggota baru berhasil, outlet_ids null berarti semua outlet, tautan undangan dikembalikan", async () => {
      const email = `${PREFIX.toLowerCase()}_newmember@example.com`;
      const result = await inviteMembershipWithDb(owner.db, owner.businessId, owner.userId, {
        email,
        fullName: "Anggota Baru",
        role: "cashier",
        outletIds: null,
      });
      expect(result.success).toBeTruthy();
      expect(result.success?.inviteLink).toBeTruthy();
      expect(result.success?.inviteLinkGeneratedAt).toBeTruthy();
      extraUserIds.push(
        (await admin.auth.admin.listUsers({ perPage: 1000 })).data.users.find((u) => u.email === email)!.id
      );

      const { rows } = await listMembershipsWithDb(owner.db, owner.businessId);
      const invited = rows.find((r) => r.email === email);
      expect(invited?.role).toBe("cashier");
      expect(invited?.outletIds).toBeNull();
      expect(invited?.isActive).toBe(true);

      // CEO 13 September 2026: audit log wajib catat BAHWA undangan
      // dibuat (siapa->siapa, kapan) TANPA tautannya sendiri.
      const [logRow] = await owner.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.refId, result.success!.membershipId), eq(auditLogs.action, "membership_invited")));
      expect(logRow).toBeTruthy();
      expect(logRow?.createdAt).toBeTruthy();
      const metadata = logRow?.metadata as Record<string, unknown>;
      expect(metadata["actorUserId"]).toBe(owner.userId);
      expect(metadata["targetEmail"]).toBe(email);
      expect(metadata["inviteLinkGenerated"]).toBe(true);
      expect(JSON.stringify(metadata)).not.toContain(result.success!.inviteLink);
    });

    it("inviteMembershipWithDb: outlet_ids array tertentu tersimpan apa adanya", async () => {
      const email = `${PREFIX.toLowerCase()}_scopedmember@example.com`;
      const result = await inviteMembershipWithDb(owner.db, owner.businessId, owner.userId, {
        email,
        fullName: "Anggota Outlet Tertentu",
        role: "waiter",
        outletIds: [outletA, outletB],
      });
      expect(result.success).toBeTruthy();
      extraUserIds.push(
        (await admin.auth.admin.listUsers({ perPage: 1000 })).data.users.find((u) => u.email === email)!.id
      );

      const { rows } = await listMembershipsWithDb(owner.db, owner.businessId);
      const invited = rows.find((r) => r.email === email);
      expect(invited?.outletIds?.slice().sort()).toEqual([outletA, outletB].sort());
    });

    it("inviteMembershipWithDb dipanggil KEDUA KALINYA untuk email yang sama mengaktifkan ulang baris LAMA, bukan duplikat baru", async () => {
      const email = `${PREFIX.toLowerCase()}_reinvite@example.com`;
      const first = await inviteMembershipWithDb(owner.db, owner.businessId, owner.userId, {
        email,
        fullName: "Anggota Reinvite",
        role: "cashier",
        outletIds: null,
      });
      expect(first.success).toBeTruthy();
      const membershipId = first.success!.membershipId;
      extraUserIds.push(
        (await admin.auth.admin.listUsers({ perPage: 1000 })).data.users.find((u) => u.email === email)!.id
      );

      await updateMembershipWithDb(owner.db, owner.businessId, owner.userId, {
        id: membershipId,
        role: "cashier",
        outletIds: null,
        isActive: false,
      });

      const second = await inviteMembershipWithDb(owner.db, owner.businessId, owner.userId, {
        email,
        fullName: "Anggota Reinvite",
        role: "manager",
        outletIds: [outletA],
      });
      expect(second.success).toBeTruthy();
      expect(second.success?.membershipId).toBe(membershipId);

      const { rows } = await listMembershipsWithDb(owner.db, owner.businessId);
      const reactivated = rows.find((r) => r.id === membershipId);
      expect(reactivated?.role).toBe("manager");
      expect(reactivated?.outletIds).toEqual([outletA]);
      expect(reactivated?.isActive).toBe(true);
    });

    it("updateMembershipWithDb: owner TIDAK BISA mengubah baris miliknya sendiri (cegah kunci-diri-sendiri)", async () => {
      const { rows } = await listMembershipsWithDb(owner.db, owner.businessId);
      const ownRow = rows.find((r) => r.userId === owner.userId)!;

      const result = await updateMembershipWithDb(owner.db, owner.businessId, owner.userId, {
        id: ownRow.id,
        role: "manager",
        outletIds: null,
        isActive: false,
      });
      expect(result.error).toBeTruthy();

      const [stillOwner] = await owner.db.select().from(memberships).where(eq(memberships.id, ownRow.id));
      expect(stillOwner?.role).toBe("owner");
      expect(stillOwner?.isActive).toBe(true);
    });

    it("updateMembershipWithDb: baris role accountant TIDAK BISA dikelola lewat halaman ini", async () => {
      const accountant = await createSignedInUser("accountant", "accountant");
      const [accountantRow] = await owner.db
        .select()
        .from(memberships)
        .where(eq(memberships.userId, accountant.userId));

      const result = await updateMembershipWithDb(owner.db, owner.businessId, owner.userId, {
        id: accountantRow!.id,
        role: "manager",
        outletIds: null,
        isActive: false,
      });
      expect(result.error).toBeTruthy();
    });
  });

  describe("RLS murni -- manajer (bukan owner) mencoba menulis langsung, tanpa lewat manage.ts", () => {
    it("requirePermission('membership.manage') menolak manajer -- gerbang izin, lapisan pertama", async () => {
      await expect(requirePermission(managerSupabase, "membership.manage")).rejects.toThrow(/Forbidden/);
    });

    it("profiles_select_business_owner: manajer TIDAK BISA melihat profil anggota lain (cuma owner yang bisa)", async () => {
      const rows = await managerDb.select().from(profiles).where(eq(profiles.id, owner.userId));
      expect(rows).toHaveLength(0);
    });

    it("memberships_insert: manajer TIDAK BISA memberi membership baru ke user lain di bisnis yang sama lewat db user asli", async () => {
      const target = await createSignedInUser("target", null);

      await expect(
        managerDb
          .insert(memberships)
          .values({ businessId: owner.businessId, userId: target.userId, role: "manager" })
      ).rejects.toThrow();

      const [row] = await adminDb
        .select()
        .from(memberships)
        .where(eq(memberships.userId, target.userId));
      expect(row).toBeUndefined();
    });

    it("memberships_update: manajer TIDAK BISA mengubah baris membership siapa pun (termasuk dirinya sendiri) lewat db user asli", async () => {
      const [managerRow] = await adminDb
        .select()
        .from(memberships)
        .where(eq(memberships.businessId, owner.businessId))
        .then((rows) => rows.filter((r) => r.role === "manager"));

      await managerDb
        .update(memberships)
        .set({ outletIds: [outletA] })
        .where(eq(memberships.id, managerRow!.id));

      const [afterAttempt] = await adminDb
        .select()
        .from(memberships)
        .where(eq(memberships.id, managerRow!.id));
      expect(afterAttempt?.outletIds).toBeNull(); // tidak berubah -- RLS menolak diam-diam (0 baris terpengaruh, bukan error, perilaku standar UPDATE RLS)
    });
  });
});
