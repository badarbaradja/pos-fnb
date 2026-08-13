import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getAdminDb } from "../src/lib/db/client";
import { createSupabaseAdminClient } from "../src/lib/auth/supabase";
import { businesses, outlets, memberships, profiles } from "../src/lib/db/schema";
import { generateId } from "../src/lib/utils/id";
import { DEMO_BUSINESS_NAME } from "./seed-shared";

/**
 * scripts/seed-demo.ts — sekali-jalan: buat satu business demo, satu outlet
 * demo, dan membership role owner untuk user Supabase Auth yang emailnya
 * diberikan lewat argumen CLI. Idempoten -- aman dijalankan ulang, tidak
 * bikin baris duplikat kalau sudah ada.
 *
 * Pakai getAdminDb() -- operasi sistem (seed), bukan atas nama satu user
 * lewat request, diizinkan CLAUDE.md §3.4.
 *
 * Kalau user Supabase Auth dengan email itu belum ada, script membuatnya
 * (email_confirm: true, langsung bisa login) dengan password acak yang
 * DITAMPILKAN SEKALI di terminal -- tidak disimpan di mana pun, catat lalu
 * ganti lewat halaman lupa password kalau perlu.
 */

const DEMO_OUTLET_CODE = "DEMO1";
const DEMO_OUTLET_NAME = "Outlet Demo";

function generatePassword(): string {
  return randomBytes(18).toString("base64url");
}

async function findOrCreateAuthUserByEmail(email: string) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) {
    throw error;
  }
  const existing = data.users.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase()
  );
  if (existing) {
    console.log(`[auth.users] sudah ada: ${email}`);
    return existing;
  }

  const password = generatePassword();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError || !created.user) {
    throw createError ?? new Error("Gagal membuat user Supabase Auth");
  }
  console.log(`[auth.users] dibuat baru: ${email}`);
  console.log(`  Password sekali-tampil (catat sekarang, TIDAK disimpan): ${password}`);
  return created.user;
}

async function main() {
  const email = process.argv[2];
  if (!email) {
    throw new Error(
      "Pakai: npm run seed:demo -- <email>\nContoh: npm run seed:demo -- owner@contoh.com"
    );
  }

  const authUser = await findOrCreateAuthUserByEmail(email);
  const db = getAdminDb(); // seed data -- operasi sistem, bukan atas nama satu user via request (CLAUDE.md §3.4)

  const [existingProfile] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.id, authUser.id));
  if (!existingProfile) {
    await db.insert(profiles).values({
      id: authUser.id,
      fullName: authUser.email ?? "Demo Owner",
    });
    console.log(`[profiles] dibuat untuk ${authUser.email}`);
  } else {
    console.log(`[profiles] sudah ada untuk ${authUser.email}`);
  }

  let [business] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.name, DEMO_BUSINESS_NAME));
  if (!business) {
    const businessId = generateId();
    await db.insert(businesses).values({ id: businessId, name: DEMO_BUSINESS_NAME });
    [business] = await db
      .select()
      .from(businesses)
      .where(eq(businesses.id, businessId));
    console.log(`[businesses] dibuat: ${DEMO_BUSINESS_NAME} (${businessId})`);
  } else {
    console.log(`[businesses] sudah ada: ${DEMO_BUSINESS_NAME} (${business.id})`);
  }
  if (!business) {
    throw new Error("Gagal membuat/menemukan business demo");
  }

  const [existingOutlet] = await db
    .select()
    .from(outlets)
    .where(
      and(eq(outlets.businessId, business.id), eq(outlets.code, DEMO_OUTLET_CODE))
    );
  if (!existingOutlet) {
    await db.insert(outlets).values({
      id: generateId(),
      businessId: business.id,
      code: DEMO_OUTLET_CODE,
      name: DEMO_OUTLET_NAME,
    });
    console.log(`[outlets] dibuat: ${DEMO_OUTLET_NAME} (${DEMO_OUTLET_CODE})`);
  } else {
    console.log(`[outlets] sudah ada: ${DEMO_OUTLET_NAME} (${DEMO_OUTLET_CODE})`);
  }

  const [existingMembership] = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.businessId, business.id),
        eq(memberships.userId, authUser.id)
      )
    );
  if (!existingMembership) {
    await db.insert(memberships).values({
      id: generateId(),
      businessId: business.id,
      userId: authUser.id,
      role: "owner",
    });
    console.log(`[memberships] dibuat: ${authUser.email} -> owner`);
  } else {
    console.log(
      `[memberships] sudah ada: ${authUser.email} -> ${existingMembership.role}`
    );
  }

  console.log("Selesai.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
