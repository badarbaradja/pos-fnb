import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  integer,
  numeric,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Skema database inti — BLUEPRINT §3.1 (Tenancy, Auth & Device).
 *
 * RLS: setiap tabel bisnis wajib enableRLS() + kebijakan yang membatasi
 * baris ke business_id milik user yang login, lewat auth_business_ids()
 * (BLUEPRINT §9.5). Fungsi itu SENGAJA TIDAK didefinisikan di sini —
 * Drizzle tidak punya builder untuk `create function`, jadi ditulis
 * sebagai SQL mentah di migration (lihat migrations/0000_.../README di
 * folder migrations setelah `npm run db:generate`). Fungsi itu harus
 * dibuat SETELAH tabel `memberships` ada tapi SEBELUM policy manapun
 * yang memanggilnya — migration hasil generate perlu disunting tangan
 * untuk menyisipkannya di posisi yang tepat.
 *
 * `profiles.id` merujuk ke `auth.users(id)` milik Supabase Auth (skema
 * `auth`, dikelola Supabase sendiri). Drizzle sengaja TIDAK diminta
 * membuat tabel itu — foreign key ke `auth.users` ditambahkan lewat SQL
 * mentah di migration, bukan lewat `.references()` di sini, supaya
 * drizzle-kit tidak mencoba men-generate `CREATE TABLE auth.users`.
 */

export const userRoleEnum = pgEnum("user_role", [
  "owner",
  "manager",
  "cashier",
  "waiter",
  "kitchen",
  "warehouse",
  "accountant",
]);

export const businesses = pgTable(
  "businesses",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    businessType: text("business_type").notNull().default("cafe"), // cafe|resto|bakery|bar
    timezone: text("timezone").notNull().default("Asia/Jakarta"),
    currency: text("currency").notNull().default("IDR"),
    logoUrl: text("logo_url"),
    npwp: text("npwp"),
    plan: text("plan").notNull().default("basic"),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    pgPolicy("businesses_select", {
      for: "select",
      using: sql`${t.id} = any(auth_business_ids())`,
    }),
  ]
).enableRLS();

export const outlets = pgTable(
  "outlets",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    code: text("code").notNull(), // 'PST', 'CBG1' -> dipakai di nomor struk
    name: text("name").notNull(),
    address: text("address"),
    phone: text("phone"),
    dayCutoffTime: time("day_cutoff_time").notNull().default("04:00:00"),
    isCentralKitchen: boolean("is_central_kitchen").notNull().default(false),
    // numeric(7,4) sesuai BLUEPRINT §3.0 (kolom persentase)
    taxPercent: numeric("tax_percent", { precision: 7, scale: 4 })
      .notNull()
      .default("10"),
    taxInclusive: boolean("tax_inclusive").notNull().default(false),
    serviceChargePercent: numeric("service_charge_percent", {
      precision: 7,
      scale: 4,
    })
      .notNull()
      .default("0"),
    serviceChargeInTaxBase: boolean("service_charge_in_tax_base")
      .notNull()
      .default(true),
    roundingTo: integer("rounding_to").notNull().default(100),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique().on(t.businessId, t.code),
    pgPolicy("outlets_select", {
      for: "select",
      using: sql`${t.businessId} = any(auth_business_ids())`,
    }),
    pgPolicy("outlets_insert", {
      for: "insert",
      withCheck: sql`${t.businessId} = any(auth_business_ids())`,
    }),
  ]
).enableRLS();

// Profil user, terhubung ke auth.users Supabase (lihat catatan di atas file).
export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id").primaryKey(), // FK ke auth.users(id) ditambahkan lewat SQL mentah di migration
    fullName: text("full_name").notNull(),
    phone: text("phone"),
    avatarUrl: text("avatar_url"),
  },
  (t) => [
    pgPolicy("profiles_select_own", {
      for: "select",
      using: sql`${t.id} = auth.uid()`,
    }),
  ]
).enableRLS();

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    role: userRoleEnum("role").notNull(),
    outletIds: uuid("outlet_ids").array(), // null = semua outlet
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [
    unique().on(t.businessId, t.userId),
    pgPolicy("memberships_select", {
      for: "select",
      using: sql`${t.businessId} = any(auth_business_ids())`,
    }),
  ]
).enableRLS();

// Pegawai TIDAK harus punya akun auth (belajar dari Kasirini: "tambah
// pegawai tanpa daftar") — userId nullable, tidak wajib terhubung profiles.
export const employees = pgTable(
  "employees",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    outletId: uuid("outlet_id").references(() => outlets.id),
    userId: uuid("user_id").references(() => profiles.id), // optional link ke akun
    code: text("code").notNull(),
    fullName: text("full_name").notNull(),
    role: userRoleEnum("role").notNull().default("cashier"),
    pinHash: text("pin_hash"), // bcrypt PIN 6 digit
    employmentType: text("employment_type").notNull().default("fulltime"), // fulltime|parttime|daily|freelance
    joinDate: date("join_date"),
    resignDate: date("resign_date"),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [
    unique().on(t.businessId, t.code),
    pgPolicy("employees_select", {
      for: "select",
      using: sql`${t.businessId} = any(auth_business_ids())`,
    }),
    pgPolicy("employees_insert", {
      for: "insert",
      withCheck: sql`${t.businessId} = any(auth_business_ids())`,
    }),
  ]
).enableRLS();

export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id, { onDelete: "cascade" }),
    serialNumber: text("serial_number").notNull(), // ditampilkan ke user, dipakai pairing
    name: text("name").notNull(), // 'Kasir 1', 'Tablet Waiter A'
    deviceType: text("device_type").notNull().default("pos"), // pos|waiter|kds|display
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastSeq: bigint("last_seq", { mode: "number" }).notNull().default(0), // counter nomor struk lokal
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [
    unique().on(t.businessId, t.serialNumber),
    pgPolicy("devices_select", {
      for: "select",
      using: sql`${t.businessId} = any(auth_business_ids())`,
    }),
    pgPolicy("devices_insert", {
      for: "insert",
      withCheck: sql`${t.businessId} = any(auth_business_ids())`,
    }),
  ]
).enableRLS();

// Tidak punya business_id langsung -> policy join lewat employees.
export const permissionsOverride = pgTable(
  "permissions_override",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    permissionKey: text("permission_key").notNull(), // lihat matriks RBAC BLUEPRINT §7
    allowed: boolean("allowed").notNull(),
  },
  (t) => [
    pgPolicy("permissions_override_select", {
      for: "select",
      using: sql`exists (
        select 1 from employees e
        where e.id = ${t.employeeId}
          and e.business_id = any(auth_business_ids())
      )`,
    }),
  ]
).enableRLS();
