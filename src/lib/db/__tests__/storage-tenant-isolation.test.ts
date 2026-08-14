/**
 * T09c — setara src/lib/auth/__tests__/tenant-isolation.test.ts tapi untuk
 * Supabase Storage: buktikan RLS di storage.objects (bucket 'products',
 * migration 0012) benar-benar menahan business A membaca objek business B,
 * bukan cuma diasumsikan benar dari SQL policy-nya. "RLS lapisan terakhir,
 * bukan satu-satunya" (CLAUDE.md §3.4) berlaku untuk Storage juga --
 * dibuktikan dengan test, sama seperti tabel Postgres biasa.
 *
 * Butuh koneksi Supabase sungguhan -- di-skip otomatis kalau env belum
 * diisi, bukan hijau palsu. Data uji prefix TEST_STORAGE_ISOLATION_,
 * dibersihkan di afterAll.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config as loadEnv } from "dotenv";
import {
  createSupabaseAdminClient,
  createSupabaseAnonClient,
  createSupabaseClientWithToken,
} from "../../auth/supabase";

loadEnv({ path: [".env.local", ".env"], quiet: true });

const hasEnv = Boolean(
  process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"] &&
    process.env["DATABASE_URL"]
);

describe.skipIf(!hasEnv)(
  "Isolasi tenant Storage — business A tidak boleh akses gambar business B",
  () => {
    const admin = createSupabaseAdminClient();
    const RUN_ID = Date.now();
    const PASSWORD = "T3st-Storage-Isolation-P@ssw0rd!";
    const TEST_BYTES = Buffer.from("bukan gambar sungguhan, cuma isi tes RLS storage");

    let businessAId: string | undefined;
    let businessBId: string | undefined;
    let userAId: string | undefined;
    let userBId: string | undefined;
    let tokenA: string | undefined;
    let pathA: string;
    let pathB: string;

    beforeAll(async () => {
      const { data: businessA, error: businessAError } = await admin
        .from("businesses")
        .insert({ name: `TEST_STORAGE_ISOLATION_A_${RUN_ID}` })
        .select("id")
        .single();
      if (businessAError || !businessA) {
        throw businessAError ?? new Error("gagal membuat business A uji");
      }
      businessAId = businessA["id"] as string;

      const { data: businessB, error: businessBError } = await admin
        .from("businesses")
        .insert({ name: `TEST_STORAGE_ISOLATION_B_${RUN_ID}` })
        .select("id")
        .single();
      if (businessBError || !businessB) {
        throw businessBError ?? new Error("gagal membuat business B uji");
      }
      businessBId = businessB["id"] as string;

      const emailA = `test-storage-isolation-a-${RUN_ID}@example.com`;
      const { data: authA, error: authAError } = await admin.auth.admin.createUser({
        email: emailA,
        password: PASSWORD,
        email_confirm: true,
      });
      if (authAError || !authA.user) {
        throw authAError ?? new Error("gagal membuat auth user A");
      }
      userAId = authA.user.id;
      await admin.from("profiles").insert({ id: userAId, full_name: `TEST_STORAGE_A_${RUN_ID}` });
      await admin.from("memberships").insert({
        business_id: businessAId,
        user_id: userAId,
        role: "owner",
      });

      const emailB = `test-storage-isolation-b-${RUN_ID}@example.com`;
      const { data: authB, error: authBError } = await admin.auth.admin.createUser({
        email: emailB,
        password: PASSWORD,
        email_confirm: true,
      });
      if (authBError || !authB.user) {
        throw authBError ?? new Error("gagal membuat auth user B");
      }
      userBId = authB.user.id;
      await admin.from("profiles").insert({ id: userBId, full_name: `TEST_STORAGE_B_${RUN_ID}` });
      await admin.from("memberships").insert({
        business_id: businessBId,
        user_id: userBId,
        role: "owner",
      });

      // Objek diunggah lewat admin client (bypass RLS, setup fixture) ke
      // folder masing-masing business -- (storage.foldername(name))[1]
      // adalah business_id (lib/products/image.ts#getProductImagePath).
      pathA = `${businessAId}/test.png`;
      pathB = `${businessBId}/test.png`;
      const [uploadA, uploadB] = await Promise.all([
        admin.storage.from("products").upload(pathA, TEST_BYTES, { upsert: true }),
        admin.storage.from("products").upload(pathB, TEST_BYTES, { upsert: true }),
      ]);
      if (uploadA.error) throw uploadA.error;
      if (uploadB.error) throw uploadB.error;

      const anon = createSupabaseAnonClient();
      const { data: signInA, error: signInAError } = await anon.auth.signInWithPassword({
        email: emailA,
        password: PASSWORD,
      });
      if (signInAError || !signInA.session) {
        throw signInAError ?? new Error("gagal login sebagai user A uji");
      }
      tokenA = signInA.session.access_token;
    });

    afterAll(async () => {
      const cleanups: Array<() => Promise<unknown>> = [
        async () => {
          await admin.storage.from("products").remove([pathA, pathB]);
        },
        async () => {
          if (userAId) await admin.auth.admin.deleteUser(userAId);
        },
        async () => {
          if (userBId) await admin.auth.admin.deleteUser(userBId);
        },
        async () => {
          if (businessAId) await admin.from("businesses").delete().eq("id", businessAId);
        },
        async () => {
          if (businessBId) await admin.from("businesses").delete().eq("id", businessBId);
        },
      ];
      for (const cleanup of cleanups) {
        try {
          await cleanup();
        } catch (err) {
          console.error("Cleanup gagal (dilanjutkan):", err);
        }
      }
    });

    it("data uji benar-benar terbentuk sebelum diuji (bukan hijau karena kosong)", () => {
      expect(businessAId).toBeTruthy();
      expect(businessBId).toBeTruthy();
      expect(userAId).toBeTruthy();
      expect(userBId).toBeTruthy();
      expect(tokenA).toBeTruthy();
      expect(businessAId).not.toBe(businessBId);
    });

    it("business A bisa download objek di folder-nya sendiri", async () => {
      const supabaseA = createSupabaseClientWithToken(tokenA!);
      const { data, error } = await supabaseA.storage.from("products").download(pathA);
      expect(error).toBeNull();
      expect(data).not.toBeNull();
    });

    it("business A DITOLAK saat coba download objek business B", async () => {
      const supabaseA = createSupabaseClientWithToken(tokenA!);
      const { data, error } = await supabaseA.storage.from("products").download(pathB);
      expect(error).not.toBeNull();
      expect(data).toBeNull();
    });

    it("list() folder business B dari sesi business A mengembalikan kosong", async () => {
      const supabaseA = createSupabaseClientWithToken(tokenA!);
      const { data, error } = await supabaseA.storage.from("products").list(businessBId!);
      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);
    });

    it("admin client (bypass RLS) tetap bisa lihat objek kedua business -- didokumentasikan, bukan bug", async () => {
      const { data: listA } = await admin.storage.from("products").list(businessAId!);
      const { data: listB } = await admin.storage.from("products").list(businessBId!);
      expect(listA?.some((f) => f.name === "test.png")).toBe(true);
      expect(listB?.some((f) => f.name === "test.png")).toBe(true);
    });
  }
);
