/**
 * TT11 — Test integrasi "Tandai sudah dibayar". Butuh koneksi Supabase
 * sungguhan, di-skip otomatis kalau env belum diisi.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
import { eq } from "drizzle-orm";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { getAdminDb } from "@/lib/db/client";
import { createSupabaseAdminClient } from "@/lib/auth/supabase";
import { brands, businesses, pemilik, pemilikPayouts, profiles } from "@/lib/db/schema";
import { confirmDayCutoffWithDb, createOutletWithDb } from "@/lib/outlets/manage";
import { recordPemilikPayoutWithDb } from "../payout-manage";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

describe.skipIf(!hasEnv)("TT11 — recordPemilikPayoutWithDb", () => {
  const db = getAdminDb();
  const PREFIX = `TEST_PAYOUT_${Date.now()}`;

  let businessId: string;
  let outletId: string;
  let pemilikId: string;
  let recorderProfileId: string;

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

    const created = await createOutletWithDb(db, businessId, {
      code: "PO1",
      brandId: brand!.id,
      name: `${PREFIX}_outlet`,
      dayCutoffTime: "04:00:00",
      taxPercent: 0,
      serviceChargePercent: 0,
      roundingTo: 100,
      cashVarianceTolerance: "20000",
      varianceAlertPercent: 3,
      varianceAlertValue: "100000",
    });
    outletId = created.success!.outletId;

    const [pA] = await db
      .insert(pemilik)
      .values({ businessId, nama: `${PREFIX}_Pemilik`, persenBagi: "60" })
      .returning({ id: pemilik.id });
    pemilikId = pA!.id;

    const admin = createSupabaseAdminClient();
    const { data: authUser, error } = await admin.auth.admin.createUser({
      email: `${PREFIX.toLowerCase()}-recorder@example.com`,
      password: "T3st-PayoutRecorder-P@ssw0rd!",
      email_confirm: true,
    });
    if (error || !authUser.user) throw error ?? new Error("gagal buat akun uji");
    recorderProfileId = authUser.user.id;
    await db.insert(profiles).values({ id: recorderProfileId, fullName: `${PREFIX}_recorder` });
  });

  afterAll(async () => {
    if (businessId) {
      await db.delete(pemilikPayouts).where(eq(pemilikPayouts.businessId, businessId));
      await db.delete(businesses).where(eq(businesses.id, businessId));
    }
    if (recorderProfileId) {
      await db.delete(profiles).where(eq(profiles.id, recorderProfileId));
      await createSupabaseAdminClient().auth.admin.deleteUser(recorderProfileId).catch(() => {});
    }
  });

  const validInput = () => ({
    outletId,
    pemilikId,
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    jumlah: 300000,
    tanggalBayar: "2026-09-15",
  });

  it("SYARAT 3 TT11 -- DITOLAK selama dayCutoffTime outlet belum dikonfirmasi, dengan pesan eksplisit", async () => {
    const result = await recordPemilikPayoutWithDb(db, businessId, recorderProfileId, null, validInput());
    expect(result.error).toBeTruthy();
    expect(result.error).toContain("belum dikonfirmasi");
    expect(result.success).toBeUndefined();

    const rows = await db.select().from(pemilikPayouts).where(eq(pemilikPayouts.outletId, outletId));
    expect(rows.length).toBe(0); // tidak ada baris tersimpan sama sekali
  });

  it("berhasil SESUDAH dayCutoffTime dikonfirmasi", async () => {
    await confirmDayCutoffWithDb(db, businessId, null, outletId);

    const result = await recordPemilikPayoutWithDb(db, businessId, recorderProfileId, null, validInput());
    expect(result.success).toBeTruthy();

    const [row] = await db.select().from(pemilikPayouts).where(eq(pemilikPayouts.id, result.success!.payoutId));
    expect(row?.jumlah).toBe("300000.00");
    expect(row?.recordedByUserId).toBe(recorderProfileId);
  });

  it("Pembatasan akses per outlet, Tahap 3 -- allowedOutletIds TIDAK memuat outlet ini -- MELEMPAR, tidak menulis apa pun", async () => {
    const rowsBefore = await db.select().from(pemilikPayouts).where(eq(pemilikPayouts.outletId, outletId));

    await expect(
      recordPemilikPayoutWithDb(db, businessId, recorderProfileId, ["00000000-0000-0000-0000-000000000099"], validInput())
    ).rejects.toThrow();

    const rowsAfter = await db.select().from(pemilikPayouts).where(eq(pemilikPayouts.outletId, outletId));
    expect(rowsAfter.length).toBe(rowsBefore.length);
  });

  it("jumlah nol atau negatif ditolak", async () => {
    const result = await recordPemilikPayoutWithDb(db, businessId, recorderProfileId, null, {
      ...validInput(),
      jumlah: 0,
    });
    expect(result.error).toBeTruthy();
  });
});
