/**
 * TT10 — Test integrasi laporan stok barang per kategori. Butuh koneksi
 * Supabase sungguhan, di-skip otomatis kalau env belum diisi.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
import { eq } from "drizzle-orm";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { getAdminDb } from "@/lib/db/client";
import { barang, brands, businesses, categories, outlets } from "@/lib/db/schema";
import { getStokByCategory } from "../barang-report";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

describe.skipIf(!hasEnv)("TT10 — getStokByCategory", () => {
  const db = getAdminDb();
  const PREFIX = `TEST_STOKCAT_${Date.now()}`;

  let businessId: string;
  let outletId: string;
  let categoryWithStockId: string;
  let categoryEmptyId: string;

  beforeAll(async () => {
    const [business] = await db
      .insert(businesses)
      .values({ name: `${PREFIX}_business` })
      .returning({ id: businesses.id });
    businessId = business!.id;

    const [brand] = await db
      .insert(brands)
      .values({ businessId, name: `${PREFIX}_brand` })
      .returning({ id: brands.id });

    const [outlet] = await db
      .insert(outlets)
      .values({ businessId, brandId: brand!.id, code: "STK1", name: `${PREFIX}_outlet`, posMode: "thrifting" })
      .returning({ id: outlets.id });
    outletId = outlet!.id;

    const [catWithStock] = await db
      .insert(categories)
      .values({ businessId, name: `${PREFIX}_Kemeja`, scope: "thrifting" })
      .returning({ id: categories.id });
    categoryWithStockId = catWithStock!.id;

    const [catEmpty] = await db
      .insert(categories)
      .values({ businessId, name: `${PREFIX}_Sepatu`, scope: "thrifting" })
      .returning({ id: categories.id });
    categoryEmptyId = catEmpty!.id;

    // Kategori F&B -- TIDAK BOLEH muncul di laporan thrifting ini.
    await db.insert(categories).values({ businessId, name: `${PREFIX}_Minuman`, scope: "fnb" });

    await db.insert(barang).values([
      {
        businessId,
        outletId,
        kode: `${PREFIX}-1`,
        nama: "Kemeja A",
        hargaJual: "50000",
        status: "siap_jual",
        categoryId: categoryWithStockId,
      },
      {
        businessId,
        outletId,
        kode: `${PREFIX}-2`,
        nama: "Kemeja B",
        hargaJual: "50000",
        status: "terjual",
        categoryId: categoryWithStockId,
      },
      {
        businessId,
        outletId,
        kode: `${PREFIX}-3`,
        nama: "Tanpa Kategori",
        hargaJual: "30000",
        status: "baru_masuk",
        categoryId: null,
      },
    ]);
  });

  afterAll(async () => {
    if (businessId) {
      await db.delete(businesses).where(eq(businesses.id, businessId));
    }
  });

  it("kategori dengan barang menghitung status dengan benar", async () => {
    const rows = await getStokByCategory(db, businessId, outletId);
    const row = rows.find((r) => r.categoryId === categoryWithStockId)!;
    expect(row).toBeTruthy();
    expect(row.siapJual).toBe(1);
    expect(row.terjual).toBe(1);
    expect(row.total).toBe(2);
  });

  it("kategori TANPA barang sama sekali TETAP tampil dengan nol, tidak hilang (LEFT JOIN)", async () => {
    const rows = await getStokByCategory(db, businessId, outletId);
    const row = rows.find((r) => r.categoryId === categoryEmptyId)!;
    expect(row).toBeTruthy();
    expect(row.total).toBe(0);
  });

  it("kategori scope fnb TIDAK ikut muncul di laporan thrifting", async () => {
    const rows = await getStokByCategory(db, businessId, outletId);
    expect(rows.some((r) => r.categoryName === `${PREFIX}_Minuman`)).toBe(false);
  });

  it("barang tanpa kategori terhitung sebagai baris tersendiri (categoryName null -- label 'Tanpa kategori' jadi tanggung jawab UI), tidak hilang", async () => {
    const rows = await getStokByCategory(db, businessId, outletId);
    const row = rows.find((r) => r.categoryId === null)!;
    expect(row).toBeTruthy();
    expect(row.categoryName).toBeNull();
    expect(row.baruMasuk).toBe(1);
  });
});
