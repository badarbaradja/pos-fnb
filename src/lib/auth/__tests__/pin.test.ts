/**
 * T07 — Test integrasi lockout PIN kasir. Butuh koneksi Supabase
 * sungguhan (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY), sama
 * seperti src/lib/db/__tests__/rls.test.ts — di-skip otomatis kalau
 * env belum diisi, bukan hijau palsu.
 *
 * Data uji diberi prefix TEST_PIN_LOCKOUT_ dan dibersihkan di afterAll
 * (bukan di akhir setiap test) supaya tetap bersih walau ada test yang
 * gagal di tengah jalan.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
import bcrypt from "bcryptjs";
import { createSupabaseAdminClient } from "../supabase";
import { verifyCashierPin } from "../pin";

loadEnv({ path: [".env.local", ".env"], quiet: true });

const hasEnv = Boolean(
  process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

describe.skipIf(!hasEnv)("verifyCashierPin — lockout setelah 5 kali gagal", () => {
  const admin = createSupabaseAdminClient();
  const PREFIX = `TEST_PIN_LOCKOUT_${Date.now()}`;
  const CORRECT_PIN = "135790";
  const WRONG_PIN = "000000";
  const EMPLOYEE_CODE = "KASIR01";

  let businessId: string | undefined;
  let outletId: string | undefined;
  let employeeId: string | undefined;

  beforeAll(async () => {
    const { data: business, error: businessError } = await admin
      .from("businesses")
      .insert({ name: `${PREFIX}_business` })
      .select("id")
      .single();
    if (businessError || !business) {
      throw businessError ?? new Error("gagal membuat business uji");
    }
    businessId = business["id"] as string;

    const { data: outlet, error: outletError } = await admin
      .from("outlets")
      .insert({ business_id: businessId, code: "PIN01", name: `${PREFIX}_outlet` })
      .select("id")
      .single();
    if (outletError || !outlet) {
      throw outletError ?? new Error("gagal membuat outlet uji");
    }
    outletId = outlet["id"] as string;

    const pinHash = await bcrypt.hash(CORRECT_PIN, 10);
    const { data: employee, error: employeeError } = await admin
      .from("employees")
      .insert({
        business_id: businessId,
        outlet_id: outletId,
        code: EMPLOYEE_CODE,
        full_name: `${PREFIX}_employee`,
        pin_hash: pinHash,
      })
      .select("id")
      .single();
    if (employeeError || !employee) {
      throw employeeError ?? new Error("gagal membuat employee uji");
    }
    employeeId = employee["id"] as string;
  });

  afterAll(async () => {
    if (employeeId) await admin.from("employees").delete().eq("id", employeeId);
    if (outletId) await admin.from("outlets").delete().eq("id", outletId);
    if (businessId) await admin.from("businesses").delete().eq("id", businessId);
  });

  // Reset ke kondisi bersih sebelum tiap test supaya test tidak saling
  // bergantung pada urutan eksekusi.
  beforeEach(async () => {
    if (!employeeId) return;
    await admin
      .from("employees")
      .update({ failed_attempts: 0, locked_until: null })
      .eq("id", employeeId);
  });

  it("data uji benar-benar terbentuk sebelum diuji (bukan hijau karena kosong)", () => {
    expect(businessId).toBeTruthy();
    expect(outletId).toBeTruthy();
    expect(employeeId).toBeTruthy();
  });

  it("PIN benar berhasil dan mengembalikan identitas karyawan", async () => {
    const identity = await verifyCashierPin({
      outletId: outletId!,
      code: EMPLOYEE_CODE,
      pin: CORRECT_PIN,
    });
    expect(identity.employeeId).toBe(employeeId);
    expect(identity.businessId).toBe(businessId);
    expect(identity.outletId).toBe(outletId);
  });

  it("PIN salah ditolak dengan pesan generik", async () => {
    await expect(
      verifyCashierPin({ outletId: outletId!, code: EMPLOYEE_CODE, pin: WRONG_PIN })
    ).rejects.toThrow(/salah/i);
  });

  it("5 kali PIN salah berturut-turut mengunci akun 15 menit", async () => {
    for (let i = 0; i < 5; i++) {
      await expect(
        verifyCashierPin({ outletId: outletId!, code: EMPLOYEE_CODE, pin: WRONG_PIN })
      ).rejects.toThrow(/salah/i);
    }

    const { data: employee } = await admin
      .from("employees")
      .select("failed_attempts, locked_until")
      .eq("id", employeeId!)
      .single();

    expect(employee?.["failed_attempts"]).toBe(5);
    expect(employee?.["locked_until"]).not.toBeNull();
    const lockedUntil = new Date(employee!["locked_until"] as string).getTime();
    const expectedMin = Date.now() + 14 * 60_000; // toleransi eksekusi test
    const expectedMax = Date.now() + 16 * 60_000;
    expect(lockedUntil).toBeGreaterThan(expectedMin);
    expect(lockedUntil).toBeLessThan(expectedMax);
  });

  it("percobaan ke-6 ditolak karena terkunci, WALAU PIN yang dimasukkan benar", async () => {
    for (let i = 0; i < 5; i++) {
      await expect(
        verifyCashierPin({ outletId: outletId!, code: EMPLOYEE_CODE, pin: WRONG_PIN })
      ).rejects.toThrow(/salah/i);
    }

    await expect(
      verifyCashierPin({ outletId: outletId!, code: EMPLOYEE_CODE, pin: CORRECT_PIN })
    ).rejects.toThrow(/terkunci/i);
  });

  it("setelah lockout berakhir, PIN benar berhasil dan mereset failedAttempts ke 0", async () => {
    // Simulasikan lockout yang sudah berakhir: kunci di masa lalu.
    await admin
      .from("employees")
      .update({
        failed_attempts: 5,
        locked_until: new Date(Date.now() - 60_000).toISOString(),
      })
      .eq("id", employeeId!);

    const identity = await verifyCashierPin({
      outletId: outletId!,
      code: EMPLOYEE_CODE,
      pin: CORRECT_PIN,
    });
    expect(identity.employeeId).toBe(employeeId);

    const { data: employee } = await admin
      .from("employees")
      .select("failed_attempts, locked_until")
      .eq("id", employeeId!)
      .single();
    expect(employee?.["failed_attempts"]).toBe(0);
    expect(employee?.["locked_until"]).toBeNull();
  });

  it("PIN salah setelah lockout lama berakhir langsung mengunci lagi, bukan dapat 5 jatah baru", async () => {
    // failedAttempts TIDAK direset otomatis oleh lewatnya waktu -- cuma
    // oleh login berhasil. Simulasikan: lockout lama sudah lewat, tapi
    // failedAttempts masih 4 dari sebelumnya (sisa satu jatah lagi).
    await admin
      .from("employees")
      .update({
        failed_attempts: 4,
        locked_until: new Date(Date.now() - 60_000).toISOString(),
      })
      .eq("id", employeeId!);

    await expect(
      verifyCashierPin({ outletId: outletId!, code: EMPLOYEE_CODE, pin: WRONG_PIN })
    ).rejects.toThrow(/salah/i);

    const { data: employee } = await admin
      .from("employees")
      .select("failed_attempts, locked_until")
      .eq("id", employeeId!)
      .single();
    expect(employee?.["failed_attempts"]).toBe(5);
    expect(employee?.["locked_until"]).not.toBeNull();
    expect(new Date(employee!["locked_until"] as string).getTime()).toBeGreaterThan(
      Date.now()
    );
  });
});
