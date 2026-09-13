/**
 * Pembatasan akses per outlet -- Tahap 5 (13 September 2026, §31): RLS
 * LEVEL DATABASE untuk `barang`. TABEL TERAKHIR Tahap 5 -- setelah ini
 * berhenti, laporan dulu sebelum Tahap 6. Menggunakan ULANG
 * `auth_outlet_ids()` (dibuat untuk `orders`, migrasi 0033) APA ADANYA
 * -- TIDAK ADA fungsi SQL baru di migrasi ini (0035).
 *
 * Lima skenario (pola sama `rls-orders-outlet-scope.test.ts` dan
 * `rls-shifts-outlet-scope.test.ts`):
 * 1. owner -- lihat barang SEMUA outlet.
 * 2. accountant -- sama.
 * 3. manajer dibatasi outlet A -- lihat outlet A, NOL baris outlet B.
 * 4. membership outlet_ids KOSONG -- nol baris.
 * 5. INSERT/UPDATE ke outlet terlarang -- DITOLAK DATABASE, lewat
 *    `addBarangFromShiftWithDb` SUNGGUHAN ("Ita super kasir",
 *    lib/pos/pos-add-barang.ts) -- BUKAN raw insert, supaya jalur
 *    produksi asli yang terbukti. `saveBarangWithDb` (dipanggil di
 *    dalamnya) TIDAK membungkus error RLS jadi pesan generik seperti
 *    shift.ts -- kegagalannya MELEMPAR (`rejects.toThrow()`), bukan
 *    `{error: ...}` -- dibuktikan di sini, dicatat sebagai utang di
 *    plan doc §31 (beda akar penyebab dari closeAndReopenShiftWithDb).
 *
 * Plus pembuktian empiris: `order_items` (punya `barangId` menunjuk ke
 * `barang`, tapi policy-nya TIDAK PERNAH merujuk `barang` sama sekali,
 * cuma EXISTS ke `orders`) -- apakah kebijakan `barang` memengaruhi
 * pembacaan `order_items`. Order_item yang `barangId`-nya menunjuk
 * barang OUTLET B (di luar cakupan manajer A) tapi order-nya sendiri
 * di OUTLET A (dalam cakupan) -- kalau order_item ini TETAP utuh
 * terlihat, itu bukti `order_items` sepenuhnya independen dari RLS
 * `barang` (cuma bergantung ke RLS `orders`, ditegakkan §29).
 *
 * TEMUAN SAAT MENULIS TES INI (dicatat supaya tidak mengejutkan
 * pembaca berikutnya): dugaan awal "saveBarangWithDb tidak membungkus
 * error RLS, jadi akan MELEMPAR" TERNYATA TIDAK PERNAH TEREKSEKUSI
 * lewat `addBarangFromShiftWithDb` -- shift lookup di baris pertama
 * fungsi itu (`db.select().from(shifts)...`) SUDAH digerbang
 * `shifts_select` outlet-aware (§30, dipasang SEBELUM barang). Manajer
 * A yang tidak berwenang outlet B sudah GAGAL di langkah itu (shift
 * tidak ketemu, `{error: unexpectedError}`, graceful) -- TIDAK PERNAH
 * sampai ke `db.insert(barang)` sama sekali. Lapisan RLS `shifts` yang
 * dipasang lebih dulu MENUTUP celah ini secara transitif untuk jalur
 * INI SPESIFIK, walau celah try/catch di `saveBarangWithDb` sendiri
 * tetap ada secara struktural (dicatat sebagai utang terpisah, bukan
 * berarti tidak nyata -- cuma tidak teraktifkan lewat pemanggil ini).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { eq } from "drizzle-orm";
import { getAdminDb, getUserDb, type UserDbHandle } from "@/lib/db/client";
import { createSupabaseAdminClient, createSupabaseAnonClient } from "@/lib/auth/supabase";
import { barang, brands, devices, employees, memberships, orderItems, orders, outlets, profiles, shifts } from "@/lib/db/schema";
import { hashPin } from "@/lib/auth/pin";
import { createUserDbFixture, type UserDbFixture } from "./helpers/user-db-fixture";
import { addBarangFromShiftWithDb } from "@/lib/pos/pos-add-barang";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

const PIN = "246813";

describe.skipIf(!hasEnv)("Pembatasan akses per outlet, Tahap 5 -- RLS barang (auth_outlet_ids)", () => {
  const PREFIX = `TEST_RLSBRG_${Date.now()}`;
  const adminDb = getAdminDb(); // setup: outlet/device/employee/shift/auth user lain -- CLAUDE.md §3.4
  const admin = createSupabaseAdminClient();
  const extraUserIds: string[] = [];
  const extraCloses: Array<() => Promise<void>> = [];

  let owner: UserDbFixture;
  let outletAId: string;
  let outletBId: string;
  let barangAId: string;
  let barangBId: string;
  let shiftAId: string; // employeeRole 'manager', status open, di outlet A
  let shiftBId: string; // employeeRole 'manager', status open, di outlet B

  let accountantDb: UserDbHandle["db"];
  let managerADb: UserDbHandle["db"];
  let managerEmptyDb: UserDbHandle["db"];

  async function createSignedInMembership(
    label: string,
    role: "accountant" | "manager",
    outletIds: string[] | null
  ): Promise<UserDbHandle["db"]> {
    const email = `${PREFIX.toLowerCase()}_${label}@example.com`;
    const password = "T3st-RlsBarang-P@ssw0rd!";
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
      .values({ businessId: owner.businessId, brandId: brand!.id, code: "RBA", name: "Outlet A" })
      .returning({ id: outlets.id });
    const [oB] = await adminDb
      .insert(outlets)
      .values({ businessId: owner.businessId, brandId: brand!.id, code: "RBB", name: "Outlet B" })
      .returning({ id: outlets.id });
    outletAId = oA!.id;
    outletBId = oB!.id;

    // Barang sungguhan lewat db OWNER asli (RLS aktif, owner unrestricted).
    const [bA] = await owner.db
      .insert(barang)
      .values({ businessId: owner.businessId, outletId: outletAId, kode: `${PREFIX}-A1`, nama: "Baju A", hargaJual: "50000" })
      .returning({ id: barang.id });
    barangAId = bA!.id;

    const [bB] = await owner.db
      .insert(barang)
      .values({ businessId: owner.businessId, outletId: outletBId, kode: `${PREFIX}-B1`, nama: "Baju B", hargaJual: "70000" })
      .returning({ id: barang.id });
    barangBId = bB!.id;

    // Device + employee (role manager, supaya lolos gerbang employeeRole
    // di addBarangFromShiftWithDb) + shift OPEN di masing-masing outlet.
    const pinHash = await hashPin(PIN);
    const [devA] = await adminDb
      .insert(devices)
      .values({ businessId: owner.businessId, outletId: outletAId, serialNumber: `${PREFIX}-DEVA`, name: "Kasir A" })
      .returning({ id: devices.id });
    const [devB] = await adminDb
      .insert(devices)
      .values({ businessId: owner.businessId, outletId: outletBId, serialNumber: `${PREFIX}-DEVB`, name: "Kasir B" })
      .returning({ id: devices.id });

    const [empA] = await adminDb
      .insert(employees)
      .values({ businessId: owner.businessId, outletId: outletAId, code: "RBEMPA", fullName: "Manajer Outlet A", role: "manager", pinHash })
      .returning({ id: employees.id });
    const [empB] = await adminDb
      .insert(employees)
      .values({ businessId: owner.businessId, outletId: outletBId, code: "RBEMPB", fullName: "Manajer Outlet B", role: "manager", pinHash })
      .returning({ id: employees.id });

    const [shiftA] = await adminDb
      .insert(shifts)
      .values({ businessId: owner.businessId, outletId: outletAId, deviceId: devA!.id, employeeId: empA!.id, businessDate: "2026-09-13" })
      .returning({ id: shifts.id });
    shiftAId = shiftA!.id;

    const [shiftB] = await adminDb
      .insert(shifts)
      .values({ businessId: owner.businessId, outletId: outletBId, deviceId: devB!.id, employeeId: empB!.id, businessDate: "2026-09-13" })
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

  it("data uji terbentuk (dua outlet, satu barang tiap outlet, shift open tiap outlet)", () => {
    expect(outletAId).toBeTruthy();
    expect(outletBId).toBeTruthy();
    expect(barangAId).toBeTruthy();
    expect(barangBId).toBeTruthy();
    expect(shiftAId).toBeTruthy();
    expect(shiftBId).toBeTruthy();
  });

  describe("1-2. owner dan accountant -- lihat barang SEMUA outlet", () => {
    it("owner: kedua barang (A dan B) muncul", async () => {
      const rows = await owner.db.select({ id: barang.id }).from(barang).where(eq(barang.businessId, owner.businessId));
      expect(rows.map((r) => r.id).sort()).toEqual([barangAId, barangBId].sort());
    });

    it("accountant: kedua barang (A dan B) muncul juga, walau outlet_ids kolomnya sendiri tidak pernah diisi", async () => {
      const rows = await accountantDb.select({ id: barang.id }).from(barang).where(eq(barang.businessId, owner.businessId));
      expect(rows.map((r) => r.id).sort()).toEqual([barangAId, barangBId].sort());
    });
  });

  describe("3. Manajer dibatasi outlet A -- lihat outlet A, NOL baris outlet B", () => {
    it("cuma barang A yang muncul, barang B tidak terlihat sama sekali", async () => {
      const rows = await managerADb.select({ id: barang.id }).from(barang).where(eq(barang.businessId, owner.businessId));
      expect(rows.map((r) => r.id)).toEqual([barangAId]);
    });
  });

  describe("4. Membership outlet_ids KOSONG -- nol baris sama sekali", () => {
    it("tidak satu barang pun muncul", async () => {
      const rows = await managerEmptyDb.select({ id: barang.id }).from(barang).where(eq(barang.businessId, owner.businessId));
      expect(rows).toHaveLength(0);
    });
  });

  describe("5. INSERT/UPDATE ke outlet terlarang -- DITOLAK DATABASE (jalur addBarangFromShiftWithDb SUNGGUHAN)", () => {
    it("addBarangFromShiftWithDb: manajer A (tablet login-nya cuma outlet A) coba tambah barang dari shift OUTLET B -- DITOLAK LEBIH AWAL di shift lookup (shifts_select §30 sudah menutupnya), TIDAK PERNAH sampai ke db.insert(barang), TIDAK ADA barang baru tertulis", async () => {
      const before = await adminDb.select({ id: barang.id }).from(barang).where(eq(barang.outletId, outletBId));

      // Dugaan awal: ini akan MELEMPAR (saveBarangWithDb tidak
      // membungkus error RLS). Kenyataan: shift lookup di baris
      // pertama addBarangFromShiftWithDb sudah digerbang shifts_select
      // outlet-aware (§30) -- manajer A tidak bisa lihat shift B sama
      // sekali, gagal graceful di situ, TIDAK PERNAH mencapai INSERT
      // barang. Dibuktikan di sini, bukan diasumsikan dari kode saja.
      const result = await addBarangFromShiftWithDb(managerADb, owner.businessId, shiftBId, {
        outletId: outletBId,
        nama: "Percobaan Manajer A",
        hargaJual: "10000",
      });
      expect(result.error).toBeTruthy();

      const after = await adminDb.select({ id: barang.id }).from(barang).where(eq(barang.outletId, outletBId));
      expect(after.length).toBe(before.length);
    });

    it("addBarangFromShiftWithDb: manajer A tambah barang dari shift OUTLET A SENDIRI -- BERHASIL", async () => {
      const result = await addBarangFromShiftWithDb(managerADb, owner.businessId, shiftAId, {
        outletId: outletAId,
        nama: "Barang Baru dari Ita",
        hargaJual: "25000",
      });
      expect(result.error).toBeUndefined();
      expect(result.success).toBeTruthy();
    });

    it("UPDATE manajer A ke barang outlet B -- NOL baris berubah (RLS UPDATE menyaring baris, bukan melempar), baris TETAP tidak berubah", async () => {
      const updated = await managerADb
        .update(barang)
        .set({ nama: "Diubah manajer A" })
        .where(eq(barang.id, barangBId))
        .returning({ id: barang.id });
      expect(updated).toHaveLength(0);

      const [after] = await adminDb.select({ nama: barang.nama }).from(barang).where(eq(barang.id, barangBId));
      expect(after!.nama).toBe("Baju B");
    });

    it("raw INSERT langsung ke barang outlet B (BUKAN lewat addBarangFromShiftWithDb) -- MELEMPAR, membuktikan policy barang_insert sendiri memang menolak (dasar dari catatan try/catch di atas)", async () => {
      await expect(
        managerADb.insert(barang).values({
          businessId: owner.businessId,
          outletId: outletBId,
          kode: `${PREFIX}-RAWTRY`,
          nama: "Raw insert manajer A",
          hargaJual: "1000",
        })
      ).rejects.toThrow();

      const [row] = await adminDb.select().from(barang).where(eq(barang.kode, `${PREFIX}-RAWTRY`));
      expect(row).toBeUndefined();
    });
  });

  describe("Temuan empiris -- apakah order_items terpengaruh policy barang?", () => {
    let orderItemId: string;

    beforeAll(async () => {
      // Order-nya sendiri di OUTLET A (dalam cakupan manajer A, lolos
      // RLS orders §29) TAPI barangId menunjuk barang OUTLET B (di luar
      // cakupan manajer A, RLS barang §31 di atas) -- kombinasi yang
      // sengaja janggal untuk MEMISAHKAN pertanyaan "apakah order_items
      // ikut terpotong outlet barang" dari "apakah order-nya sendiri
      // terlihat".
      //
      // Trigger claim_barang_for_sale() (TT02) mewajibkan barang
      // berstatus 'siap_jual' SEBELUM bisa direferensikan order_items
      // -- barangB dibuat default 'baru_masuk' di beforeAll utama,
      // diubah dulu di sini (owner, unrestricted, tidak tersangkut RLS
      // yang sedang diuji sama sekali).
      await owner.db.update(barang).set({ status: "siap_jual" }).where(eq(barang.id, barangBId));

      const [order] = await owner.db
        .insert(orders)
        .values({ businessId: owner.businessId, outletId: outletAId, number: `${PREFIX}-ORDER-A`, businessDate: "2026-09-13" })
        .returning({ id: orders.id });

      const [item] = await owner.db
        .insert(orderItems)
        .values({
          orderId: order!.id,
          barangId: barangBId,
          productName: "Baju B (dijual di order outlet A)",
          qty: "1",
          unitPrice: "70000",
          grossAmount: "70000",
          netAmount: "70000",
        })
        .returning({ id: orderItems.id });
      orderItemId = item!.id;
    });

    it("manajer A (TIDAK berwenang outlet B, TAPI order-nya di outlet A miliknya) -- order_item TETAP UTUH terlihat, barangId yang dirujuk TIDAK memengaruhi visibilitasnya", async () => {
      const rows = await managerADb
        .select({ id: orderItems.id, barangId: orderItems.barangId })
        .from(orderItems)
        .where(eq(orderItems.id, orderItemId));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.barangId).toBe(barangBId);
    });

    it("konfirmasi silang: manajer A memang TIDAK BISA melihat barang B secara langsung (supaya perbandingan di atas berarti, bukan kebetulan scope-nya luas)", async () => {
      const rows = await managerADb.select({ id: barang.id }).from(barang).where(eq(barang.id, barangBId));
      expect(rows).toHaveLength(0);
    });
  });
});
