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
  primaryKey,
  text,
  time,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
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
    // Lockout percobaan PIN (T07): ruang PIN 6 digit cuma 1 juta kombinasi,
    // hash saja tidak cukup. Kebijakan: 5 kali gagal -> kunci 15 menit,
    // reset failedAttempts setelah berhasil login. Lihat lib/auth/pin.ts.
    failedAttempts: integer("failed_attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
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

/**
 * Skema katalog — BLUEPRINT §3.2 (Master Data & Katalog), T08.
 *
 * `product_variants`, `product_prices`, `modifiers`, `product_modifier_groups`,
 * dan `product_bundle_items` TIDAK punya kolom business_id langsung (sesuai
 * BLUEPRINT) — policy RLS-nya lewat EXISTS join ke tabel induk yang punya
 * business_id (products atau modifier_groups), pola yang sama seperti
 * permissions_override di T07.
 */

export const productTypeEnum = pgEnum("product_type", [
  "simple",
  "recipe",
  "bundle",
  "service",
  "open_price",
]);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color"),
    sortOrder: integer("sort_order").notNull().default(0),
    parentId: uuid("parent_id").references((): AnyPgColumn => categories.id),
  },
  (t) => [
    pgPolicy("categories_select", {
      for: "select",
      using: sql`${t.businessId} = any(auth_business_ids())`,
    }),
    pgPolicy("categories_insert", {
      for: "insert",
      withCheck: sql`${t.businessId} = any(auth_business_ids())`,
    }),
  ]
).enableRLS();

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => categories.id),
    sku: text("sku"),
    barcode: text("barcode"),
    name: text("name").notNull(),
    description: text("description"),
    imageUrl: text("image_url"),
    productType: productTypeEnum("product_type").notNull().default("recipe"),
    // 'simple'  : dijual utuh, stok dikurangi langsung (botol Aqua, snack)
    // 'recipe'  : dibuat dari bahan, stok bahan yang dikurangi (latte, nasi goreng)
    // 'bundle'  : paket dari beberapa produk
    // 'service' : tidak ada stok (biaya kemasan, tip)
    trackStock: boolean("track_stock").notNull().default(true),
    isFavorite: boolean("is_favorite").notNull().default(false),
    isTaxable: boolean("is_taxable").notNull().default(true),
    prepStation: text("prep_station"), // 'kitchen' | 'bar' | 'dessert' -> routing KDS
    prepMinutes: integer("prep_minutes"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    pgPolicy("products_select", {
      for: "select",
      using: sql`${t.businessId} = any(auth_business_ids())`,
    }),
    pgPolicy("products_insert", {
      for: "insert",
      withCheck: sql`${t.businessId} = any(auth_business_ids())`,
    }),
  ]
).enableRLS();

export const productVariants = pgTable(
  "product_variants",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    name: text("name").notNull(), // 'Regular', 'Large', 'Hot', 'Iced'
    sku: text("sku"),
    priceDelta: numeric("price_delta", { precision: 16, scale: 2 })
      .notNull()
      .default("0"),
    isDefault: boolean("is_default").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [
    pgPolicy("product_variants_select", {
      for: "select",
      using: sql`exists (
        select 1 from products p
        where p.id = ${t.productId}
          and p.business_id = any(auth_business_ids())
      )`,
    }),
    pgPolicy("product_variants_insert", {
      for: "insert",
      withCheck: sql`exists (
        select 1 from products p
        where p.id = ${t.productId}
          and p.business_id = any(auth_business_ids())
      )`,
    }),
  ]
).enableRLS();

// MULTI HARGA (fitur kunci Kasirini): dine-in, takeaway, GoFood, member
export const priceTiers = pgTable(
  "price_tiers",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    code: text("code").notNull(), // 'DINEIN','TAKEAWAY','GOFOOD','MEMBER'
    name: text("name").notNull(),
    channel: text("channel"), // link ke sales channel
    // numeric(7,4) sesuai BLUEPRINT §3.0. Tanpa notNull() -- BLUEPRINT cuma
    // kasih default 0, bukan "not null".
    markupPercent: numeric("markup_percent", { precision: 7, scale: 4 }).default(
      "0"
    ),
    isDefault: boolean("is_default").notNull().default(false),
  },
  (t) => [
    unique().on(t.businessId, t.code),
    pgPolicy("price_tiers_select", {
      for: "select",
      using: sql`${t.businessId} = any(auth_business_ids())`,
    }),
    pgPolicy("price_tiers_insert", {
      for: "insert",
      withCheck: sql`${t.businessId} = any(auth_business_ids())`,
    }),
  ]
).enableRLS();

