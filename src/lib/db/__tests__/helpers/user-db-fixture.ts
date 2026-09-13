import { eq, sql } from "drizzle-orm";
import { getAdminDb, getUserDb, type UserDbHandle } from "@/lib/db/client";
import { createSupabaseAdminClient, createSupabaseAnonClient } from "@/lib/auth/supabase";
import { businesses, memberships, profiles } from "@/lib/db/schema";

type BlockingRef = { table: string; column: string };

/**
 * Tabel apa pun yang punya FK ON DELETE NO ACTION ke businesses(id) --
 * ditemukan LEWAT information_schema saat cleanup jalan, BUKAN daftar
 * hardcoded. Ini kedua kalinya cleanup test ketinggalan skema (stock_
 * movements/orders/shifts pertama kali, lalu stock_transfers/stock_
 * transfer_items menyusul T22) -- dengan query ini, tabel BARU yang
 * mengikuti pola business_id-denormalized+NO ACTION (T21/T22, dipakai
 * lagi untuk tabel append-only berikutnya) otomatis ikut terhapus tanpa
 * perlu ada yang ingat memperbarui daftar di sini.
 */
async function findTablesBlockingBusinessDelete(
  adminDb: ReturnType<typeof getAdminDb>
): Promise<BlockingRef[]> {
  const rows = await adminDb.execute<{ table_name: string; column_name: string }>(sql`
    select tc.table_name, kcu.column_name
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
    join information_schema.constraint_column_usage ccu
      on tc.constraint_name = ccu.constraint_name and tc.table_schema = ccu.table_schema
    join information_schema.referential_constraints rc
      on tc.constraint_name = rc.constraint_name and tc.table_schema = rc.constraint_schema
    where tc.constraint_type = 'FOREIGN KEY'
      and tc.table_schema = 'public'
      and ccu.table_name = 'businesses'
      and rc.delete_rule = 'NO ACTION'
  `);
  return Array.from(rows as unknown as { table_name: string; column_name: string }[]).map((r) => ({
    table: r.table_name,
    column: r.column_name,
  }));
}

/**
 * Hapus baris untuk businessId ini dari setiap tabel yang ditemukan di
 * atas. Urutan antar tabel-tabel itu TIDAK PERLU diketahui di muka --
 * kalau satu tabel masih diblokir tabel lain di daftar yang sama (mis.
 * orders vs shifts), percobaannya gagal di putaran ini dan otomatis
 * berhasil di putaran berikutnya setelah tabel pemblokirnya kosong.
 * Retry sampai konvergen (maksimal N putaran, N = jumlah tabel) --
 * kalau masih ada yang gagal setelah itu, itu genuinely bukan soal
 * urutan (kemungkinan FK ke tabel LAIN yang tidak ada di daftar ini),
 * jadi dilempar sebagai error jelas, bukan ditelan diam-diam.
 */
async function deleteBlockingRowsForBusiness(
  adminDb: ReturnType<typeof getAdminDb>,
  businessId: string
): Promise<void> {
  let remaining = await findTablesBlockingBusinessDelete(adminDb);
  let lastError: unknown;

  for (let pass = 0; pass < remaining.length + 1 && remaining.length > 0; pass++) {
    const stillBlocked: BlockingRef[] = [];
    for (const ref of remaining) {
      try {
        await adminDb.execute(
          sql`delete from ${sql.identifier(ref.table)} where ${sql.identifier(ref.column)} = ${businessId}`
        );
      } catch (err) {
        lastError = err;
        stillBlocked.push(ref);
      }
    }
    remaining = stillBlocked;
  }

  if (remaining.length > 0) {
    throw new Error(
      `deleteBlockingRowsForBusiness: gagal menghapus baris dari ${remaining.map((r) => r.table).join(", ")} ` +
        `sebelum businesses -- kemungkinan ada FK NO ACTION ke tabel lain di luar daftar ini. ` +
        `Error terakhir: ${lastError instanceof Error ? lastError.message : String(lastError)}`
    );
  }
}

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
  // Ditambahkan Tahap 1 pembatasan akses per outlet (13 September 2026) --
  // testable lewat requirePermission()/getCurrentBusinessFromClient() yang
  // butuh SupabaseClient (bukan koneksi Drizzle), bukan cuma db. Aditif --
  // fixture lama yang destructure {businessId, userId, db, cleanup} saja
  // tidak terpengaruh.
  accessToken: string;
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
    accessToken: signIn.session.access_token,
    cleanup: async () => {
      await close();
      await deleteBlockingRowsForBusiness(adminDb, businessId);
      await adminDb.delete(businesses).where(eq(businesses.id, businessId));
      await admin.auth.admin.deleteUser(userId);
    },
  };
}
