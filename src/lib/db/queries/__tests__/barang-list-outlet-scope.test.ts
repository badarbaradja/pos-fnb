/**
 * Pembatasan akses per outlet -- Tahap 3 (13 September 2026, §24), halaman
 * 4/6: Barang -- daftar + cetak label (`app/(dashboard)/barang/page.tsx`,
 * `app/(dashboard)/barang/[id]/label/page.tsx`).
 *
 * Halaman tulis (form intake barang, Server Action) SENGAJA TIDAK
 * disentuh (Tahap 3 cuma baca-saja) -- yang diuji di sini murni daftar
 * (WHERE barang.outlet_id) dan halaman cetak label (akses langsung by-id
 * lewat URL, jalur non-UI yang CEO minta diuji eksplisit).
 *
 * Dua barang dengan KODE/HARGA BEDA di outlet berbeda -- kalau
 * implementasinya salah menyaring outlet, ketahuan langsung dari kode
 * mana yang muncul, bukan cuma dari jumlah baris.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { and, eq } from "drizzle-orm";
import { getAdminDb } from "@/lib/db/client";
import { barang, brands, businesses, outlets } from "@/lib/db/schema";
import { outletScopeCondition, isOutletAllowed } from "@/lib/auth/outlet-scope";
import type { OutletScope } from "@/lib/auth/outlet-scope";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

describe.skipIf(!hasEnv)("Pembatasan akses per outlet, Tahap 3 -- daftar barang (Barang)", () => {
  const db = getAdminDb();
  const PREFIX = `TEST_BARANGSCOPE_${Date.now()}`;

  let businessId: string;
  let outletAId: string;
  let outletBId: string;
  let barangAId: string;
  let barangBId: string;

  async function listBarang(allowedOutletIds: OutletScope) {
    return db
      .select({ id: barang.id, kode: barang.kode })
      .from(barang)
      .where(and(eq(barang.businessId, businessId), outletScopeCondition(allowedOutletIds, barang.outletId)));
  }

  beforeAll(async () => {
    const [business] = await db.insert(businesses).values({ name: `${PREFIX}_business` }).returning({ id: businesses.id });
    businessId = business!.id;
    const [brand] = await db.insert(brands).values({ businessId, name: `${PREFIX}_brand` }).returning({ id: brands.id });

    const [oA] = await db
      .insert(outlets)
      .values({ businessId, brandId: brand!.id, code: "BGA", name: "Barang A", posMode: "thrifting" })
      .returning({ id: outlets.id });
    const [oB] = await db
      .insert(outlets)
      .values({ businessId, brandId: brand!.id, code: "BGB", name: "Barang B", posMode: "thrifting" })
      .returning({ id: outlets.id });
    outletAId = oA!.id;
    outletBId = oB!.id;

    const [bA] = await db
      .insert(barang)
      .values({ businessId, outletId: outletAId, kode: "BGA-0001", nama: "Kemeja A", hargaJual: "75000" })
      .returning({ id: barang.id });
    const [bB] = await db
      .insert(barang)
      .values({ businessId, outletId: outletBId, kode: "BGB-0001", nama: "Celana B", hargaJual: "120000" })
      .returning({ id: barang.id });
    barangAId = bA!.id;
    barangBId = bB!.id;
  });

  afterAll(async () => {
    if (businessId) {
      await db.delete(businesses).where(eq(businesses.id, businessId));
    }
  });

  it("data uji terbentuk (dua barang, outlet+kode berbeda)", () => {
    expect(barangAId).toBeTruthy();
    expect(barangBId).toBeTruthy();
  });

  it("scope null: KEDUA barang muncul", async () => {
    const rows = await listBarang(null);
    expect(rows.map((r) => r.kode).sort()).toEqual(["BGA-0001", "BGB-0001"]);
  });

  it("scope [outletA]: CUMA barang outlet A (BGA-0001) muncul, barang outlet B tidak ada jejaknya", async () => {
    const rows = await listBarang([outletAId]);
    expect(rows.map((r) => r.kode)).toEqual(["BGA-0001"]);
  });

  it("scope array KOSONG: NOL barang, bukan semua barang", async () => {
    const rows = await listBarang([]);
    expect(rows).toHaveLength(0);
  });

  describe("halaman cetak label -- akses langsung by-id lewat URL", () => {
    it("scope null: barang outlet MANA PUN boleh diakses", () => {
      expect(isOutletAllowed(null, outletAId)).toBe(true);
      expect(isOutletAllowed(null, outletBId)).toBe(true);
    });

    it("scope [outletA]: label barang outlet A boleh, label barang outlet B DITOLAK (walau di-ID langsung lewat URL)", () => {
      expect(isOutletAllowed([outletAId], outletAId)).toBe(true);
      expect(isOutletAllowed([outletAId], outletBId)).toBe(false);
    });

    it("scope array KOSONG: label outlet MANA PUN ditolak", () => {
      expect(isOutletAllowed([], outletAId)).toBe(false);
      expect(isOutletAllowed([], outletBId)).toBe(false);
    });
  });
});
