import { eq } from "drizzle-orm";
import { getAdminDb, getUserDb, type UserDbHandle } from "@/lib/db/client";
import { createSupabaseAdminClient, createSupabaseAnonClient } from "@/lib/auth/supabase";
import { businesses, memberships, profiles } from "@/lib/db/schema";

/**
 * Fixture bersama untuk test safe-delete (dan test lain yang butuh
 * membuktikan perilaku RLS sungguhan, bukan lewat getAdminDb() yang
 * BYPASSRLS). Ditulis setelah ditemukan: seluruh test safe-delete
 * sebelumnya (categories/modifier-groups/modifiers/price-tiers/
 * payment-methods) memakai getAdminDb() untuk operasi yang DIUJI, bukan
 * cuma untuk setup data -- jadi tidak pernah membuktikan policy RLS DELETE
 * benar-benar ada (persis kasus ingredients yang lolos test tapi gagal di
 * dashboard sungguhan, lihat docs/04-CATATAN-TEKNIS.md).
 *
 * Pola: getAdminDb() HANYA dipakai untuk hal yang secara struktural tidak
 * mungkin dilakukan oleh user yang belum ada (bikin business/auth user/
 * membership -- ayam-telur, sama seperti tenant-isolation.test.ts). Semua
 * operasi SETELAH user itu login (termasuk insert data uji lain seperti
 * products/orders untuk skenario "blocked") lewat db user asli, supaya
 * seluruh alur test -- bukan cuma baris terakhir -- merepresentasikan
 * jalur produksi.
 */
export type UserDbFixture = {
  businessId: string;
  userId: string;
  db: UserDbHandle["db"];
  cleanup: () => Promise<void>;
};

export async function createUserDbFixture(namePrefix: string): Promise<UserDbFixture> {
  const adminDb = getAdminDb(); // sistem: business/auth user/membership belum ada, tidak ada sesi user untuk dipakai (CLAUDE.md §3.4)
  const admin = createSupabaseAdminClient();
  const RUN_ID = Date.now();

  const [business] = await adminDb
    .insert(businesses)
    .values({ name: `${namePrefix}_${RUN_ID}` })
    .returning({ id: businesses.id });
  const businessId = business!.id;

  const slug = namePrefix.toLowerCase().replace(/[^a-z0-9]/g, "-");
  const email = `${slug}-${RUN_ID}@example.com`;
  const password = "T3st-UserDb-P@ssw0rd!";

  const { data: authUser, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (authError || !authUser.user) {
    throw authError ?? new Error("createUserDbFixture: gagal membuat auth user uji");
  }
  const userId = authUser.user.id;

  await adminDb.insert(profiles).values({ id: userId, fullName: `${namePrefix} test owner` });
  await adminDb.insert(memberships).values({ businessId, userId, role: "owner" });

  const anon = createSupabaseAnonClient();
  const { data: signIn, error: signInError } = await anon.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError || !signIn.session) {
    throw signInError ?? new Error("createUserDbFixture: gagal login user uji");
  }

  const { db, close } = await getUserDb(signIn.session.access_token);

  return {
    businessId,
    userId,
    db,
    cleanup: async () => {
      await close();
      await adminDb.delete(businesses).where(eq(businesses.id, businessId));
      await admin.auth.admin.deleteUser(userId);
    },
  };
}
