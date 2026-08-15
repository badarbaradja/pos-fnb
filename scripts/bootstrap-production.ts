import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";

/**
 * scripts/bootstrap-production.ts — T19. Versi minimal seed-demo.ts UNTUK
 * BISNIS PRODUKSI SUNGGUHAN: satu Supabase Auth user (owner) + profile +
 * business + outlet pertama + metode pembayaran dasar (mengikuti
 * `outlet.cashEnabled` -- lihat buildPaymentMethods()).
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
 *
 * Pakai: npm run bootstrap:production -- [path/ke/config.json]
 * (default scripts/bootstrap-config.json). Lihat
 * scripts/bootstrap-config.example.json untuk formatnya.
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

import { z } from "zod";
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

// Password owner TIDAK digenerate otomatis -- password acak yang
// ditampilkan lewat console.log ikut masuk scrollback/riwayat terminal,
// dan ini kredensial produksi milik klien, bukan data demo. Diisi sendiri
// di .env.production.local sebelum menjalankan skrip ini.
const ownerPassword = process.env["BOOTSTRAP_OWNER_PASSWORD"];
if (!ownerPassword) {
  throw new Error(
    "bootstrap-production.ts: BOOTSTRAP_OWNER_PASSWORD kosong/tidak ada di .env.production.local.\n" +
      "Isi dulu dengan password yang kuat sebelum menjalankan skrip ini -- tidak digenerate otomatis."
  );
}

const configSchema = z.object({
  ownerEmail: z.string().trim().email(),
  business: z.object({
    name: z.string().trim().min(1),
    timezone: z.string().trim().min(1),
  }),
  outlet: z.object({
    name: z.string().trim().min(1),
    code: z.string().trim().min(1),
    address: z.string().trim().min(1).optional(),
    dayCutoffTime: z.string().trim().min(1),
    taxPercent: z.number(),
    taxInclusive: z.boolean(),
    serviceChargePercent: z.number(),
    cashEnabled: z.boolean(),
    roundingTo: z.number().int(),
  }),
});

type BootstrapConfig = z.infer<typeof configSchema>;

function loadConfig(path: string): BootstrapConfig {
  const resolved = resolve(process.cwd(), path);
  if (!existsSync(resolved)) {
    throw new Error(
      `bootstrap-production.ts: file config "${path}" tidak ditemukan.\n` +
        "Salin scripts/bootstrap-config.example.json jadi scripts/bootstrap-config.json, isi datanya, lalu jalankan lagi."
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(resolved, "utf-8"));
  } catch (err) {
    throw new Error(`bootstrap-production.ts: "${path}" bukan JSON valid -- ${(err as Error).message}`);
  }

  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `bootstrap-production.ts: "${path}" tidak sesuai format -- ${issue?.message} (field: ${issue?.path.join(".")})`
    );
  }
  return parsed.data;
}

/**
 * Tunai TIDAK PERNAH dibuat untuk outlet cashless -- konsisten dengan
 * outlets.cashEnabled yang sudah mematikan seluruh alur kas di shift (T15).
 */
function buildPaymentMethods(cashEnabled: boolean) {
  const qris = { code: "QRIS", name: "QRIS", type: "qris", isCashDrawer: false, requiresRef: true } as const;
  if (!cashEnabled) return [qris];
  const cash = { code: "CASH", name: "Tunai", type: "cash", isCashDrawer: true, requiresRef: false } as const;
  return [cash, qris];
}

async function findOrCreateAuthUserByEmail(email: string, password: string) {
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

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError || !created.user) {
    throw createError ?? new Error("Gagal membuat user Supabase Auth");
  }
  console.log(`[auth.users] dibuat baru: ${email}`);
  return created.user;
}

async function main() {
  const configPath = process.argv[2] ?? "scripts/bootstrap-config.json";
  const config = loadConfig(configPath);

  const authUser = await findOrCreateAuthUserByEmail(config.ownerEmail, ownerPassword!);
  const db = getAdminDb(); // bootstrap sekali di awal -- operasi sistem, bukan atas nama user via request (CLAUDE.md §3.4)

  const [existingProfile] = await db.select().from(profiles).where(eq(profiles.id, authUser.id));
  if (!existingProfile) {
    await db.insert(profiles).values({ id: authUser.id, fullName: authUser.email ?? config.business.name });
    console.log(`[profiles] dibuat untuk ${authUser.email}`);
  } else {
    console.log(`[profiles] sudah ada untuk ${authUser.email}`);
  }

  let [business] = await db.select().from(businesses).where(eq(businesses.name, config.business.name));
  if (!business) {
    const businessId = generateId();
    await db.insert(businesses).values({
      id: businessId,
      name: config.business.name,
      timezone: config.business.timezone,
    });
    [business] = await db.select().from(businesses).where(eq(businesses.id, businessId));
    console.log(`[businesses] dibuat: ${config.business.name} (${businessId})`);
  } else {
    console.log(`[businesses] sudah ada: ${config.business.name} (${business.id})`);
  }
  if (!business) {
    throw new Error("Gagal membuat/menemukan business");
  }

  let [outlet] = await db
    .select()
    .from(outlets)
    .where(and(eq(outlets.businessId, business.id), eq(outlets.code, config.outlet.code)));
  if (!outlet) {
    const outletId = generateId();
    await db.insert(outlets).values({
      id: outletId,
      businessId: business.id,
      code: config.outlet.code,
      name: config.outlet.name,
      address: config.outlet.address ?? null,
      dayCutoffTime: config.outlet.dayCutoffTime,
      taxPercent: String(config.outlet.taxPercent),
      taxInclusive: config.outlet.taxInclusive,
      serviceChargePercent: String(config.outlet.serviceChargePercent),
      cashEnabled: config.outlet.cashEnabled,
      roundingTo: config.outlet.roundingTo,
    });
    [outlet] = await db.select().from(outlets).where(eq(outlets.id, outletId));
    console.log(`[outlets] dibuat: ${config.outlet.name} (${config.outlet.code})`);
  } else {
    console.log(`[outlets] sudah ada: ${config.outlet.name} (${config.outlet.code})`);
  }
  if (!outlet) {
    throw new Error("Gagal membuat/menemukan outlet");
  }

  for (const [index, pm] of buildPaymentMethods(config.outlet.cashEnabled).entries()) {
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

  console.log(`\nSelesai. ${authUser.email} bisa login ke dashboard sebagai owner "${config.business.name}".`);
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
