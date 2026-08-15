import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";

/**
 * scripts/bootstrap-production.ts — T19. Versi minimal seed-demo.ts UNTUK
 * BISNIS PRODUKSI SUNGGUHAN: satu Supabase Auth user (owner) + profile +
 * business + outlet pertama + metode pembayaran dasar (Tunai/QRIS, bukan
 * data fiktif -- setiap outlet F&B di Indonesia butuh keduanya).
 *
 * SENGAJA TIDAK membuat: karyawan/PIN (dibuat owner sendiri lewat dashboard
 * /employees setelah login, T15b), katalog produk (diisi owner sendiri
 * lewat dashboard). Ini beda dari seed-demo.ts yang eksplisit demo-only
 * (PIN default, karyawan & katalog fiktif) -- jangan pernah pakai
 * seed-demo.ts untuk bisnis produksi sungguhan.
 *
 * Idempoten -- aman dijalankan ulang, tidak bikin baris duplikat.
 * Pakai getAdminDb() -- operasi sistem (bootstrap sekali di awal), bukan
 * atas nama satu user lewat request, diizinkan CLAUDE.md §3.4.
 *
 * HANYA baca .env.production.local -- TIDAK ADA fallback ke .env.local/
 * .env (itu database dev), sama seperti drizzle.config.production.ts (T19).
 * Skrip ini SELALU untuk bisnis produksi sungguhan; kalau butuh data demo
 * di dev, pakai scripts/seed-demo.ts.
 */

const PROD_ENV_PATH = resolve(process.cwd(), ".env.production.local");
if (!existsSync(PROD_ENV_PATH)) {
  throw new Error(
    "bootstrap-production.ts: .env.production.local tidak ditemukan di root proyek.\n" +
      "Ini SENGAJA tidak fallback ke .env.local/.env (itu database dev) -- pastikan " +
      ".env.production.local sudah berisi kredensial project Supabase produksi."
  );
}
loadEnv({ path: PROD_ENV_PATH, quiet: true });

import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getAdminDb } from "../src/lib/db/client";
import { createSupabaseAdminClient } from "../src/lib/auth/supabase";
import { businesses, outlets, memberships, profiles, paymentMethods } from "../src/lib/db/schema";
import { generateId } from "../src/lib/utils/id";
import { assertValidDatabaseUrl } from "../src/lib/db/validate-database-url";

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  throw new Error("bootstrap-production.ts: DATABASE_URL kosong/tidak ada di .env.production.local.");
}
try {
  assertValidDatabaseUrl(databaseUrl);
} catch (err) {
  throw new Error(`bootstrap-production.ts: ${(err as Error).message}`);
}

const DEFAULT_PAYMENT_METHODS = [
  { code: "CASH", name: "Tunai", type: "cash", isCashDrawer: true, requiresRef: false },
  { code: "QRIS", name: "QRIS", type: "qris", isCashDrawer: false, requiresRef: true },
] as const;

function generatePassword(): string {
  return randomBytes(18).toString("base64url");
}

async function findOrCreateAuthUserByEmail(email: string) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) {
    throw error;
  }
  const existing = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
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
  const [email, businessName, outletName = "Outlet Utama", outletCode = "MAIN"] = process.argv.slice(2);
  if (!email || !businessName) {
    throw new Error(
      "Pakai: npm run bootstrap:production -- <email> <\"Nama Bisnis\"> [\"Nama Outlet\"] [KodeOutlet]\n" +
        'Contoh: npm run bootstrap:production -- owner@klien.com "Kopi Senja" "Outlet Pusat" PST'
    );
  }

  const authUser = await findOrCreateAuthUserByEmail(email);
  const db = getAdminDb(); // bootstrap sekali di awal -- operasi sistem, bukan atas nama user via request (CLAUDE.md §3.4)

  const [existingProfile] = await db.select().from(profiles).where(eq(profiles.id, authUser.id));
  if (!existingProfile) {
    await db.insert(profiles).values({ id: authUser.id, fullName: authUser.email ?? businessName });
    console.log(`[profiles] dibuat untuk ${authUser.email}`);
  } else {
    console.log(`[profiles] sudah ada untuk ${authUser.email}`);
  }

  let [business] = await db.select().from(businesses).where(eq(businesses.name, businessName));
  if (!business) {
    const businessId = generateId();
    await db.insert(businesses).values({ id: businessId, name: businessName });
    [business] = await db.select().from(businesses).where(eq(businesses.id, businessId));
    console.log(`[businesses] dibuat: ${businessName} (${businessId})`);
  } else {
    console.log(`[businesses] sudah ada: ${businessName} (${business.id})`);
  }
  if (!business) {
    throw new Error("Gagal membuat/menemukan business");
  }

  let [outlet] = await db
    .select()
    .from(outlets)
    .where(and(eq(outlets.businessId, business.id), eq(outlets.code, outletCode)));
  if (!outlet) {
    const outletId = generateId();
    await db
      .insert(outlets)
      .values({ id: outletId, businessId: business.id, code: outletCode, name: outletName });
    [outlet] = await db.select().from(outlets).where(eq(outlets.id, outletId));
    console.log(`[outlets] dibuat: ${outletName} (${outletCode})`);
  } else {
    console.log(`[outlets] sudah ada: ${outletName} (${outletCode})`);
  }
  if (!outlet) {
    throw new Error("Gagal membuat/menemukan outlet");
  }

  for (const [index, pm] of DEFAULT_PAYMENT_METHODS.entries()) {
    const [existingMethod] = await db
      .select()
      .from(paymentMethods)
      .where(and(eq(paymentMethods.businessId, business.id), eq(paymentMethods.code, pm.code)));
    if (!existingMethod) {
      await db.insert(paymentMethods).values({
        id: generateId(),
        businessId: business.id,
        code: pm.code,
        name: pm.name,
        type: pm.type,
        isCashDrawer: pm.isCashDrawer,
        requiresRef: pm.requiresRef,
        sortOrder: index,
      });
      console.log(`[payment_methods] dibuat: ${pm.name} (${pm.code})`);
    } else {
      console.log(`[payment_methods] sudah ada: ${pm.name} (${pm.code})`);
    }
  }

  const [existingMembership] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.businessId, business.id), eq(memberships.userId, authUser.id)));
  if (!existingMembership) {
    await db
      .insert(memberships)
      .values({ id: generateId(), businessId: business.id, userId: authUser.id, role: "owner" });
    console.log(`[memberships] dibuat: ${authUser.email} -> owner`);
  } else {
    console.log(`[memberships] sudah ada: ${authUser.email} -> ${existingMembership.role}`);
  }

  console.log(`\nSelesai. ${authUser.email} bisa login ke dashboard sebagai owner "${businessName}".`);
  console.log(
    "\nLangkah selanjutnya (lewat dashboard, bukan script): login, lalu menu \"Karyawan\" " +
      "untuk menambah kasir pertama (kode + PIN sendiri, bukan default) sebelum bisa buka shift di /pos."
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
