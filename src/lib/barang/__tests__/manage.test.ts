/**
 * Pembatasan akses per outlet -- Tahap 4 (13 September 2026, §27), jalur
 * tulis PERTAMA (utang terbuka dari Tahap 3): saveBarangWithDb dan
 * setBarangStatusWithDb. Butuh koneksi Supabase sungguhan, di-skip
 * otomatis kalau env belum diisi.
 *
 * BEDA dari Tahap 3: setiap kasus penolakan WAJIB dibuktikan DUA arah --
 * (1) hasil fungsi menandakan gagal (`result.error` terisi), DAN (2)
 * DATABASE diperiksa ulang untuk membuktikan TIDAK ADA baris baru/berubah
 * -- bukan cuma percaya nilai balik (keputusan CEO eksplisit: "periksa
 * databasenya sesudah itu, jangan cuma periksa nilai baliknya").
 *
 * UPDATE diuji terpisah dari CREATE (kasus jahat CEO: outletId bisa
 * datang dari baris yang sedang diubah ATAU dari input -- keduanya
 * diperiksa, walau untuk barang saja input outletId TIDAK PERNAH dipakai
 * saat edit, lihat komentar lib/barang/manage.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { eq } from "drizzle-orm";
import { getAdminDb } from "@/lib/db/client";
import { barang, brands, businesses, outlets } from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";
import { saveBarangWithDb, setBarangStatusWithDb } from "../manage";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

describe.skipIf(!hasEnv)("Pembatasan akses per outlet, Tahap 4 -- saveBarangWithDb/setBarangStatusWithDb", () => {
  const db = getAdminDb();
  const PREFIX = `TEST_BARANGWRITE_${Date.now()}`;

  let businessId: string;
  let outletAId: string;
  let outletBId: string;

  beforeAll(async () => {
    const [business] = await db.insert(businesses).values({ name: `${PREFIX}_business` }).returning({ id: businesses.id });
    businessId = business!.id;
    const [brand] = await db.insert(brands).values({ businessId, name: `${PREFIX}_brand` }).returning({ id: brands.id });

    const [oA] = await db
      .insert(outlets)
      .values({ businessId, brandId: brand!.id, code: "BWA", name: "Barang Write A" })
      .returning({ id: outlets.id });
    const [oB] = await db
      .insert(outlets)
      .values({ businessId, brandId: brand!.id, code: "BWB", name: "Barang Write B" })
      .returning({ id: outlets.id });
    outletAId = oA!.id;
    outletBId = oB!.id;
  });

  afterAll(async () => {
    if (businessId) {
      await db.delete(businesses).where(eq(businesses.id, businessId));
    }
  });

  it("data uji terbentuk (dua outlet)", () => {
    expect(outletAId).toBeTruthy();
    expect(outletBId).toBeTruthy();
  });

  function baseInput(outletId: string) {
    return {
      outletId,
      nama: "Kemeja Uji",
      hargaJual: "75000",
    };
  }

  describe("CREATE -- outletId dari input", () => {
    it("allowedOutletIds memuat outlet ini -- berhasil", async () => {
      const result = await saveBarangWithDb(db, businessId, [outletAId], baseInput(outletAId));
      expect(result.success).toBeTruthy();

      const [row] = await db.select().from(barang).where(eq(barang.id, result.success!.barangId));
      expect(row?.outletId).toBe(outletAId);
    });

    it("allowedOutletIds TIDAK memuat outlet ini -- DITOLAK, TIDAK ADA baris baru tertulis", async () => {
      const before = await db.select({ id: barang.id }).from(barang).where(eq(barang.outletId, outletBId));

      const result = await saveBarangWithDb(db, businessId, [outletAId], baseInput(outletBId));
      expect(result.error).toBeTruthy();
      expect(result.success).toBeUndefined();
      expect(result.error).not.toContain(outletBId); // pesan tidak menyebut outlet

      const after = await db.select({ id: barang.id }).from(barang).where(eq(barang.outletId, outletBId));
      expect(after.length).toBe(before.length); // tidak ada baris baru
    });

    it("allowedOutletIds array KOSONG -- DITOLAK juga (bukan diloloskan seperti null)", async () => {
      const before = await db.select({ id: barang.id }).from(barang).where(eq(barang.outletId, outletAId));

      const result = await saveBarangWithDb(db, businessId, [], baseInput(outletAId));
      expect(result.error).toBeTruthy();

      const after = await db.select({ id: barang.id }).from(barang).where(eq(barang.outletId, outletAId));
      expect(after.length).toBe(before.length);
    });

    it("allowedOutletIds null (owner/akuntan) -- berhasil di outlet mana pun", async () => {
      const result = await saveBarangWithDb(db, businessId, null, baseInput(outletBId));
      expect(result.success).toBeTruthy();
    });
  });

  describe("UPDATE -- outletId dari BARIS YANG SEDANG DIUBAH (bukan dari input, edit tidak pernah pindah outlet)", () => {
    it("allowedOutletIds memuat outlet baris ini -- berhasil", async () => {
      const created = await saveBarangWithDb(db, businessId, null, baseInput(outletAId));
      const barangId = created.success!.barangId;

      const result = await saveBarangWithDb(db, businessId, [outletAId], {
        id: barangId,
        outletId: outletAId,
        nama: "Kemeja Uji (diubah)",
        hargaJual: "80000",
      });
      expect(result.success).toBeTruthy();

      const [row] = await db.select().from(barang).where(eq(barang.id, barangId));
      expect(row?.nama).toBe("Kemeja Uji (diubah)");
    });

    it("allowedOutletIds TIDAK memuat outlet baris ini -- DITOLAK, baris TIDAK BERUBAH sama sekali", async () => {
      const created = await saveBarangWithDb(db, businessId, null, baseInput(outletBId));
      const barangId = created.success!.barangId;
      const [before] = await db.select().from(barang).where(eq(barang.id, barangId));

      // Kasus jahat CEO: manajer Outlet A mencoba mengubah baris Outlet B --
      // walau outletId di input diisi outletA (mencoba "memindahkan"),
      // update TETAP ditolak karena baris ASLINYA (outletB) di luar
      // allowedOutletIds -- input outletId tidak relevan sama sekali
      // untuk barang (lihat komentar manage.ts), tapi tetap dicoba di sini
      // untuk membuktikan tidak ada celah dari sisi itu juga.
      const result = await saveBarangWithDb(db, businessId, [outletAId], {
        id: barangId,
        outletId: outletAId,
        nama: "DIUBAH PAKSA",
        hargaJual: "999999",
      });
      expect(result.error).toBeTruthy();
      expect(result.success).toBeUndefined();

      const [after] = await db.select().from(barang).where(eq(barang.id, barangId));
      expect(after?.nama).toBe(before?.nama);
      expect(after?.hargaJual).toBe(before?.hargaJual);
      expect(after?.outletId).toBe(outletBId); // outlet baris TETAP outletB, tidak pernah pindah
    });
  });

  describe("setBarangStatusWithDb -- outletId dari baris (ditambahkan proaktif)", () => {
    it("allowedOutletIds memuat outlet baris ini -- berhasil", async () => {
      const created = await saveBarangWithDb(db, businessId, null, baseInput(outletAId));
      const barangId = created.success!.barangId;

      const result = await setBarangStatusWithDb(db, businessId, [outletAId], { id: barangId, status: "siap_jual" });
      expect(result.success).toBeTruthy();

      const [row] = await db.select().from(barang).where(eq(barang.id, barangId));
      expect(row?.status).toBe("siap_jual");
    });

    it("allowedOutletIds TIDAK memuat outlet baris ini -- DITOLAK, status TIDAK BERUBAH", async () => {
      const created = await saveBarangWithDb(db, businessId, null, baseInput(outletBId));
      const barangId = created.success!.barangId;

      const result = await setBarangStatusWithDb(db, businessId, [outletAId], { id: barangId, status: "siap_jual" });
      expect(result.error).toBeTruthy();

      const [row] = await db.select().from(barang).where(eq(barang.id, barangId));
      expect(row?.status).toBe("baru_masuk"); // status bawaan, tidak berubah
    });
  });

  it("id acak (barang tidak ada sama sekali) -- pesan generik, bukan bocor lewat gerbang outlet", async () => {
    const result = await saveBarangWithDb(db, businessId, [outletAId], {
      id: generateId(),
      outletId: outletAId,
      nama: "X",
      hargaJual: "1000",
    });
    expect(result.error).toBeTruthy();
  });
});
