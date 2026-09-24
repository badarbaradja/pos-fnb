/**
 * Halaman Auditor (24 September 2026) -- test wajib dari instruksi CEO:
 *   1. Outlet di luar akses seseorang TIDAK muncul di halaman ini --
 *      dibuktikan dari DUA arah: manajer BIASA (audit_all_outlets=false)
 *      ditolak TOTAL oleh auth_can_audit()/audit_shifts_for_business_date()
 *      (bukan cuma "outlet lain kosong", tapi seluruh fungsi menolak),
 *      SEMENTARA akses NORMALNYA ke tabel shifts (di luar laporan ini)
 *      tetap terbatas outlet sendiri seperti sebelum fitur ini ada --
 *      grant baru TIDAK melonggarkan apa pun selain laporan ini sendiri.
 *   2. Tanda "sudah ditinjau" tercatat siapa dan kapan.
 *   3. Hari tanpa shift sama sekali -> outlet muncul dengan shifts: [],
 *      bukan hilang dari daftar outlet ATAU melempar error.
 *
 * Pola fixture PERSIS sama rls-shifts-outlet-scope.test.ts (multi-user
 * signed-in lewat createSignedInMembership) -- functionally sama
 * kebutuhan: beberapa membership berbeda role/outletIds/audit_all_outlets
 * dalam SATU bisnis, masing-masing perlu koneksi RLS ASLI sendiri.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { eq, sql } from "drizzle-orm";
import { getAdminDb, getUserDb, type UserDbHandle } from "@/lib/db/client";
import { createSupabaseAdminClient, createSupabaseAnonClient } from "@/lib/auth/supabase";
import { brands, devices, employees, memberships, outlets, profiles, shifts } from "@/lib/db/schema";
import { hashPin } from "@/lib/auth/pin";
import { generateId } from "@/lib/utils/id";
import { createUserDbFixture, type UserDbFixture } from "@/lib/db/__tests__/helpers/user-db-fixture";
import { getAuditDailyReport } from "../report";
import { getAuditReviewsForBusinessDate, markAuditReviewedWithDb } from "../reviews";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

const PIN = "246813";

describe.skipIf(!hasEnv)("lib/audit -- akses lintas outlet & tanda tinjauan", () => {
  const PREFIX = `TEST_AUDIT_${Date.now()}`;
  const adminDb = getAdminDb(); // setup: outlet/device/employee/auth user lain -- CLAUDE.md §3.4
  const admin = createSupabaseAdminClient();
  const extraUserIds: string[] = [];
  const extraCloses: Array<() => Promise<void>> = [];

  let owner: UserDbFixture;
  let outletAId: string;
  let outletBId: string;
  let shiftAId: string;
  const BUSINESS_DATE = "2026-09-24";
  const EMPTY_DATE = "2026-01-01"; // tanggal tanpa shift sama sekali

  let managerPlainDb: UserDbHandle["db"];
  let managerAuditorDb: UserDbHandle["db"];
  let managerAuditorUserId: string;

  async function createSignedInMembership(
    label: string,
    outletIds: string[] | null,
    auditAllOutlets: boolean
  ): Promise<{ db: UserDbHandle["db"]; userId: string }> {
    const email = `${PREFIX.toLowerCase()}_${label}@example.com`;
    const password = "T3st-Audit-P@ssw0rd!";
    const { data: authUser, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !authUser.user) {
      throw error ?? new Error(`Gagal membuat auth user uji ${label}`);
    }
    extraUserIds.push(authUser.user.id);
    await adminDb.insert(profiles).values({ id: authUser.user.id, fullName: `${PREFIX} ${label}` });
    await adminDb
      .insert(memberships)
      .values({ businessId: owner.businessId, userId: authUser.user.id, role: "manager", outletIds, auditAllOutlets });

    const anon = createSupabaseAnonClient();
    const { data: signIn, error: signInError } = await anon.auth.signInWithPassword({ email, password });
    if (signInError || !signIn.session) {
      throw signInError ?? new Error(`Gagal login user uji ${label}`);
    }
    const { db, close } = await getUserDb(signIn.session.access_token);
    extraCloses.push(close);
    return { db, userId: authUser.user.id };
  }

  beforeAll(async () => {
    owner = await createUserDbFixture(PREFIX);

    const [brand] = await adminDb
      .insert(brands)
      .values({ businessId: owner.businessId, name: `${PREFIX}_brand` })
      .returning({ id: brands.id });
    const [oA] = await adminDb
      .insert(outlets)
      .values({ businessId: owner.businessId, brandId: brand!.id, code: "AUA", name: "Outlet Audit A" })
      .returning({ id: outlets.id });
    const [oB] = await adminDb
      .insert(outlets)
      .values({ businessId: owner.businessId, brandId: brand!.id, code: "AUB", name: "Outlet Audit B" })
      .returning({ id: outlets.id });
    outletAId = oA!.id;
    outletBId = oB!.id;

    const [devA] = await adminDb
      .insert(devices)
      .values({ businessId: owner.businessId, outletId: outletAId, serialNumber: `${PREFIX}-DEVA`, name: "Kasir A" })
      .returning({ id: devices.id });

    const pinHash = await hashPin(PIN);
    const [empA] = await adminDb
      .insert(employees)
      .values({ businessId: owner.businessId, outletId: outletAId, code: "AUEMPA", fullName: "Kasir Outlet A", role: "cashier", pinHash })
      .returning({ id: employees.id });

    // Shift SUNGGUHAN lewat db owner (RLS aktif) untuk outlet A -- outlet B
    // SENGAJA nol shift sama sekali (dipakai membuktikan cross-outlet DAN
    // "belum ada shift" sekaligus).
    const [shiftA] = await owner.db
      .insert(shifts)
      .values({
        businessId: owner.businessId,
        outletId: outletAId,
        deviceId: devA!.id,
        employeeId: empA!.id,
        businessDate: BUSINESS_DATE,
      })
      .returning({ id: shifts.id });
    shiftAId = shiftA!.id;

    managerPlainDb = (await createSignedInMembership("plain", [outletAId], false)).db;
    const auditor = await createSignedInMembership("auditor", [outletAId], true);
    managerAuditorDb = auditor.db;
    managerAuditorUserId = auditor.userId;
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

  it("data uji terbentuk (dua outlet, satu shift di outlet A saja)", () => {
    expect(outletAId).toBeTruthy();
    expect(outletBId).toBeTruthy();
    expect(shiftAId).toBeTruthy();
  });

  // ─── Test wajib #1: outlet di luar akses tidak muncul ──────────────────

  it("auth_can_audit(): manajer BIASA (audit_all_outlets=false) -> false; manajer AUDITOR -> true; owner -> true", async () => {
    const [plainResult] = await managerPlainDb.execute<{ auth_can_audit: boolean }>(
      sql`select auth_can_audit(${owner.businessId}::uuid)`
    );
    expect(plainResult?.auth_can_audit).toBe(false);

    const [auditorResult] = await managerAuditorDb.execute<{ auth_can_audit: boolean }>(
      sql`select auth_can_audit(${owner.businessId}::uuid)`
    );
    expect(auditorResult?.auth_can_audit).toBe(true);

    const [ownerResult] = await owner.db.execute<{ auth_can_audit: boolean }>(
      sql`select auth_can_audit(${owner.businessId}::uuid)`
    );
    expect(ownerResult?.auth_can_audit).toBe(true);
  });

  it("audit_shifts_for_business_date(): manajer BIASA DITOLAK (melempar), manajer AUDITOR melihat shift LINTAS OUTLET (termasuk outlet B yang bukan outlet_ids-nya)", async () => {
    await expect(
      managerPlainDb.execute(sql`select * from audit_shifts_for_business_date(${owner.businessId}::uuid, ${BUSINESS_DATE}::date)`)
    ).rejects.toThrow();

    const report = await getAuditDailyReport(managerAuditorDb, owner.businessId, BUSINESS_DATE);
    const outletIds = report.outlets.map((o) => o.outletId).sort();
    expect(outletIds).toEqual([outletAId, outletBId].sort());
    const outletAReport = report.outlets.find((o) => o.outletId === outletAId)!;
    expect(outletAReport.shifts.map((s) => s.shiftId)).toEqual([shiftAId]);
  });

  it("akses NORMAL manajer auditor ke tabel shifts TETAP terbatas outlet_ids-nya sendiri -- grant audit TIDAK melonggarkan itu", async () => {
    // Query LANGSUNG ke tabel shifts (bukan lewat fungsi audit) -- outlet B
    // tidak boleh muncul, walau membership ini auditAllOutlets=true.
    const rows = await managerAuditorDb.select({ id: shifts.id }).from(shifts).where(eq(shifts.businessId, owner.businessId));
    expect(rows.map((r) => r.id)).toEqual([shiftAId]);
  });

  // ─── Test wajib #3: hari tanpa shift -> "belum ada shift", bukan kosong ─

  it("hari tanpa shift sama sekali -> SEMUA outlet tetap muncul dengan shifts: [] (bukan hilang, bukan error)", async () => {
    const report = await getAuditDailyReport(managerAuditorDb, owner.businessId, EMPTY_DATE);
    expect(report.outlets.length).toBeGreaterThanOrEqual(2);
    for (const outlet of report.outlets) {
      expect(outlet.shifts).toEqual([]);
    }
  });

  // ─── Test wajib #2: tanda "sudah ditinjau" tercatat siapa dan kapan ────

  it("markAuditReviewedWithDb: tercatat reviewedByName + reviewedAt + note, dan MENIMPA (bukan menumpuk) kalau ditinjau ulang", async () => {
    const before = Date.now();
    const result = await markAuditReviewedWithDb(
      managerAuditorDb,
      owner.businessId,
      managerAuditorUserId,
      `${PREFIX} auditor`,
      { outletId: outletAId, businessDate: BUSINESS_DATE, note: "Pertama kali" }
    );
    expect(result.success).toBe(true);

    let reviews = await getAuditReviewsForBusinessDate(managerAuditorDb, owner.businessId, [outletAId], BUSINESS_DATE);
    let review = reviews.get(outletAId)!;
    expect(review.reviewedByName).toBe(`${PREFIX} auditor`);
    expect(review.reviewedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(review.note).toBe("Pertama kali");

    // Tinjau ulang -- MENIMPA baris yang sama (unique constraint outlet+
    // tanggal), bukan baris kedua.
    await markAuditReviewedWithDb(managerAuditorDb, owner.businessId, managerAuditorUserId, `${PREFIX} auditor`, {
      outletId: outletAId,
      businessDate: BUSINESS_DATE,
      note: "Ditinjau ulang",
    });
    reviews = await getAuditReviewsForBusinessDate(managerAuditorDb, owner.businessId, [outletAId], BUSINESS_DATE);
    review = reviews.get(outletAId)!;
    expect(review.note).toBe("Ditinjau ulang");

    // Laporan harian ikut membawa info review ini.
    const report = await getAuditDailyReport(managerAuditorDb, owner.businessId, BUSINESS_DATE);
    const outletAReport = report.outlets.find((o) => o.outletId === outletAId)!;
    expect(outletAReport.review?.note).toBe("Ditinjau ulang");
  });
});
