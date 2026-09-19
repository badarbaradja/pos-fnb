import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { eq, and } from "drizzle-orm";
import { getAdminDb } from "../src/lib/db/client";
import { createSupabaseAdminClient } from "../src/lib/auth/supabase";
import {
  businesses,
  memberships,
  profiles,
} from "../src/lib/db/schema";
import { generateId } from "../src/lib/utils/id";

/**
 * Jalur pemulihan terakhir kalau terkunci dari akun Owner (service-role,
 * melewati RLS). Pakai:
 *   RESET_OWNER_PASSWORD='<password baru>' npx tsx scripts/reset-owner.ts [email]
 * Password WAJIB dari env RESET_OWNER_PASSWORD -- tidak ada default dan
 * tidak diterima lewat argumen baris perintah (tersimpan di riwayat shell).
 * Password tidak pernah dicetak.
 */
async function main() {
  const targetEmail = process.argv[2] || "putri@koperumnas.com";
  const targetPassword = process.env["RESET_OWNER_PASSWORD"];
  if (!targetPassword) {
    throw new Error(
      "RESET_OWNER_PASSWORD belum diset. Jalankan: RESET_OWNER_PASSWORD='<password baru>' npx tsx scripts/reset-owner.ts [email] -- tidak ada password default, sengaja."
    );
  }

  console.log(`Mengatur akun Owner untuk: ${targetEmail}`);

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) {
    throw error;
  }

  const existing = data.users.find(
    (u) => u.email?.toLowerCase() === targetEmail.toLowerCase()
  );

  let userId: string;

  if (existing) {
    console.log(`[auth.users] Ditemukan user: ${existing.email} (ID: ${existing.id})`);
    const { data: updated, error: updateError } = await admin.auth.admin.updateUserById(
      existing.id,
      {
        password: targetPassword,
        email_confirm: true,
      }
    );
    if (updateError || !updated.user) {
      throw updateError ?? new Error("Gagal update password user");
    }
    userId = updated.user.id;
    console.log("[auth.users] Password berhasil diubah (nilai dari RESET_OWNER_PASSWORD, tidak dicetak).");
  } else {
    console.log(`[auth.users] Membuat user baru: ${targetEmail}`);
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: targetEmail,
      password: targetPassword,
      email_confirm: true,
    });
    if (createError || !created.user) {
      throw createError ?? new Error("Gagal membuat user Supabase Auth");
    }
    userId = created.user.id;
    console.log("[auth.users] User baru berhasil dibuat (password dari RESET_OWNER_PASSWORD, tidak dicetak).");
  }

  const db = getAdminDb();

  // 1. Profile
  const [existingProfile] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.id, userId));

  if (!existingProfile) {
    await db.insert(profiles).values({
      id: userId,
      fullName: "Putri",
    });
    console.log(`[profiles] Profil dibuat untuk ${targetEmail}`);
  } else {
    await db.update(profiles).set({ fullName: "Putri" }).where(eq(profiles.id, userId));
    console.log(`[profiles] Profil diperbarui untuk ${targetEmail}`);
  }

  // 2. Memberships untuk semua business yang ada
  const allBusinesses = await db.select().from(businesses);
  if (allBusinesses.length === 0) {
    console.log("[businesses] Belum ada business di database. Menjalankan seed default jika perlu.");
  } else {
    for (const biz of allBusinesses) {
      const [existingMembership] = await db
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.businessId, biz.id),
            eq(memberships.userId, userId)
          )
        );

      if (!existingMembership) {
        await db.insert(memberships).values({
          id: generateId(),
          businessId: biz.id,
          userId: userId,
          role: "owner",
        });
        console.log(`[memberships] Dibuat role 'owner' untuk bisnis: ${biz.name} (${biz.id})`);
      } else {
        await db
          .update(memberships)
          .set({ role: "owner" })
          .where(eq(memberships.id, existingMembership.id));
        console.log(`[memberships] Diperbarui role 'owner' untuk bisnis: ${biz.name} (${biz.id})`);
      }
    }
  }

  console.log("\n=========================================");
  console.log("SUKSES: Akun Owner siap digunakan!");
  console.log(`Email    : ${targetEmail}`);
  console.log("Password : (sesuai RESET_OWNER_PASSWORD)");
  console.log(`Role     : Owner`);
  console.log("=========================================\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Gagal mengatur akun owner:", err);
    process.exit(1);
  });
