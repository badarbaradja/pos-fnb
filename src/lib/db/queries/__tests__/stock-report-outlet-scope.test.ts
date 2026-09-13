/**
 * Pembatasan akses per outlet -- Tahap 3 (13 September 2026, §24), halaman
 * 3/6: Laporan Stok (`app/(dashboard)/reports/stock/page.tsx`).
 *
 * BEDA dari Dashboard/Laporan Penjualan: getStokByCategory/getStokStatusSummary/
 * getBarangMenumpuk* SUDAH menerima SATU outletId wajib (bukan array/scope) --
 * halaman ini menampilkan data SATU outlet pada satu waktu, dipilih dari
 * dropdown. Tidak ada agregasi lintas outlet untuk disaring di level fungsi
 * laporan itu sendiri -- risiko ADA di query DAFTAR OUTLET yang mengisi
 * dropdown (dan yang jadi sumber `selectedOutlet` lewat fallback
 * `outletRows[0]` kalau ?outletId= di URL tidak ketemu/di luar cakupan).
 * File ini menguji PERSIS pola query itu -- posMode='thrifting' AND
 * isActive AND outletScopeCondition -- bukan fungsi laporan yang sudah
 * per-definisi tidak butuh tahu apa itu scope.
 *
 * Tiga outlet thrifting dengan kode BEDA (bukan dua) supaya kasus "scope
 * satu outlet" jelas membuktikan outlet LAIN benar-benar tidak ikut,
 * plus satu outlet F&B (posMode != thrifting) untuk membuktikan filter
 * posMode yang sudah ada tidak rusak oleh penambahan outletScopeCondition.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { and, asc, eq } from "drizzle-orm";
import { getAdminDb } from "@/lib/db/client";
import { brands, businesses, outlets } from "@/lib/db/schema";
import { outletScopeCondition } from "@/lib/auth/outlet-scope";
import type { OutletScope } from "@/lib/auth/outlet-scope";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

describe.skipIf(!hasEnv)(
  "Pembatasan akses per outlet, Tahap 3 -- daftar outlet thrifting (Laporan Stok)",
  () => {
    const db = getAdminDb();
    const PREFIX = `TEST_STOCKSCOPE_${Date.now()}`;

    let businessId: string;
    let outletAId: string;
    let outletBId: string;
    let fnbOutletId: string;

    async function listThriftOutlets(allowedOutletIds: OutletScope) {
      return db
        .select({ id: outlets.id, name: outlets.name })
        .from(outlets)
        .where(
          and(
            eq(outlets.businessId, businessId),
            eq(outlets.posMode, "thrifting"),
            eq(outlets.isActive, true),
            outletScopeCondition(allowedOutletIds, outlets.id)
          )
        )
        .orderBy(asc(outlets.createdAt));
    }

    beforeAll(async () => {
      const [business] = await db.insert(businesses).values({ name: `${PREFIX}_business` }).returning({ id: businesses.id });
      businessId = business!.id;
      const [brand] = await db.insert(brands).values({ businessId, name: `${PREFIX}_brand` }).returning({ id: brands.id });

      const [oA] = await db
        .insert(outlets)
        .values({ businessId, brandId: brand!.id, code: "STA", name: "Thrift A", posMode: "thrifting" })
        .returning({ id: outlets.id });
      const [oB] = await db
        .insert(outlets)
        .values({ businessId, brandId: brand!.id, code: "STB", name: "Thrift B", posMode: "thrifting" })
        .returning({ id: outlets.id });
      const [oFnb] = await db
        .insert(outlets)
        .values({ businessId, brandId: brand!.id, code: "STC", name: "FNB C", posMode: "fnb" })
        .returning({ id: outlets.id });
      outletAId = oA!.id;
      outletBId = oB!.id;
      fnbOutletId = oFnb!.id;
    });

    afterAll(async () => {
      if (businessId) {
        await db.delete(businesses).where(eq(businesses.id, businessId));
      }
    });

    it("data uji terbentuk (dua outlet thrifting + satu outlet F&B)", () => {
      expect(outletAId).toBeTruthy();
      expect(outletBId).toBeTruthy();
      expect(fnbOutletId).toBeTruthy();
    });

    it("scope null: KEDUA outlet thrifting muncul, outlet F&B TETAP tidak ikut (filter posMode tidak rusak)", async () => {
      const rows = await listThriftOutlets(null);
      expect(rows.map((r) => r.id).sort()).toEqual([outletAId, outletBId].sort());
    });

    it("scope [outletA]: CUMA outlet A muncul, outlet B (thrifting juga) tidak ada jejaknya", async () => {
      const rows = await listThriftOutlets([outletAId]);
      expect(rows.map((r) => r.id)).toEqual([outletAId]);
    });

    it("scope array KOSONG: NOL outlet, bukan semua outlet thrifting", async () => {
      const rows = await listThriftOutlets([]);
      expect(rows).toHaveLength(0);
    });
  }
);