export const productPrices = pgTable(
  "product_prices",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").references(() => productVariants.id, {
      onDelete: "cascade",
    }),
    priceTierId: uuid("price_tier_id")
      .notNull()
      .references(() => priceTiers.id, { onDelete: "cascade" }),
    outletId: uuid("outlet_id").references(() => outlets.id), // null = berlaku semua outlet
    price: numeric("price", { precision: 16, scale: 2 }).notNull(),
    validFrom: date("valid_from"),
    validTo: date("valid_to"),
  },
  (t) => [
    unique()
      .on(t.productId, t.variantId, t.priceTierId, t.outletId, t.validFrom)
      .nullsNotDistinct(),
    pgPolicy("product_prices_select", {
      for: "select",
      using: sql`exists (
        select 1 from products p
        where p.id = ${t.productId}
          and p.business_id = any(auth_business_ids())
      )`,
    }),
    pgPolicy("product_prices_insert", {
      for: "insert",
      withCheck: sql`exists (
        select 1 from products p
        where p.id = ${t.productId}
          and p.business_id = any(auth_business_ids())
      )`,
    }),
  ]
).enableRLS();

// MODIFIER (extra shot, less sugar, level pedas)
export const modifierGroups = pgTable(
  "modifier_groups",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    name: text("name").notNull(), // 'Level Gula', 'Topping'
    minSelect: integer("min_select").notNull().default(0),
    maxSelect: integer("max_select").notNull().default(1),
    isRequired: boolean("is_required").notNull().default(false),
  },
  (t) => [
    pgPolicy("modifier_groups_select", {
      for: "select",
      using: sql`${t.businessId} = any(auth_business_ids())`,
    }),
    pgPolicy("modifier_groups_insert", {
      for: "insert",
      withCheck: sql`${t.businessId} = any(auth_business_ids())`,
    }),
  ]
).enableRLS();

export const modifiers = pgTable(
  "modifiers",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    modifierGroupId: uuid("modifier_group_id")
      .notNull()
      .references(() => modifierGroups.id, { onDelete: "cascade" }),
    name: text("name").notNull(), // 'Extra Shot', 'Less Ice'
    price: numeric("price", { precision: 16, scale: 2 }).notNull().default("0"),
    ingredientId: uuid("ingredient_id"), // konsumsi bahan -- tabel ingredients belum ada (Fase 2)
    ingredientQty: numeric("ingredient_qty", { precision: 16, scale: 4 }), // misal extra shot = 9 gram kopi
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    pgPolicy("modifiers_select", {
      for: "select",
      using: sql`exists (
        select 1 from modifier_groups mg
        where mg.id = ${t.modifierGroupId}
          and mg.business_id = any(auth_business_ids())
      )`,
    }),
    pgPolicy("modifiers_insert", {
      for: "insert",
      withCheck: sql`exists (
        select 1 from modifier_groups mg
        where mg.id = ${t.modifierGroupId}
          and mg.business_id = any(auth_business_ids())
      )`,
    }),
  ]
).enableRLS();

export const productModifierGroups = pgTable(
  "product_modifier_groups",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    modifierGroupId: uuid("modifier_group_id")
      .notNull()
      .references(() => modifierGroups.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.modifierGroupId] }),
    pgPolicy("product_modifier_groups_select", {
      for: "select",
      using: sql`exists (
        select 1 from products p
        where p.id = ${t.productId}
          and p.business_id = any(auth_business_ids())
      )`,
    }),
    pgPolicy("product_modifier_groups_insert", {
      for: "insert",
      withCheck: sql`exists (
        select 1 from products p
        where p.id = ${t.productId}
          and p.business_id = any(auth_business_ids())
      )`,
    }),
  ]
).enableRLS();

export const productBundleItems = pgTable(
  "product_bundle_items",
  {
    bundleId: uuid("bundle_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id),
    qty: numeric("qty", { precision: 16, scale: 4 }).notNull().default("1"),
  },
  (t) => [
    primaryKey({ columns: [t.bundleId, t.productId, t.variantId] }),
    pgPolicy("product_bundle_items_select", {
      for: "select",
      using: sql`exists (
        select 1 from products p
        where p.id = ${t.bundleId}
          and p.business_id = any(auth_business_ids())
      )`,
    }),
    pgPolicy("product_bundle_items_insert", {
      for: "insert",
      withCheck: sql`exists (
        select 1 from products p
        where p.id = ${t.bundleId}
          and p.business_id = any(auth_business_ids())
      )`,
    }),
  ]
).enableRLS();
