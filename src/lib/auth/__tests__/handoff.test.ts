/**
 * Test integrasi handoff satu pintu masuk (25 September 2026) -- butuh
 * koneksi Supabase sungguhan, di-skip otomatis kalau env belum diisi
 * (pola sama tenant-isolation.test.ts).
 *
 * Cakupan wajib per instruksi: nonce dipakai dua kali ditolak, orang tanpa
 * pemetaan mendapat null (bukan galat) supaya pesan yang ditampilkan
 * generik, dan -- yang paling penting -- SESUDAH handoff, sesi yang
 * terbentuk membaca role/outlet dari membership yang SAMA seperti login
 * password biasa (tidak ada jalur pintas apa pun). Token kedaluwarsa/
 * secret salah sudah diuji murni di handoff-token.test.ts (tidak butuh DB).
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getAdminDb } from "@/lib/db/client";
import { createSupabaseAdminClient, createSupabaseAnonClient, createSupabaseClientWithToken } from "@/lib/auth/supabase";
import { handoffNonces, memberships } from "@/lib/db/schema";
import { getCurrentBusinessFromClient } from "@/lib/auth/session";
import { createUserDbFixture, type UserDbFixture } from "@/lib/db/__tests__/helpers/user-db-fixture";
import { consumeNonceOnce, createHandoffMagicLink, findPosProfileIdForReportEmail } from "../handoff";
import { createIdentityLink, deleteIdentityLink, listIdentityLinksForBusiness } from "../identity-links";

const hasEnv = Boolean(
  process.env["DATABASE_URL"] &&
    process.env["NEXT_PUBLIC_SUPABASE_URL"] &&
    process.env["SUPABASE_SERVICE_ROLE_KEY"]
);

describe.skipIf(!hasEnv)("handoff satu pintu masuk", () => {
  const cleanupFixtures: UserDbFixture[] = [];
  const cleanupReportEmails: string[] = [];

  afterEach(async () => {
    const adminDb = getAdminDb();
    for (const email of cleanupReportEmails.splice(0)) {
      await adminDb.delete(handoffNonces).where(eq(handoffNonces.reportEmail, email));
      // reportIdentityLinks ikut terhapus lewat CASCADE saat profil dihapus
      // (fixture.cleanup() di bawah) -- tidak perlu dihapus manual di sini.
    }
    for (const fixture of cleanupFixtures.splice(0)) {
      await fixture.cleanup();
    }
  });

  it("consumeNonceOnce: nonce baru diterima, nonce YANG SAMA dipakai lagi ditolak", async () => {
    const email = `TEST_HANDOFF_NONCE_${Date.now()}@koperumnas.local`;
    cleanupReportEmails.push(email);
    const nonce = randomUUID();

    const pertama = await consumeNonceOnce(nonce, email);
    expect(pertama).toBe(true);

    const kedua = await consumeNonceOnce(nonce, email);
    expect(kedua).toBe(false);
  });

  it("findPosProfileIdForReportEmail: belum pernah dipetakan -> null (bukan galat)", async () => {
    const email = `TEST_HANDOFF_TIDAK_ADA_${Date.now()}@koperumnas.local`;
    const result = await findPosProfileIdForReportEmail(email);
    expect(result).toBeNull();
  });

  it("createIdentityLink: posProfileId di LUAR bisnis ini -> ditolak", async () => {
    const fixtureA = await createUserDbFixture("TEST_HANDOFF_LINK_A");
    const fixtureB = await createUserDbFixture("TEST_HANDOFF_LINK_B");
    cleanupFixtures.push(fixtureA, fixtureB);

    const email = `TEST_HANDOFF_LINTAS_BISNIS_${Date.now()}@koperumnas.local`;
    cleanupReportEmails.push(email);

    const result = await createIdentityLink({
      businessId: fixtureA.businessId,
      reportEmail: email,
      posProfileId: fixtureB.userId, // anggota BISNIS B, dipetakan ke bisnis A
      createdBy: fixtureA.userId,
    });

    expect(result).toEqual({ error: "Anggota tim tidak ditemukan di bisnis ini." });
    const links = await listIdentityLinksForBusiness(fixtureA.businessId);
    expect(links.some((l) => l.reportEmail === email)).toBe(false);
  });

  it("createIdentityLink: report_email duplikat -> ditolak, tautan lama tidak berubah", async () => {
    const fixture = await createUserDbFixture("TEST_HANDOFF_DUP");
    cleanupFixtures.push(fixture);
    const email = `TEST_HANDOFF_DUPLIKAT_${Date.now()}@koperumnas.local`;
    cleanupReportEmails.push(email);

    const pertama = await createIdentityLink({
      businessId: fixture.businessId,
      reportEmail: email,
      posProfileId: fixture.userId,
      createdBy: fixture.userId,
    });
    expect(pertama).toEqual({ success: true });

    const kedua = await createIdentityLink({
      businessId: fixture.businessId,
      reportEmail: email,
      posProfileId: fixture.userId,
      createdBy: fixture.userId,
    });
    expect(kedua).toEqual({ error: "duplicate" });

    const links = await listIdentityLinksForBusiness(fixture.businessId);
    expect(links.filter((l) => l.reportEmail === email)).toHaveLength(1);
  });

  it(
    "SESUDAH handoff: sesi yang terbentuk membaca role & outlet dari membership yang SAMA seperti login password -- tidak ada jalur pintas",
    async () => {
      const fixture = await createUserDbFixture("TEST_HANDOFF_E2E");
      cleanupFixtures.push(fixture);

      // Membership fixture defaultnya 'owner' -- ubah ke manager dengan
      // outlet spesifik supaya benar-benar membuktikan role/outlet BUKAN
      // owner-tanpa-batas bawaan (yang gampang lolos tes semu).
      const adminDb = getAdminDb();
      const outletIdPalsu = randomUUID();
      await adminDb
        .update(memberships)
        .set({ role: "manager", outletIds: [outletIdPalsu] })
        .where(eq(memberships.userId, fixture.userId));

      const email = `TEST_HANDOFF_E2E_${Date.now()}@koperumnas.local`;
      cleanupReportEmails.push(email);
      const linkResult = await createIdentityLink({
        businessId: fixture.businessId,
        reportEmail: email,
        posProfileId: fixture.userId,
        createdBy: fixture.userId,
      });
      expect(linkResult).toEqual({ success: true });

      const posProfileId = await findPosProfileIdForReportEmail(email);
      expect(posProfileId).toBe(fixture.userId);

      const actionLink = await createHandoffMagicLink(posProfileId!, "http://localhost:3000/auth/callback");
      expect(actionLink).toBeTruthy();

      // Tukar magic link SUNGGUHAN jadi sesi sungguhan -- generateLink()
      // (yang dipakai createHandoffMagicLink di atas untuk dapat action_link)
      // JUGA mengembalikan hashed_token, cara resmi Supabase menukar tanpa
      // menempuh redirect HTTP (dokumentasi admin.generateLink). Dipanggil
      // lagi di sini (bukan dibaca dari createHandoffMagicLink -- fungsi
      // itu sengaja cuma mengembalikan action_link, tidak membocorkan
      // hashed_token ke pemanggil route) supaya test ini benar-benar
      // memverifikasi mekanisme yang sama yang dipakai produksi.
      const admin = createSupabaseAdminClient();
      const { data: userData } = await admin.auth.admin.getUserById(fixture.userId);
      const realEmail = userData.user!.email!;
      const { data: realLink, error: realLinkError } = await admin.auth.admin.generateLink({
        type: "magiclink",
        email: realEmail,
      });
      if (realLinkError || !realLink.properties?.hashed_token) {
        throw realLinkError ?? new Error("Gagal membuat hashed_token uji");
      }

      const anon = createSupabaseAnonClient();
      const { data: verifyData, error: verifyError } = await anon.auth.verifyOtp({
        token_hash: realLink.properties.hashed_token,
        type: "magiclink",
      });
      if (verifyError || !verifyData.session) {
        throw verifyError ?? new Error("Gagal menukar hashed_token jadi sesi uji");
      }

      // Ini intinya: baca role/outlet lewat client yang memakai access
      // token dari sesi HASIL HANDOFF, persis fungsi yang sama dipakai
      // requirePermission() untuk login password biasa.
      const clientDariSesiHandoff = createSupabaseClientWithToken(verifyData.session.access_token);
      const currentBusiness = await getCurrentBusinessFromClient(clientDariSesiHandoff, fixture.userId);

      expect(currentBusiness).not.toBeNull();
      expect(currentBusiness!.businessId).toBe(fixture.businessId);
      expect(currentBusiness!.role).toBe("manager");
      expect(currentBusiness!.allowedOutletIds).toEqual([outletIdPalsu]);

      await deleteIdentityLink(fixture.businessId, (await listIdentityLinksForBusiness(fixture.businessId))[0]!.id);
    }
  );
});
