/**
 * Pembatasan akses per outlet -- Tahap 1 (13 September 2026): fondasi
 * `allowedOutletIds`, murni aditif (belum dipakai menyaring apa pun).
 *
 * Dua lapis tes:
 * 1. computeAllowedOutletIds() -- fungsi murni, tanpa DB, tiap kombinasi
 *    role x outlet_ids dicek eksplisit (bukan cuma dipercaya dari nama
 *    fungsinya).
 * 2. getCurrentBusinessFromClient() lewat sesi Supabase Auth SUNGGUHAN --
 *    membuktikan pemaksaan null untuk owner/akuntan benar-benar
 *    tersambung dari database sampai ke pemanggil, bukan cuma benar di
 *    unit test fungsi murninya saja.
 */
import { afterAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { eq } from "drizzle-orm";
import { getAdminDb } from "@/lib/db/client";
import { createSupabaseClientWithToken } from "@/lib/auth/supabase";
import { memberships } from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";
import { createUserDbFixture, type UserDbFixture } from "@/lib/db/__tests__/helpers/user-db-fixture";
import { computeAllowedOutletIds, UNRESTRICTED_OUTLET_ROLES } from "../outlet-scope";
import { getCurrentBusinessFromClient } from "../session";

describe("computeAllowedOutletIds — fungsi murni, tanpa DB", () => {
  it("owner: outlet_ids null -> null (semua outlet)", () => {
    expect(computeAllowedOutletIds("owner", null)).toBeNull();
  });

  it("owner: outlet_ids array TETAP dipaksa null (dipaksa di kode, bukan cuma dipercaya dari data)", () => {
    expect(computeAllowedOutletIds("owner", [generateId()])).toBeNull();
  });

  it("accountant: outlet_ids array TETAP dipaksa null, pola sama owner", () => {
    expect(computeAllowedOutletIds("accountant", [generateId()])).toBeNull();
  });

  it("manager: outlet_ids null -> null (semua outlet, bukan role yang dipaksa)", () => {
    expect(computeAllowedOutletIds("manager", null)).toBeNull();
  });

  it("manager: outlet_ids array -> array APA ADANYA (dipersempit)", () => {
    const ids = [generateId(), generateId()];
    expect(computeAllowedOutletIds("manager", ids)).toEqual(ids);
  });

  it("cashier/waiter/kitchen/warehouse: array outlet_ids diteruskan apa adanya (bukan role tak terbatas)", () => {
    const ids = [generateId()];
    for (const role of ["cashier", "waiter", "kitchen", "warehouse"] as const) {
      expect(computeAllowedOutletIds(role, ids)).toEqual(ids);
      expect(UNRESTRICTED_OUTLET_ROLES).not.toContain(role);
    }
  });

  it("UNRESTRICTED_OUTLET_ROLES persis {owner, accountant} -- kalau berubah, sinkronkan dengan auth_outlet_ids() Tahap 5 nanti", () => {
    expect([...UNRESTRICTED_OUTLET_ROLES].sort()).toEqual(["accountant", "owner"]);
  });
});

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

describe.skipIf(!hasEnv)("getCurrentBusinessFromClient — tersambung end-to-end lewat sesi asli", () => {
  const adminDb = getAdminDb(); // setup: paksa outlet_ids owner (skenario yang TIDAK mungkin terjadi lewat /team, tapi harus tetap aman kalau data rusak/diedit manual) -- CLAUDE.md §3.4
  let owner: UserDbFixture;

  afterAll(async () => {
    await owner.cleanup();
  });

  it("owner yang outlet_ids-nya DIPAKSA berisi array (skenario data rusak/diedit manual) TETAP dapat allowedOutletIds null", async () => {
    owner = await createUserDbFixture("TEST_OUTLETSCOPE");
    await adminDb
      .update(memberships)
      .set({ outletIds: [generateId(), generateId()] })
      .where(eq(memberships.userId, owner.userId));

    const supabase = createSupabaseClientWithToken(owner.accessToken);
    const business = await getCurrentBusinessFromClient(supabase, owner.userId);

    expect(business?.role).toBe("owner");
    expect(business?.allowedOutletIds).toBeNull();
  });
});
