import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getAdminDb } from "../src/lib/db/client";
import { createSupabaseAdminClient } from "../src/lib/auth/supabase";
import {
  brands,
  businesses,
  outlets,
  memberships,
  profiles,
  paymentMethods,
  devices,
  employees,
} from "../src/lib/db/schema";
import { generateId } from "../src/lib/utils/id";
import { hashPin } from "../src/lib/auth/pin";
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
const DEMO_DEVICE_SERIAL = "KASIR1";
const DEMO_DEVICE_NAME = "Kasir 1";
// QRIS requiresRef=true -- sistem ini TIDAK terintegrasi payment gateway,
// QRIS di sini murni metode pencatatan. Nomor referensi diisi manual oleh
// kasir dari notifikasi bank (lihat docs/04-CATATAN-TEKNIS.md).
const DEMO_PAYMENT_METHODS = [
  { code: "CASH", name: "Tunai", type: "cash", isCashDrawer: true, requiresRef: false },
  { code: "QRIS", name: "QRIS", type: "qris", isCashDrawer: false, requiresRef: true },
] as const;
// Karyawan demo untuk login PIN di layar kasir (T15 -- buka shift butuh
// employees dengan pin_hash, seed sebelumnya cuma bikin user Supabase Auth
// untuk owner, bukan employees).
const DEMO_EMPLOYEES = [
  { code: "KSR01", fullName: "Budi Kasir", role: "cashier" as const },
  { code: "MGR01", fullName: "Sari Manajer", role: "manager" as const },
];

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

  let [brand] = await db.select().from(brands).where(eq(brands.businessId, business.id));
  if (!brand) {
    const brandId = generateId();
    await db.insert(brands).values({ id: brandId, businessId: business.id, name: DEMO_BUSINESS_NAME });
    [brand] = await db.select().from(brands).where(eq(brands.id, brandId));
    console.log(`[brands] dibuat: ${DEMO_BUSINESS_NAME}`);
  } else {
    console.log(`[brands] sudah ada: ${brand.name}`);
  }
  if (!brand) {
    throw new Error("Gagal membuat/menemukan brand demo");
  }

  let [outlet] = await db
    .select()
    .from(outlets)
    .where(
      and(eq(outlets.businessId, business.id), eq(outlets.code, DEMO_OUTLET_CODE))
    );
  if (!outlet) {
    const outletId = generateId();
    await db.insert(outlets).values({
      id: outletId,
      businessId: business.id,
      brandId: brand.id,
      code: DEMO_OUTLET_CODE,
      name: DEMO_OUTLET_NAME,
    });
    [outlet] = await db.select().from(outlets).where(eq(outlets.id, outletId));
    console.log(`[outlets] dibuat: ${DEMO_OUTLET_NAME} (${DEMO_OUTLET_CODE})`);
  } else {
    console.log(`[outlets] sudah ada: ${DEMO_OUTLET_NAME} (${DEMO_OUTLET_CODE})`);
  }
  if (!outlet) {
    throw new Error("Gagal membuat/menemukan outlet demo");
  }

  const [existingDevice] = await db
    .select()
    .from(devices)
    .where(
      and(eq(devices.businessId, business.id), eq(devices.serialNumber, DEMO_DEVICE_SERIAL))
    );
  if (!existingDevice) {
    await db.insert(devices).values({
      id: generateId(),
      businessId: business.id,
      outletId: outlet.id,
      serialNumber: DEMO_DEVICE_SERIAL,
      name: DEMO_DEVICE_NAME,
      deviceType: "pos",
    });
    console.log(`[devices] dibuat: ${DEMO_DEVICE_NAME} (${DEMO_DEVICE_SERIAL})`);
  } else {
    console.log(`[devices] sudah ada: ${DEMO_DEVICE_NAME} (${DEMO_DEVICE_SERIAL})`);
  }

  for (const [index, pm] of DEMO_PAYMENT_METHODS.entries()) {
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
      // Update field yang bisa berubah lewat definisi di atas (mis.
      // requiresRef) -- supaya re-run seed ini juga menerapkan koreksi ke
      // baris yang sudah ada, bukan cuma insert-kalau-belum-ada.
      await db
        .update(paymentMethods)
        .set({
          name: pm.name,
          type: pm.type,
          isCashDrawer: pm.isCashDrawer,
          requiresRef: pm.requiresRef,
        })
        .where(eq(paymentMethods.id, existingMethod.id));
      console.log(`[payment_methods] sudah ada, diperbarui: ${pm.name} (${pm.code})`);
    }
  }

  // PIN dari env kalau ada -- SEED_EMPLOYEE_PIN cuma dibaca di sini, tidak
  // pernah disimpan mentah, cuma di-hash lewat hashPin() (bcrypt, sama
  // seperti verifyCashierPin() memverifikasinya di lib/auth/pin.ts).
  const seedPin = process.env["SEED_EMPLOYEE_PIN"];
  if (!seedPin) {
    console.warn(
      "[employees] SEED_EMPLOYEE_PIN tidak diset -- pakai PIN default '123456'. " +
        "HANYA untuk data demo lokal, JANGAN pernah dipakai di lingkungan produksi."
    );
  }
  const employeePin = seedPin || "123456";
  const employeePinHash = await hashPin(employeePin);

  for (const emp of DEMO_EMPLOYEES) {
    const [existingEmployee] = await db
      .select()
      .from(employees)
      .where(and(eq(employees.businessId, business.id), eq(employees.code, emp.code)));
    if (!existingEmployee) {
      await db.insert(employees).values({
        id: generateId(),
        businessId: business.id,
        outletId: outlet.id,
        code: emp.code,
        fullName: emp.fullName,
        role: emp.role,
        pinHash: employeePinHash,
      });
      console.log(`[employees] dibuat: ${emp.fullName} (${emp.code}, ${emp.role})`);
    } else {
      // Update juga PIN + data lain saat re-run -- termasuk reset lockout
      // supaya seed ini selalu menghasilkan karyawan yang bisa langsung
      // login, walau sebelumnya sempat terkunci dari percobaan PIN salah.
      await db
        .update(employees)
        .set({
          outletId: outlet.id,
          fullName: emp.fullName,
          role: emp.role,
          pinHash: employeePinHash,
          failedAttempts: 0,
          lockedUntil: null,
          isActive: true,
        })
        .where(eq(employees.id, existingEmployee.id));
      console.log(`[employees] sudah ada, diperbarui: ${emp.fullName} (${emp.code}, ${emp.role})`);
    }
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

  console.log("\nLogin kasir (buka shift di /pos/shift/open):");
  for (const emp of DEMO_EMPLOYEES) {
    console.log(`  ${emp.fullName} (${emp.role}) -- kode: ${emp.code}, PIN: ${employeePin}`);
  }

  console.log("\nSelesai.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
