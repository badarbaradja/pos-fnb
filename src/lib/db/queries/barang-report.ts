import { and, eq, isNull, sql } from "drizzle-orm";
import type { UserDbHandle } from "@/lib/db/client";
import { barang, categories } from "@/lib/db/schema";

type Db = UserDbHandle["db"];

/**
 * lib/db/queries/barang-report.ts — TT10, laporan stok barang per
 * kategori. Pola sama getSalesByBrand (lib/db/queries/sales-report.ts
 * §13) -- LEFT JOIN dari `categories` (tabel dimensi yang harus selalu
 * tampil), bukan dari `barang`, supaya kategori dengan nol barang tetap
 * muncul sebagai baris nol, bukan hilang.
 *
 * Status stok per outlet (baru_masuk/siap_jual/terjual/rusak) dan daftar
 * umur barang menumpuk SUDAH ADA di lib/pos/thrift-statistik.ts
 * (getStokStatusSummary, getBarangMenumpuk, getBarangMenumpukDays) --
 * dipakai ulang apa adanya oleh halaman laporan ini, TIDAK diduplikasi
 * di sini.
 */

export type StokByCategoryRow = {
  categoryId: string | null;
  categoryName: string | null; // null = tanpa kategori -- label ("Tanpa kategori") jadi tanggung jawab UI/i18n, sama pola categoryName di sales-report.ts
  baruMasuk: number;
  siapJual: number;
  terjual: number;
  rusak: number;
  total: number;
};

export async function getStokByCategory(
  db: Db,
  businessId: string,
  outletId: string
): Promise<StokByCategoryRow[]> {
  const categorized = await db
    .select({
      categoryId: categories.id,
      categoryName: categories.name,
      baruMasuk: sql<string>`count(${barang.id}) filter (where ${barang.status} = 'baru_masuk')`,
      siapJual: sql<string>`count(${barang.id}) filter (where ${barang.status} = 'siap_jual')`,
      terjual: sql<string>`count(${barang.id}) filter (where ${barang.status} = 'terjual')`,
      rusak: sql<string>`count(${barang.id}) filter (where ${barang.status} = 'rusak')`,
    })
    .from(categories)
    .leftJoin(
      barang,
      and(eq(barang.categoryId, categories.id), eq(barang.outletId, outletId))
    )
    .where(
      and(
        eq(categories.businessId, businessId),
        eq(categories.scope, "thrifting"),
        eq(categories.isActive, true)
      )
    )
    .groupBy(categories.id, categories.name)
    .orderBy(categories.name);

  // Barang TANPA kategori (categoryId null) tidak pernah muncul lewat
  // LEFT JOIN dari categories di atas -- dihitung terpisah supaya tidak
  // diam-diam hilang dari total laporan.
  const [uncategorized] = await db
    .select({
      baruMasuk: sql<string>`count(*) filter (where ${barang.status} = 'baru_masuk')`,
      siapJual: sql<string>`count(*) filter (where ${barang.status} = 'siap_jual')`,
      terjual: sql<string>`count(*) filter (where ${barang.status} = 'terjual')`,
      rusak: sql<string>`count(*) filter (where ${barang.status} = 'rusak')`,
    })
    .from(barang)
    .where(and(eq(barang.businessId, businessId), eq(barang.outletId, outletId), isNull(barang.categoryId)));

  const rows: StokByCategoryRow[] = categorized.map((r) => ({
    categoryId: r.categoryId,
    categoryName: r.categoryName,
    baruMasuk: Number(r.baruMasuk),
    siapJual: Number(r.siapJual),
    terjual: Number(r.terjual),
    rusak: Number(r.rusak),
    total: Number(r.baruMasuk) + Number(r.siapJual) + Number(r.terjual) + Number(r.rusak),
  }));

  const uncategorizedTotal =
    Number(uncategorized?.baruMasuk ?? 0) +
    Number(uncategorized?.siapJual ?? 0) +
    Number(uncategorized?.terjual ?? 0) +
    Number(uncategorized?.rusak ?? 0);
  if (uncategorizedTotal > 0) {
    rows.push({
      categoryId: null,
      categoryName: null,
      baruMasuk: Number(uncategorized?.baruMasuk ?? 0),
      siapJual: Number(uncategorized?.siapJual ?? 0),
      terjual: Number(uncategorized?.terjual ?? 0),
      rusak: Number(uncategorized?.rusak ?? 0),
      total: uncategorizedTotal,
    });
  }

  return rows;
}
