/**
 * Rencana Revisi 24 September 2026 §7 poin 4 — opname terikat shift
 * ('buka'/'tutup'), test integrasi. "Test wajib" dari instruksi CEO:
 *
 *   1. Nol bahan berflag TIDAK memblokir buka shift sama sekali.
 *   2. Selisih di luar ambang DITOLAK tanpa alasan (untuk 'tutup', baseline
 *      systemQty; untuk 'buka', baseline stock_movements.balanceAfter).
 *   3. Shift pertama di outlet TIDAK menampilkan/mewajibkan selisih palsu
 *      (tidak ada pembanding sama sekali).
 *
 * Ditambah satu test getOpeningOpnameStatus langsung ke DB (bukan cuma
 * unit murni checkShiftSellability di lib/pos/__tests__/shift.test.ts)
 * supaya jalur getFlaggedIngredientIds -> status sungguhan ikut terbukti,
 * bukan cuma fungsi murninya.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
import { and, eq } from "drizzle-orm";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { getAdminDb } from "@/lib/db/client";
import {
  brands,
  employees,
  ingredients,
  outlets,
  shifts,
  stockLevels,
  stockMovements,
  stockOpnames,
} from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";
import { getOrCreateShiftOpnameWithDb, getOpeningOpnameStatus, getShiftOpnameItemsForSession } from "../shift-opname";
import { submitOpnameWithDb, upsertOpnameItemsBulkWithDb } from "../manage";
import { createUserDbFixture, type UserDbFixture } from "@/lib/db/__tests__/helpers/user-db-fixture";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

describe.skipIf(!hasEnv)("stock-opnames/shift-opname", () => {
  let fixture: UserDbFixture;
  let outletId: string;
  let employeeId: string;
  const BUSINESS_DATE = "2026-09-24";

  beforeAll(async () => {
    fixture = await createUserDbFixture("TEST_SHIFT_OPNAME");
    const { db, businessId } = fixture;

    const [brand] = await db
      .insert(brands)
      .values({ businessId, name: "BrandShiftOpname" })
      .returning({ id: brands.id });

    const [outletRow] = await db
      .insert(outlets)
      .values({
        businessId,
        brandId: brand!.id,
        code: "SOP",
        name: "Outlet Shift Opname",
        // Ambang kecil supaya test mudah memicu/menghindar wajib alasan.
        varianceAlertValue: "1000",
        varianceAlertPercent: "5",
      })
      .returning({ id: outlets.id });
    outletId = outletRow!.id;

    const [emp] = await db
      .insert(employees)
      .values({ businessId, code: "SOPR1", fullName: "Petugas Shift Opname", role: "cashier", pinHash: null })
      .returning({ id: employees.id });
    employeeId = emp!.id;
  });

  afterAll(async () => {
    if (fixture) {
      // deleteBlockingRowsForBusiness (fixture.cleanup) menemukan tabel yang
      // memblokir DELETE businesses lewat FK LANGSUNG ke businesses(id) --
      // stock_opnames.shift_id -> shifts.id (migrasi 24 September 2026, ON
      // DELETE NO ACTION) TIDAK terdeteksi lewat itu (FK-nya ke shifts,
      // bukan businesses), tapi TETAP memblokir DELETE shifts sampai baris
      // stock_opnames-nya hilang lebih dulu. Dibersihkan manual di sini
      // (adminDb -- test infra, bukan kode aplikasi) SEBELUM fixture.cleanup()
      // mencoba menghapus shifts, supaya urutan itu tidak gagal. Item-nya
      // ikut lenyap lewat ON DELETE CASCADE stock_opname_items.opname_id.
      const adminDb = getAdminDb(); // sistem: pembersihan data uji, bukan RLS aplikasi
      await adminDb.delete(stockOpnames).where(eq(stockOpnames.businessId, fixture.businessId));
      await fixture.cleanup();
    }
  });

  async function makeShift(businessId: string, openedAt: Date, status: "open" | "closed" | "reconciled" = "open") {
    const { db } = fixture;
    const [row] = await db
      .insert(shifts)
      .values({
        id: generateId(),
        businessId,
        outletId,
        employeeId,
        status,
        openedAt,
        businessDate: BUSINESS_DATE,
        openingCash: "0",
      })
      .returning({ id: shifts.id });
    return row!.id;
  }

  // ─── Test wajib #1: nol bahan berflag -> tidak memblokir ───────────────

  it("getOpeningOpnameStatus: nol bahan berflag di bisnis ini -> 'not_required'", async () => {
    const { db, businessId } = fixture;
    // Bisnis fixture ini belum punya bahan berflag apa pun sejauh ini.
    const shiftId = await makeShift(businessId, new Date());
    const status = await getOpeningOpnameStatus(db, { businessId, shiftId });
    expect(status).toBe("not_required");
  });

  // ─── Test wajib #3: shift pertama -> tidak ada selisih palsu ───────────

  it("shift PERTAMA di outlet: submit opname 'buka' TANPA alasan berhasil walau fisik jauh dari nol (tidak ada pembanding)", async () => {
    const { db, businessId } = fixture;

    const [ing] = await db
      .insert(ingredients)
      .values({
        businessId,
        name: "Bahan Flag Pertama",
        baseUnit: "gram",
        purchaseUnit: "kg",
        purchaseFactor: "1000",
        hitungTiapShift: true,
      })
      .returning({ id: ingredients.id });
    const ingredientId = ing!.id;

    // Shift PERTAMA di outlet ini -- belum ada shift lain sama sekali,
    // dan bahan ini belum pernah punya stock_movements.
    const shiftId = await makeShift(businessId, new Date());

    const status = await getOpeningOpnameStatus(db, { businessId, shiftId });
    expect(status).toBe("pending"); // ada 1 bahan berflag, opname belum submitted

    const opname = await getOrCreateShiftOpnameWithDb(db, {
      businessId,
      outletId,
      shiftId,
      jenis: "buka",
      businessDate: BUSINESS_DATE,
    });

    const { items, isFirstShiftAtOutlet } = await getShiftOpnameItemsForSession(db, {
      businessId,
      outletId,
      opnameId: opname.id,
      jenis: "buka",
      shiftId,
    });
    expect(isFirstShiftAtOutlet).toBe(true);
    const item = items.find((i) => i.ingredientId === ingredientId)!;
    expect(item.previousClosingBalance).toBeNull(); // TIDAK ADA pembanding

    // Fisik jauh dari nol, TANPA alasan -- harus tetap berhasil karena
    // tidak ada baseline untuk dibandingkan sama sekali.
    await upsertOpnameItemsBulkWithDb(db, {
      businessId,
      outletId,
      opnameId: opname.id,
      items: [{ ingredientId, physicalQty: "5000", unitCost: "4800" }],
    });

    await expect(
      submitOpnameWithDb(db, {
        businessId,
        outletId,
        opnameId: opname.id,
        submittedByEmployeeId: employeeId,
        businessDate: BUSINESS_DATE,
      })
    ).resolves.toMatchObject({ movementsCreated: 1 });

    const doneStatus = await getOpeningOpnameStatus(db, { businessId, shiftId });
    expect(doneStatus).toBe("done");
  });

  // ─── Test wajib #2: selisih di luar ambang DITOLAK tanpa alasan ────────

  it("opname 'tutup': selisih di luar ambang DITOLAK tanpa alasan, DITERIMA dengan alasan", async () => {
    const { db, businessId } = fixture;

    const [ing] = await db
      .insert(ingredients)
      .values({
        businessId,
        name: "Bahan Flag Tutup",
        baseUnit: "pcs",
        purchaseUnit: "pack",
        purchaseFactor: "24",
        hitungTiapShift: true,
      })
      .returning({ id: ingredients.id });
    const ingredientId = ing!.id;

    // systemQty = 100 pcs @ Rp5.000 -- ambang outlet Rp1.000/5%.
    await db.insert(stockLevels).values({
      businessId,
      ingredientId,
      outletId,
      qtyOnHand: "100",
      avgCost: "5000",
    });

    const shiftId = await makeShift(businessId, new Date());
    const opname = await getOrCreateShiftOpnameWithDb(db, {
      businessId,
      outletId,
      shiftId,
      jenis: "tutup",
      businessDate: BUSINESS_DATE,
    });

    // Selisih -20 pcs x Rp5.000 = Rp100.000, jauh di atas ambang Rp1.000/5%.
    await upsertOpnameItemsBulkWithDb(db, {
      businessId,
      outletId,
      opnameId: opname.id,
      items: [{ ingredientId, physicalQty: "80", unitCost: "5000" }],
    });

    await expect(
      submitOpnameWithDb(db, {
        businessId,
        outletId,
        opnameId: opname.id,
        submittedByEmployeeId: employeeId,
        businessDate: BUSINESS_DATE,
      })
    ).rejects.toThrow(/alasan wajib/i);

    // Isi alasan -- submit berikutnya harus berhasil.
    await upsertOpnameItemsBulkWithDb(db, {
      businessId,
      outletId,
      opnameId: opname.id,
      items: [{ ingredientId, physicalQty: "80", unitCost: "5000", varianceReason: "Tumpah saat bongkar." }],
    });

    await expect(
      submitOpnameWithDb(db, {
        businessId,
        outletId,
        opnameId: opname.id,
        submittedByEmployeeId: employeeId,
        businessDate: BUSINESS_DATE,
      })
    ).resolves.toMatchObject({ movementsCreated: 1 });
  });

  it("opname 'buka': selisih di luar ambang (baseline dari stock_movements.balanceAfter shift sebelumnya) DITOLAK tanpa alasan", async () => {
    const { db, businessId } = fixture;

    const [ing] = await db
      .insert(ingredients)
      .values({
        businessId,
        name: "Bahan Flag Buka Kedua",
        baseUnit: "gram",
        purchaseUnit: "kg",
        purchaseFactor: "1000",
        hitungTiapShift: true,
      })
      .returning({ id: ingredients.id });
    const ingredientId = ing!.id;

    // qtyOnHand SENGAJA beda dari physicalQty closing di bawah (190 vs
    // 200) -- opname dengan selisih NOL tidak menulis stock_movement sama
    // sekali (lihat submitOpnameWithDb: variance.isZero() -> skip insert),
    // jadi tidak akan ada balanceAfter untuk dibaca sebagai baseline kalau
    // dibiarkan pas.
    await db.insert(stockLevels).values({
      businessId,
      ingredientId,
      outletId,
      qtyOnHand: "190",
      avgCost: "4800",
    });

    // Shift SEBELUMNYA (sudah closed) -- tutup dengan opname supaya ada
    // movement/balanceAfter di ledger untuk dibaca sebagai baseline 'buka'
    // shift berikutnya.
    const shiftLamaId = await makeShift(businessId, new Date(Date.now() - 60 * 60 * 1000), "closed");
    const opnameLama = await getOrCreateShiftOpnameWithDb(db, {
      businessId,
      outletId,
      shiftId: shiftLamaId,
      jenis: "tutup",
      businessDate: BUSINESS_DATE,
    });
    // Selisih +10 (190 -> 200) supaya movement (dan balanceAfter) sungguh
    // tertulis, sekaligus di bawah ambang (Rp48.000 < Rp... tunggu, cek
    // komentar submit di bawah) -- reason tidak wajib di opname LAMA ini,
    // fokus test ada di opname BARU.
    await upsertOpnameItemsBulkWithDb(db, {
      businessId,
      outletId,
      opnameId: opnameLama.id,
      items: [{ ingredientId, physicalQty: "200", unitCost: "4800", varianceReason: "Setup baseline test." }],
    });
    await submitOpnameWithDb(db, {
      businessId,
      outletId,
      opnameId: opnameLama.id,
      submittedByEmployeeId: employeeId,
      businessDate: BUSINESS_DATE,
    });

    // shiftBaru.openedAt HARUS setelah movement.createdAt (movement dibuat
    // dengan defaultNow() di server DB) supaya query baseline (lt(...))
    // di getShiftOpnameItemsForSession menemukannya. Dibaca balik dari DB
    // dan diberi offset, BUKAN `new Date()` dari mesin test ini -- jam
    // lokal bisa tidak sinkron dengan jam server Postgres (Supabase remote),
    // dan `new Date()` lokal yang kebetulan LEBIH AWAL dari now() server
    // akan membuat perbandingan lt() salah walau urutan kejadian sungguhan
    // sudah benar.
    const [movementLama] = await db
      .select({ createdAt: stockMovements.createdAt })
      .from(stockMovements)
      .where(and(eq(stockMovements.ingredientId, ingredientId), eq(stockMovements.outletId, outletId)));
    const shiftBaruOpenedAt = new Date(movementLama!.createdAt.getTime() + 1000);

    // Shift BARU -- bukan shift pertama outlet ini lagi.
    const shiftBaruId = await makeShift(businessId, shiftBaruOpenedAt);
    const opnameBaru = await getOrCreateShiftOpnameWithDb(db, {
      businessId,
      outletId,
      shiftId: shiftBaruId,
      jenis: "buka",
      businessDate: BUSINESS_DATE,
    });

    const { items, isFirstShiftAtOutlet } = await getShiftOpnameItemsForSession(db, {
      businessId,
      outletId,
      opnameId: opnameBaru.id,
      jenis: "buka",
      shiftId: shiftBaruId,
    });
    expect(isFirstShiftAtOutlet).toBe(false);
    const item = items.find((i) => i.ingredientId === ingredientId)!;
    expect(item.previousClosingBalance).toBe("200.0000"); // saldo akhir shift lama

    // Fisik 150 vs baseline 200 -- selisih -50g x Rp4.800 = Rp240.000, di
    // atas ambang.
    await upsertOpnameItemsBulkWithDb(db, {
      businessId,
      outletId,
      opnameId: opnameBaru.id,
      items: [{ ingredientId, physicalQty: "150", unitCost: "4800" }],
    });

    await expect(
      submitOpnameWithDb(db, {
        businessId,
        outletId,
        opnameId: opnameBaru.id,
        submittedByEmployeeId: employeeId,
        businessDate: BUSINESS_DATE,
      })
    ).rejects.toThrow(/alasan wajib/i);
  });

  // ─── Idempoten: getOrCreateShiftOpnameWithDb dipanggil dua kali ────────

  it("getOrCreateShiftOpnameWithDb idempoten -- panggilan kedua mengembalikan sesi yang sama", async () => {
    const { db, businessId } = fixture;
    const shiftId = await makeShift(businessId, new Date());

    const first = await getOrCreateShiftOpnameWithDb(db, {
      businessId,
      outletId,
      shiftId,
      jenis: "buka",
      businessDate: BUSINESS_DATE,
    });
    const second = await getOrCreateShiftOpnameWithDb(db, {
      businessId,
      outletId,
      shiftId,
      jenis: "buka",
      businessDate: BUSINESS_DATE,
    });
    expect(second.id).toBe(first.id);
  });
});
