/**
 * TT11 koreksi — Test integrasi updateBusinessTimezoneWithDb. Butuh
 * koneksi Supabase sungguhan, di-skip otomatis kalau env belum diisi.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
import { eq } from "drizzle-orm";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { getAdminDb } from "@/lib/db/client";
import { brands, businesses, outlets } from "@/lib/db/schema";
import { confirmDayCutoffWithDb, createOutletWithDb } from "@/lib/outlets/manage";
import { updateBusinessTimezoneWithDb } from "../manage";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

describe.skipIf(!hasEnv)("TT11 koreksi — updateBusinessTimezoneWithDb", () => {
  const db = getAdminDb();
  const PREFIX = `TEST_BIZTZ_${Date.now()}`;

  let businessId: string;
  let outletAId: string;
  let outletBId: string;

  beforeAll(async () => {
    const [business] = await db
      .insert(businesses)
      .values({ name: `${PREFIX}_business`, timezone: "Asia/Jakarta" })
      .returning({ id: businesses.id });
    businessId = business!.id;

    const [brand] = await db
      .insert(brands)
      .values({ businessId, name: `${PREFIX}_brand` })
      .returning({ id: brands.id });

    const createdA = await createOutletWithDb(db, businessId, {
      code: "BZ1",
      brandId: brand!.id,
      name: `${PREFIX}_outletA`,
      dayCutoffTime: "04:00:00",
      taxPercent: 0,
      serviceChargePercent: 0,
      roundingTo: 100,
      cashVarianceTolerance: "20000",
      varianceAlertPercent: 3,
      varianceAlertValue: "100000",
    });
    outletAId = createdA.success!.outletId;

    const createdB = await createOutletWithDb(db, businessId, {
      code: "BZ2",
      brandId: brand!.id,
      name: `${PREFIX}_outletB`,
      dayCutoffTime: "05:00:00",
      taxPercent: 0,
      serviceChargePercent: 0,
      roundingTo: 100,
      cashVarianceTolerance: "20000",
      varianceAlertPercent: 3,
      varianceAlertValue: "100000",
    });
    outletBId = createdB.success!.outletId;

    // Konfirmasi KEDUA outlet dulu -- supaya perubahan timezone yang
    // mereset keduanya benar-benar teruji (bukan kebetulan sudah false).
    await confirmDayCutoffWithDb(db, businessId, outletAId);
    await confirmDayCutoffWithDb(db, businessId, outletBId);
  });

  afterAll(async () => {
    if (businessId) {
      await db.delete(businesses).where(eq(businesses.id, businessId));
    }
  });

  it("zona waktu tidak valid (bukan IANA dikenal) DITOLAK, tidak mengubah apa pun", async () => {
    const result = await updateBusinessTimezoneWithDb(db, businessId, "Bukan/Zona_Valid");
    expect(result.error).toBeTruthy();

    const [row] = await db.select({ timezone: businesses.timezone }).from(businesses).where(eq(businesses.id, businessId));
    expect(row?.timezone).toBe("Asia/Jakarta"); // tidak berubah
  });

  it("nilai SAMA (Asia/Jakarta -> Asia/Jakarta) tidak mereset konfirmasi outlet mana pun", async () => {
    const result = await updateBusinessTimezoneWithDb(db, businessId, "Asia/Jakarta");
    expect(result.success).toBeTruthy();

    const rows = await db
      .select({ id: outlets.id, dayCutoffConfirmed: outlets.dayCutoffConfirmed })
      .from(outlets)
      .where(eq(outlets.businessId, businessId));
    expect(rows.every((r) => r.dayCutoffConfirmed)).toBe(true); // masih terkonfirmasi semua
  });

  it("timezone BERUBAH (Asia/Jakarta -> Asia/Jayapura) mereset dayCutoffConfirmed SEMUA outlet bisnis ini, bukan cuma satu", async () => {
    const result = await updateBusinessTimezoneWithDb(db, businessId, "Asia/Jayapura");
    expect(result.success).toBeTruthy();

    const [businessRow] = await db
      .select({ timezone: businesses.timezone })
      .from(businesses)
      .where(eq(businesses.id, businessId));
    expect(businessRow?.timezone).toBe("Asia/Jayapura");

    const outletRows = await db
      .select({ id: outlets.id, dayCutoffConfirmed: outlets.dayCutoffConfirmed })
      .from(outlets)
      .where(eq(outlets.businessId, businessId));
    expect(outletRows.length).toBe(2);
    expect(outletRows.every((r) => r.dayCutoffConfirmed === false)).toBe(true);
  });
});
