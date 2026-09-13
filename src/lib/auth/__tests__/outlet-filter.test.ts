/**
 * Pembatasan akses per outlet -- Tahap 2 (13 September 2026, §22): utilitas
 * filter + assert. MASIH BELUM dipasang ke halaman/Server Action mana pun
 * (Tahap 3/4) -- file ini menguji lib/auth/outlet-scope.ts sendirian.
 *
 * Fokus permintaan CEO yang WAJIB dibuktikan lewat tes, bukan cuma dipercaya
 * dari nama fungsi:
 * 1. null (tak terbatas) TIDAK PERNAH dibaca sebagai array kosong (kalau
 *    salah, CEO/owner kehilangan semua data) DAN array kosong TIDAK PERNAH
 *    dibaca sebagai null (kalau salah, orang tanpa akses melihat semuanya)
 *    -- dua arah, dites lewat query DB SUNGGUHAN (bukan cuma nilai balik
 *    fungsi murni), supaya SQL yang dihasilkan benar-benar diverifikasi.
 * 2. assertOutletAllowed() MELEMPAR, tidak pernah cuma mengembalikan false
 *    yang bisa diabaikan pemanggil.
 * 3. Transfer stok (dua kolom outlet) dites terpisah dari kolom tunggal.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { and, eq } from "drizzle-orm";
import { getAdminDb } from "@/lib/db/client";
import { brands, businesses, devices, outlets, stockTransfers } from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";
import {
  assertOutletAllowed,
  intersectOutletScope,
  isOutletAllowed,
  outletScopeCondition,
  outletScopeConditionForTransfer,
} from "../outlet-scope";

describe("intersectOutletScope — fungsi murni, tanpa DB", () => {
  const outletA = generateId();
  const outletB = generateId();
  const outletC = generateId();

  it("allowedOutletIds null (tak terbatas): hasil SELALU pageFilter apa adanya", () => {
    expect(intersectOutletScope(null, null)).toBeNull();
    expect(intersectOutletScope(null, [outletA])).toEqual([outletA]);
    expect(intersectOutletScope(null, [])).toEqual([]);
  });

  it("pageFilter null (halaman tidak membatasi): hasil SELALU allowedOutletIds apa adanya", () => {
    expect(intersectOutletScope([outletA], null)).toEqual([outletA]);
    expect(intersectOutletScope([], null)).toEqual([]);
  });

  it("keduanya array dengan irisan: hasilnya CUMA outlet yang ada di dua-duanya", () => {
    const result = intersectOutletScope([outletA, outletB], [outletB, outletC]);
    expect(result).toEqual([outletB]);
  });

  it("keduanya array TANPA irisan sama sekali: hasilnya array KOSONG, BUKAN null", () => {
    const result = intersectOutletScope([outletA], [outletB]);
    expect(result).toEqual([]);
    expect(result).not.toBeNull();
  });

  it("allowedOutletIds array KOSONG (tidak ada akses): hasil TETAP kosong walau pageFilter mengizinkan outlet lain", () => {
    expect(intersectOutletScope([], [outletA])).toEqual([]);
  });
});

describe("isOutletAllowed / assertOutletAllowed — fungsi murni, tanpa DB", () => {
  const outletA = generateId();
  const outletB = generateId();

  it("scope null (tak terbatas): outlet MANA PUN diizinkan", () => {
    expect(isOutletAllowed(null, outletA)).toBe(true);
    expect(isOutletAllowed(null, outletB)).toBe(true);
    expect(() => assertOutletAllowed(null, outletA, "tes")).not.toThrow();
  });

  it("scope array KOSONG (tidak ada akses): outlet MANA PUN ditolak -- TIDAK dibaca sebagai null", () => {
    expect(isOutletAllowed([], outletA)).toBe(false);
    expect(() => assertOutletAllowed([], outletA, "tes")).toThrow();
  });

  it("scope spesifik: cuma outlet yang terdaftar diizinkan, sisanya ditolak", () => {
    expect(isOutletAllowed([outletA], outletA)).toBe(true);
    expect(isOutletAllowed([outletA], outletB)).toBe(false);
    expect(() => assertOutletAllowed([outletA], outletA, "tes")).not.toThrow();
    expect(() => assertOutletAllowed([outletA], outletB, "tes")).toThrow();
  });

  it("assertOutletAllowed() mengembalikan void, BUKAN boolean yang bisa diabaikan -- gagal selalu berupa exception", () => {
    const result: void = assertOutletAllowed(null, outletA, "tes");
    expect(result).toBeUndefined();
  });

  it("pesan error assertOutletAllowed menyertakan context yang diberikan pemanggil (mempermudah debug jalur non-UI)", () => {
    expect(() => assertOutletAllowed([], outletA, "updateOrderWithDb")).toThrow(/updateOrderWithDb/);
  });
});

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

describe.skipIf(!hasEnv)("outletScopeCondition — kolom tunggal, dibuktikan lewat query DB sungguhan", () => {
  const adminDb = getAdminDb(); // setup fixture murni, tidak ada sesi user yang relevan untuk diuji di sini (CLAUDE.md §3.4) -- benar/salahnya SQL yang dihasilkan tidak bergantung RLS
  const PREFIX = `TEST_OUTLETFILTER_${Date.now()}`;
  let businessId: string;
  let outletAId: string;
  let outletBId: string;

  beforeAll(async () => {
    const [business] = await adminDb.insert(businesses).values({ name: `${PREFIX}_biz` }).returning({ id: businesses.id });
    businessId = business!.id;
    const [brand] = await adminDb.insert(brands).values({ businessId, name: `${PREFIX}_brand` }).returning({ id: brands.id });
    const [oA] = await adminDb
      .insert(outlets)
      .values({ businessId, brandId: brand!.id, code: "OFA", name: "Outlet A" })
      .returning({ id: outlets.id });
    const [oB] = await adminDb
      .insert(outlets)
      .values({ businessId, brandId: brand!.id, code: "OFB", name: "Outlet B" })
      .returning({ id: outlets.id });
    outletAId = oA!.id;
    outletBId = oB!.id;

    await adminDb.insert(devices).values([
      { businessId, outletId: outletAId, serialNumber: "OFA-DEV1", name: "Device A" },
      { businessId, outletId: outletBId, serialNumber: "OFB-DEV1", name: "Device B" },
    ]);
  });

  afterAll(async () => {
    await adminDb.delete(businesses).where(eq(businesses.id, businessId));
  });

  it("data uji terbentuk (dua device, satu per outlet)", async () => {
    const rows = await adminDb.select().from(devices).where(eq(devices.businessId, businessId));
    expect(rows).toHaveLength(2);
  });

  it("scope null: SEMUA device kembali -- null TIDAK dibaca sebagai kosong", async () => {
    const rows = await adminDb
      .select({ id: devices.id })
      .from(devices)
      .where(and(eq(devices.businessId, businessId), outletScopeCondition(null, devices.outletId)));
    expect(rows).toHaveLength(2);
  });

  it("scope array KOSONG: NOL device kembali -- kosong TIDAK dibaca sebagai null", async () => {
    const rows = await adminDb
      .select({ id: devices.id })
      .from(devices)
      .where(and(eq(devices.businessId, businessId), outletScopeCondition([], devices.outletId)));
    expect(rows).toHaveLength(0);
  });

  it("scope [outletA]: CUMA device outlet A kembali", async () => {
    const rows = await adminDb
      .select({ id: devices.id, outletId: devices.outletId })
      .from(devices)
      .where(and(eq(devices.businessId, businessId), outletScopeCondition([outletAId], devices.outletId)));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.outletId).toBe(outletAId);
  });
});

describe.skipIf(!hasEnv)(
  "outletScopeConditionForTransfer — fromOutletId ATAU toOutletId, dibuktikan lewat query DB sungguhan",
  () => {
    const adminDb = getAdminDb(); // setup fixture murni -- CLAUDE.md §3.4
    const PREFIX = `TEST_OUTLETFILTERXFER_${Date.now()}`;
    let businessId: string;
    let outletAId: string;
    let outletBId: string;
    let outletCId: string;
    let transferAToB: string;
    let transferBToC: string;

    beforeAll(async () => {
      const [business] = await adminDb.insert(businesses).values({ name: `${PREFIX}_biz` }).returning({ id: businesses.id });
      businessId = business!.id;
      const [brand] = await adminDb.insert(brands).values({ businessId, name: `${PREFIX}_brand` }).returning({ id: brands.id });
      const [oA] = await adminDb
        .insert(outlets)
        .values({ businessId, brandId: brand!.id, code: "XFA", name: "Outlet A" })
        .returning({ id: outlets.id });
      const [oB] = await adminDb
        .insert(outlets)
        .values({ businessId, brandId: brand!.id, code: "XFB", name: "Outlet B" })
        .returning({ id: outlets.id });
      const [oC] = await adminDb
        .insert(outlets)
        .values({ businessId, brandId: brand!.id, code: "XFC", name: "Outlet C" })
        .returning({ id: outlets.id });
      outletAId = oA!.id;
      outletBId = oB!.id;
      outletCId = oC!.id;

      // Sengaja B muncul di DUA baris dengan peran BERBEDA (to di baris 1,
      // from di baris 2) -- ini yang membuktikan OR lintas kolom DAN
      // lintas baris, bukan cuma satu kolom yang kebetulan cocok.
      const [tAB] = await adminDb
        .insert(stockTransfers)
        .values({ businessId, fromOutletId: outletAId, toOutletId: outletBId })
        .returning({ id: stockTransfers.id });
      const [tBC] = await adminDb
        .insert(stockTransfers)
        .values({ businessId, fromOutletId: outletBId, toOutletId: outletCId })
        .returning({ id: stockTransfers.id });
      transferAToB = tAB!.id;
      transferBToC = tBC!.id;
    });

    afterAll(async () => {
      // stock_transfers.business_id TIDAK cascade dari businesses (NO
      // ACTION, pola sama shifts.employee_id di lib/employees/__tests__/
      // manage.test.ts) -- hapus dulu sebelum businesses.
      await adminDb.delete(stockTransfers).where(eq(stockTransfers.businessId, businessId));
      await adminDb.delete(businesses).where(eq(businesses.id, businessId));
    });

    it("data uji terbentuk (dua transfer, A->B dan B->C)", async () => {
      const rows = await adminDb.select().from(stockTransfers).where(eq(stockTransfers.businessId, businessId));
      expect(rows).toHaveLength(2);
    });

    it("scope null: KEDUA transfer kembali", async () => {
      const rows = await adminDb
        .select({ id: stockTransfers.id })
        .from(stockTransfers)
        .where(
          and(
            eq(stockTransfers.businessId, businessId),
            outletScopeConditionForTransfer(null, stockTransfers.fromOutletId, stockTransfers.toOutletId)
          )
        );
      expect(rows).toHaveLength(2);
    });

    it("scope array KOSONG: NOL transfer kembali", async () => {
      const rows = await adminDb
        .select({ id: stockTransfers.id })
        .from(stockTransfers)
        .where(
          and(
            eq(stockTransfers.businessId, businessId),
            outletScopeConditionForTransfer([], stockTransfers.fromOutletId, stockTransfers.toOutletId)
          )
        );
      expect(rows).toHaveLength(0);
    });

    it("scope [outletA]: cuma transfer A->B (A muncul sebagai FROM di situ, tidak muncul sama sekali di B->C)", async () => {
      const rows = await adminDb
        .select({ id: stockTransfers.id })
        .from(stockTransfers)
        .where(
          and(
            eq(stockTransfers.businessId, businessId),
            outletScopeConditionForTransfer([outletAId], stockTransfers.fromOutletId, stockTransfers.toOutletId)
          )
        );
      expect(rows.map((r) => r.id)).toEqual([transferAToB]);
    });

    it("scope [outletB]: KEDUA transfer kembali -- B adalah TO di baris pertama DAN FROM di baris kedua (bukti OR, bukan AND)", async () => {
      const rows = await adminDb
        .select({ id: stockTransfers.id })
        .from(stockTransfers)
        .where(
          and(
            eq(stockTransfers.businessId, businessId),
            outletScopeConditionForTransfer([outletBId], stockTransfers.fromOutletId, stockTransfers.toOutletId)
          )
        );
      expect(rows.map((r) => r.id).sort()).toEqual([transferAToB, transferBToC].sort());
    });

    it("scope [outletC]: cuma transfer B->C (C cuma muncul sebagai TO di situ)", async () => {
      const rows = await adminDb
        .select({ id: stockTransfers.id })
        .from(stockTransfers)
        .where(
          and(
            eq(stockTransfers.businessId, businessId),
            outletScopeConditionForTransfer([outletCId], stockTransfers.fromOutletId, stockTransfers.toOutletId)
          )
        );
      expect(rows.map((r) => r.id)).toEqual([transferBToC]);
    });
  }
);
