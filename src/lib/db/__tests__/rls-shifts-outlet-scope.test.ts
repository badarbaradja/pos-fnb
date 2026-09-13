/**
 * Pembatasan akses per outlet -- Tahap 5 (13 September 2026, §30): RLS
 * LEVEL DATABASE untuk `shifts`. Menggunakan ULANG `auth_outlet_ids()`
 * (dibuat untuk `orders`, migrasi 0033) APA ADANYA -- TIDAK ADA fungsi
 * SQL baru di migrasi ini (0034).
 *
 * `shifts` adalah GERBANG IDENTITAS KASIR, beda kelas risiko dari
 * `orders`: akun yang login di BROWSER TABLET POS (bukan kasir yang PIN
 * -- `employees` TIDAK wajib punya akun Supabase Auth sama sekali,
 * BLUEPRINT §3.1) yang di-cek `auth_outlet_ids()`-nya lewat
 * `requirePermissionDb()` -> `getUserDb(accessToken)`. Verifikasi PIN
 * sendiri (`verifyCashierPin()`, lib/auth/pin.ts) lewat
 * `createSupabaseAdminClient()` (service_role, BYPASSRLS) -- TIDAK
 * terpengaruh sama sekali oleh policy ini. Kalau akun tablet dibatasi
 * dan `outlet_ids`-nya tidak memuat outlet tablet itu sendiri, SEMUA
 * kasir gagal buka/tutup shift di situ -- bukan satu fitur, seluruh
 * outlet berhenti berjualan. Dicatat sebagai SYARAT PELUNCURAN di plan
 * doc §30 (keputusan CEO: lanjut bangun, bukan diperbaiki di sini).
 *
 * Lima skenario (pola sama `rls-orders-outlet-scope.test.ts`):
 * 1. owner -- lihat shift SEMUA outlet.
 * 2. accountant -- sama.
 * 3. manajer dibatasi outlet A -- lihat outlet A, NOL baris outlet B.
 * 4. membership outlet_ids KOSONG -- nol baris.
 * 5. INSERT (lewat openShiftWithDb SUNGGUHAN, bukan raw insert -- supaya
 *    perilaku produksi yang sesungguhnya terbukti, termasuk pesan error
 *    generik yang dihasilkan) dan UPDATE ke outlet terlarang -- DITOLAK
 *    DATABASE.
 *
 * Plus pembuktian empiris: `cash_movements` (policy-nya EXISTS ke
 * shifts, cuma cek business_id) -- apakah ikut terwarisi otomatis sama
 * seperti `order_items` terhadap `orders`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { eq } from "drizzle-orm";
import { getAdminDb, getUserDb, type UserDbHandle } from "@/lib/db/client";
import { createSupabaseAdminClient, createSupabaseAnonClient } from "@/lib/auth/supabase";
import { brands, cashMovements, devices, employees, memberships, outlets, profiles, shifts } from "@/lib/db/schema";
import { hashPin } from "@/lib/auth/pin";
import { generateId } from "@/lib/utils/id";
import { createUserDbFixture, type UserDbFixture } from "./helpers/user-db-fixture";
import { openShiftWithDb } from "@/lib/pos/shift";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

const PIN = "135790";

describe.skipIf(!hasEnv)("Pembatasan akses per outlet, Tahap 5 -- RLS shifts (auth_outlet_ids)", () => {
  const PREFIX = `TEST_RLSSHF_${Date.now()}`;
  const adminDb = getAdminDb(); // setup: outlet/device/employee/auth user lain -- CLAUDE.md §3.4
  const admin = createSupabaseAdminClient();
  const extraUserIds: string[] = [];
  const extraCloses: Array<() => Promise<void>> = [];

  let owner: UserDbFixture;
  let outletAId: string;
  let outletBId: string;
  let deviceAId: string;
  let deviceBId: string;
  let shiftAId: string;
  let shiftBId: string;

  let accountantDb: UserDbHandle["db"];
  let managerADb: UserDbHandle["db"];
  let managerEmptyDb: UserDbHandle["db"];

  async function createSignedInMembership(
    label: string,
    role: "accountant" | "manager",
    outletIds: string[] | null
  ): Promise<UserDbHandle["db"]> {
    const email = `${PREFIX.toLowerCase()}_${label}@example.com`;
    const password = "T3st-RlsShifts-P@ssw0rd!";
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
      .values({ businessId: owner.businessId, brandId: brand!.id, code: "RSA", name: "Outlet A" })
      .returning({ id: outlets.id });
    const [oB] = await adminDb
      .insert(outlets)
      .values({ businessId: owner.businessId, brandId: brand!.id, code: "RSB", name: "Outlet B" })
      .returning({ id: outlets.id });
    outletAId = oA!.id;
    outletBId = oB!.id;

    const [devA] = await adminDb
      .insert(devices)
      .values({ businessId: owner.businessId, outletId: outletAId, serialNumber: `${PREFIX}-DEVA`, name: "Kasir A" })
      .returning({ id: devices.id });
    const [devB] = await adminDb
      .insert(devices)
      .values({ businessId: owner.businessId, outletId: outletBId, serialNumber: `${PREFIX}-DEVB`, name: "Kasir B" })
      .returning({ id: devices.id });
    deviceAId = devA!.id;
    deviceBId = devB!.id;

    const pinHash = await hashPin(PIN);
    await adminDb
      .insert(employees)
      .values({ businessId: owner.businessId, outletId: outletAId, code: "RSEMPA", fullName: "Kasir Outlet A", role: "cashier", pinHash });
    await adminDb
      .insert(employees)
      .values({ businessId: owner.businessId, outletId: outletBId, code: "RSEMPB", fullName: "Kasir Outlet B", role: "cashier", pinHash });

    // Shift sungguhan lewat db OWNER asli (RLS aktif, owner unrestricted)
    // -- bukan getAdminDb(), supaya data uji pun lewat jalur produksi.
    const [shiftA] = await owner.db
      .insert(shifts)
      .values({
        businessId: owner.businessId,
        outletId: outletAId,
        deviceId: deviceAId,
        employeeId: (await adminDb.select({ id: employees.id }).from(employees).where(eq(employees.code, "RSEMPA")))[0]!.id,
        businessDate: "2026-09-13",
      })
      .returning({ id: shifts.id });
    shiftAId = shiftA!.id;

    const [shiftB] = await owner.db
      .insert(shifts)
      .values({
        businessId: owner.businessId,
        outletId: outletBId,
        deviceId: deviceBId,
        employeeId: (await adminDb.select({ id: employees.id }).from(employees).where(eq(employees.code, "RSEMPB")))[0]!.id,
        businessDate: "2026-09-13",
      })
      .returning({ id: shifts.id });
    shiftBId = shiftB!.id;

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

  it("data uji terbentuk (dua outlet, satu shift tiap outlet)", () => {
    expect(outletAId).toBeTruthy();
    expect(outletBId).toBeTruthy();
    expect(shiftAId).toBeTruthy();
    expect(shiftBId).toBeTruthy();
  });

  describe("1-2. owner dan accountant -- lihat shift SEMUA outlet", () => {
    it("owner: kedua shift (A dan B) muncul", async () => {
      const rows = await owner.db.select({ id: shifts.id }).from(shifts).where(eq(shifts.businessId, owner.businessId));
      expect(rows.map((r) => r.id).sort()).toEqual([shiftAId, shiftBId].sort());
    });

    it("accountant: kedua shift (A dan B) muncul juga, walau outlet_ids kolomnya sendiri tidak pernah diisi", async () => {
      const rows = await accountantDb.select({ id: shifts.id }).from(shifts).where(eq(shifts.businessId, owner.businessId));
      expect(rows.map((r) => r.id).sort()).toEqual([shiftAId, shiftBId].sort());
    });
  });

  describe("3. Manajer dibatasi outlet A -- lihat outlet A, NOL baris outlet B", () => {
    it("cuma shift A yang muncul, shift B tidak terlihat sama sekali", async () => {
      const rows = await managerADb.select({ id: shifts.id }).from(shifts).where(eq(shifts.businessId, owner.businessId));
      expect(rows.map((r) => r.id)).toEqual([shiftAId]);
    });
  });

  describe("4. Membership outlet_ids KOSONG -- nol baris sama sekali", () => {
    it("tidak satu shift pun muncul", async () => {
      const rows = await managerEmptyDb.select({ id: shifts.id }).from(shifts).where(eq(shifts.businessId, owner.businessId));
      expect(rows).toHaveLength(0);
    });
  });

  describe("5. INSERT/UPDATE ke outlet terlarang -- DITOLAK DATABASE (jalur openShiftWithDb SUNGGUHAN)", () => {
    it("openShiftWithDb: manajer A (tablet login-nya cuma outlet A) coba buka shift BARU di outlet B -- DITOLAK, TIDAK ADA shift baru tertulis", async () => {
      const before = await adminDb.select({ id: shifts.id }).from(shifts).where(eq(shifts.deviceId, deviceBId));

      const result = await openShiftWithDb(managerADb, owner.businessId, {
        id: generateId(),
        outletId: outletBId,
        deviceId: deviceBId,
        employeeCode: "RSEMPB",
        pin: PIN,
        openingCash: "0",
      });

      // Pesan yang dikembalikan SENGAJA generik ("Terjadi kesalahan, coba
      // lagi") -- openShiftWithDb membungkus SEMUA error jadi satu pesan
      // yang sama (lihat catatan file di atas ttg risiko diagnostik).
      // Yang dibuktikan DI SINI adalah GAGAL-nya, bukan teks pesannya.
      expect(result.error).toBeTruthy();

      const after = await adminDb.select({ id: shifts.id }).from(shifts).where(eq(shifts.deviceId, deviceBId));
      expect(after.length).toBe(before.length);
    });

    it("openShiftWithDb: manajer A buka shift BARU di outlet A SENDIRI (device beda) -- BERHASIL", async () => {
      const [devA2] = await adminDb
        .insert(devices)
        .values({ businessId: owner.businessId, outletId: outletAId, serialNumber: `${PREFIX}-DEVA2`, name: "Kasir A2" })
        .returning({ id: devices.id });

      const result = await openShiftWithDb(managerADb, owner.businessId, {
        id: generateId(),
        outletId: outletAId,
        deviceId: devA2!.id,
        employeeCode: "RSEMPA",
        pin: PIN,
        openingCash: "0",
      });

      expect(result.error).toBeUndefined();
      expect(result.success).toBeTruthy();
    });

    it("UPDATE manajer A ke shift outlet B -- NOL baris berubah (RLS UPDATE menyaring baris, bukan melempar), baris TETAP tidak berubah", async () => {
      const updated = await managerADb
        .update(shifts)
        .set({ note: "dicoba manajer A" })
        .where(eq(shifts.id, shiftBId))
        .returning({ id: shifts.id });
      expect(updated).toHaveLength(0);

      const [after] = await adminDb.select({ note: shifts.note }).from(shifts).where(eq(shifts.id, shiftBId));
      expect(after!.note).toBeNull();
    });
  });

  describe("Temuan empiris -- apakah cash_movements ikut terwarisi otomatis?", () => {
    let movementBId: string;

    beforeAll(async () => {
      const [movement] = await owner.db
        .insert(cashMovements)
        .values({ shiftId: shiftBId, type: "cash_in", amount: "50000", reason: "Uji outlet B" })
        .returning({ id: cashMovements.id });
      movementBId = movement!.id;
    });

    it("manajer A (TIDAK berwenang outlet B) SELECT cash_movements outlet B -- diharapkan NOL baris (warisan otomatis lewat EXISTS ke shifts_select)", async () => {
      const rows = await managerADb.select({ id: cashMovements.id }).from(cashMovements).where(eq(cashMovements.id, movementBId));
      expect(rows).toHaveLength(0);
    });

    it("owner TETAP bisa lihat cash_movements outlet B (bukti policy cash_movements sendiri tidak ikut rusak)", async () => {
      const rows = await owner.db.select({ id: cashMovements.id }).from(cashMovements).where(eq(cashMovements.id, movementBId));
      expect(rows).toHaveLength(1);
    });
  });
});
