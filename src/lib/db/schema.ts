import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
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
    // T22 -- ambang "menunggu sejak" di daftar transfer stok (status
    // requested) sebelum ditandai merah. Jam ELAPSED wall-clock sederhana,
    // BUKAN kalender jam operasional per outlet -- itu jauh lebih rumit
    // (perlu tahu jam buka/tutup tiap outlet) dan tidak diminta. Default 4
    // jam mengikuti angka yang diberikan, belum ada UI untuk mengubahnya
    // (businesses tidak punya halaman pengaturan/policy UPDATE sama
    // sekali -- gap yang sudah ada sebelum T22, bukan baru).
    transferRequestAlertHours: integer("transfer_request_alert_hours")
      .notNull()
      .default(4),
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

// T22a -- satu pemilik bisa punya lebih dari satu nama dagang (brand)
// berbagi satu business/gudang yang sama (docs/05-RENCANA-FASE-2.md §8.a,
// Indokopi + Indosteak). brands CUMA untuk label & pengelompokan laporan
// (§8.a/§8.b) -- KETERSEDIAAN produk di katalog kasir TIDAK ditentukan
// brand, itu tanggung jawab product_outlets (di bawah). Tidak ada delete
// policy -- master data, nonaktifkan lewat isActive (CLAUDE.md §3.2).
export const brands = pgTable(
  "brands",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [
    unique().on(t.businessId, t.name),
    pgPolicy("brands_select", {
      for: "select",
      using: sql`${t.businessId} = any(auth_business_ids())`,
    }),
    pgPolicy("brands_insert", {
      for: "insert",
      withCheck: sql`${t.businessId} = any(auth_business_ids())`,
    }),
    pgPolicy("brands_update", {
      for: "update",
      using: sql`${t.businessId} = any(auth_business_ids())`,
      withCheck: sql`${t.businessId} = any(auth_business_ids())`,
    }),
  ]
).enableRLS();

// Thrifting (TT06, 10 September 2026) -- membedakan outlet mana yang
// dilayani layar kasir F&B (/pos) vs layar kasir barang titipan
// (/pos/thrift). SATU-SATUNYA pembeda routing -- tanpa ini "outlet baru,
// bisnis yang sama" (keputusan arsitektur RENCANA-PEMBANGUNAN §1) tidak
// punya cara memberi tahu /pos/page.tsx harus redirect ke layar mana.
// Default 'fnb' supaya SEMUA outlet yang sudah ada (Indosteak, Indokopi)
// tidak berubah perilaku sama sekali.
export const posModeEnum = pgEnum("pos_mode", ["fnb", "thrifting"]);

export const outlets = pgTable(
  "outlets",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    // NOT NULL -- setiap outlet harus jelas satu brand untuk pelaporan
    // per brand (§8.a). Data lama di-backfill ke brand default lewat
    // migration (lihat komentar migration 0021), bukan nullable sementara.
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id),
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
    // Batas selisih kas tutup shift (CALC-SPEC bagian E) sebelum alasan
    // wajib diisi -- setting per outlet, BUKAN hardcode (T15).
    cashVarianceTolerance: numeric("cash_variance_tolerance", {
      precision: 16,
      scale: 2,
    })
      .notNull()
      .default("20000"),
    // Outlet cashless penuh: matikan seluruh bagian kas dari alur shift
    // (modal awal, kas masuk/keluar, hitung fisik/selisih) -- shift tetap
    // ada (masih perlu tahu siapa kasir yang bertugas), tapi tutup shift
    // lewat jalur ringkas tanpa rekonsiliasi (T15 lanjutan).
    cashEnabled: boolean("cash_enabled").notNull().default(true),
    // Ambang variance per outlet — opname dengan selisih di atas ambang
    // wajib approval manajer. Dua ambang terpisah: persen dari pemakaian
    // teoritis DAN nilai absolut per bahan. Alert muncul kalau salah satu
    // terlampaui (T21, jawaban owner soal ambang peringatan variance).
    varianceAlertPercent: numeric("variance_alert_percent", {
      precision: 7,
      scale: 4,
    })
      .notNull()
      .default("3"), // 3% dari pemakaian teoritis — standard industri F&B
    varianceAlertValue: numeric("variance_alert_value", {
      precision: 16,
      scale: 2,
    })
      .notNull()
      .default("100000"), // Rp 100.000 per bahan per opname
    posMode: posModeEnum("pos_mode").notNull().default("fnb"),
    // Ambang "barang menumpuk" (Statistik Ita, thrifting) -- default 60
    // hari, TIDAK di-hardcode di query (lihat lib/pos/thrift-statistik.ts)
    // karena perputaran barang titipan beda-beda per outlet, cuma ketahuan
    // setelah berjalan beberapa bulan. Diubah dari Statistik Ita langsung
    // (role manager/owner pemilik shift, gerbang sama "Tambah Barang") --
    // Ita tidak pernah login dashboard, jadi tidak lewat outlet-form-dialog
    // (jawaban CEO 11 September 2026).
    barangMenumpukDays: integer("barang_menumpuk_days").notNull().default(60),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique().on(t.businessId, t.code),
    // A-Z0-9 saja -- kode outlet dicetak jadi awalan barcode barang titipan
    // (lib/barang/kode.ts), langsung di-encode Code128 tanpa transformasi
    // apa pun. Pertahanan server terakhir (CLAUDE.md §3.4: RLS/validasi
    // bukan satu-satunya) -- validasi Zod di lib/outlets/manage.ts sudah
    // menolak input baru, ini menutup jalur lain (mis. insert manual lewat
    // getAdminDb()) yang tidak lewat Server Action. Ditemukan sebagai
    // kerapuhan (bukan penyebab) saat investigasi bug barcode salah baca,
    // 12 September 2026 -- lihat migration 0028 untuk baris lama.
    check("outlets_code_format", sql`${t.code} ~ '^[A-Z0-9]+$'`),
    pgPolicy("outlets_select", {
      for: "select",
      using: sql`${t.businessId} = any(auth_business_ids())`,
    }),
    pgPolicy("outlets_insert", {
      for: "insert",
      withCheck: sql`${t.businessId} = any(auth_business_ids())`,
    }),
    // Gap dari T06 (sama pola dengan employees_update/devices_update) --
    // tidak ada policy UPDATE berarti tidak ada UPDATE ke outlets yang bisa
    // lewat koneksi RLS-bound sama sekali. Dibutuhkan T22b untuk halaman
    // kelola outlet dashboard. withCheck eksplisit (bukan reuse USING) --
    // pelajaran dari bug stock_transfers_update di migration 0019: tanpa
    // withCheck eksplisit, Postgres reuse USING utk baris baru juga.
    pgPolicy("outlets_update", {
      for: "update",
      using: sql`${t.businessId} = any(auth_business_ids())`,
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
    // Akun tamu bersama (TT09b, 10 September 2026) -- SATU baris employee
    // dengan kredensial PIN yang dibagi ke siapa pun bertugas jam sepi
    // (part-time, dst). `openShiftWithDb()` MEWAJIBKAN `shifts.servedByName`
    // diisi kalau baris ini true -- lihat komentar di `shifts` di bawah.
    // Default false -- karyawan bernama biasa TIDAK terpengaruh sama sekali.
    isSharedAccount: boolean("is_shared_account").notNull().default(false),
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
    // Gap dari T07 (sama pola dengan devices_update di bawah) -- tidak ada
    // policy UPDATE berarti tidak ada UPDATE ke employees yang bisa lewat
    // koneksi RLS-bound sama sekali. Dibutuhkan T15b untuk edit/reset PIN/
    // buka kunci/nonaktifkan karyawan lewat dashboard.
    pgPolicy("employees_update", {
      for: "update",
      using: sql`${t.businessId} = any(auth_business_ids())`,
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
    // T22e -- diisi setiap kali device ini dipasangkan ke satu tablet
    // (lib/pos/device-pairing.ts). Dipakai untuk memperingatkan manajer
    // kalau device yang sama dipasangkan ke tablet lain SAAT device itu
    // sedang punya shift terbuka -- last_seq (counter struk) dan stok
    // yang berpindah lewat device ini akan bentrok kalau dua tablet
    // sungguhan memakainya bersamaan.
    lastPairedAt: timestamp("last_paired_at", { withTimezone: true }),
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
    // Gap dari T06 (sebelum kelalaian yang sama ditemukan di T08 dan
    // diperbaiki untuk tabel katalog) -- devices.last_seq (counter nomor
    // struk) wajib bisa di-UPDATE saat T13 generate nomor struk.
    pgPolicy("devices_update", {
      for: "update",
      using: sql`${t.businessId} = any(auth_business_ids())`,
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

// TT01, 10 September 2026 -- reuse `categories` untuk thrifting (Pakaian,
// Sepatu, dst) butuh pembeda supaya tidak tercampur dengan kategori F&B
// (Kopi, Makanan) di mana pun daftar ini ditampilkan/difilter. `default
// "fnb"` membuat penambahan kolom ini aman untuk baris yang sudah ada --
// tidak perlu backfill manual.
export const categoryScopeEnum = pgEnum("category_scope", ["fnb", "thrifting"]);

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
    scope: categoryScopeEnum("scope").notNull().default("fnb"),
    // Master data tidak pernah dihapus, cuma dinonaktifkan (CLAUDE.md §3.2)
    // -- kategori nonaktif tidak muncul sebagai chip filter di layar kasir.
    isActive: boolean("is_active").notNull().default(true),
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
    pgPolicy("categories_update", {
      for: "update",
      using: sql`${t.businessId} = any(auth_business_ids())`,
      withCheck: sql`${t.businessId} = any(auth_business_ids())`,
    }),
    // Delete cuma untuk kategori yang belum pernah dipakai (dicek eksplisit
    // di server sebelum delete, bukan cuma di sini -- CLAUDE.md §3.4). RLS
    // ini cuma menegakkan tenancy, sama seperti policy lain di tabel ini.
    pgPolicy("categories_delete", {
      for: "delete",
      using: sql`${t.businessId} = any(auth_business_ids())`,
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
    // Nullable -- CUMA label/pengelompokan laporan per brand (§8.a/§8.b),
    // TIDAK menentukan ketersediaan di katalog kasir. Lihat product_outlets
    // untuk itu. NULL = tidak dilabeli brand tertentu (boleh, bukan error).
    brandId: uuid("brand_id").references(() => brands.id),
    sku: text("sku"),
    barcode: text("barcode"),
    name: text("name").notNull(),
    description: text("description"),
    // Path relatif di bucket Storage 'products' ({business_id}/{id}.jpg),
    // BUKAN URL siap-pakai -- bucket privat, selalu di-resolve ke signed
    // URL saat dibaca (T09c). Lihat lib/products/image.ts#getProductImagePath.
    imagePath: text("image_path"),
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
    pgPolicy("products_update", {
      for: "update",
      using: sql`${t.businessId} = any(auth_business_ids())`,
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
    pgPolicy("product_variants_update", {
      for: "update",
      using: sql`exists (
        select 1 from products p
        where p.id = ${t.productId}
          and p.business_id = any(auth_business_ids())
      )`,
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
    // Master data tidak pernah dihapus, cuma dinonaktifkan (CLAUDE.md §3.2)
    // -- tier nonaktif tetap tersimpan (bisa diaktifkan lagi kalau nanti
    // dipakai lagi, mis. mulai jualan GoFood) tapi tidak muncul di selector
    // kasir. Default true supaya tier lama (sebelum kolom ini ada) tidak
    // diam-diam hilang dari POS setelah migration.
    isActive: boolean("is_active").notNull().default(true),
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
    pgPolicy("price_tiers_update", {
      for: "update",
      using: sql`${t.businessId} = any(auth_business_ids())`,
      withCheck: sql`${t.businessId} = any(auth_business_ids())`,
    }),
    // Delete cuma untuk tier yang belum pernah dipakai (dicek eksplisit di
    // server sebelum delete -- CLAUDE.md §3.4). RLS ini cuma tenancy.
    pgPolicy("price_tiers_delete", {
      for: "delete",
      using: sql`${t.businessId} = any(auth_business_ids())`,
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
    pgPolicy("product_prices_update", {
      for: "update",
      using: sql`exists (
        select 1 from products p
        where p.id = ${t.productId}
          and p.business_id = any(auth_business_ids())
      )`,
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
    // Master data tidak pernah dihapus, cuma dinonaktifkan (CLAUDE.md §3.2)
    // -- grup nonaktif tidak lagi ditawarkan di dialog pilih modifier kasir.
    isActive: boolean("is_active").notNull().default(true),
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
    pgPolicy("modifier_groups_update", {
      for: "update",
      using: sql`${t.businessId} = any(auth_business_ids())`,
      withCheck: sql`${t.businessId} = any(auth_business_ids())`,
    }),
    // Delete cuma untuk grup yang belum pernah dipakai (dicek eksplisit di
    // server sebelum delete -- CLAUDE.md §3.4). RLS ini cuma tenancy.
    pgPolicy("modifier_groups_delete", {
      for: "delete",
      using: sql`${t.businessId} = any(auth_business_ids())`,
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
    // Master data tidak pernah dihapus, cuma dinonaktifkan (CLAUDE.md §3.2)
    // -- modifier nonaktif tidak lagi ditawarkan di dialog pilih modifier kasir.
    isActive: boolean("is_active").notNull().default(true),
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
    pgPolicy("modifiers_update", {
      for: "update",
      using: sql`exists (
        select 1 from modifier_groups mg
        where mg.id = ${t.modifierGroupId}
          and mg.business_id = any(auth_business_ids())
      )`,
      withCheck: sql`exists (
        select 1 from modifier_groups mg
        where mg.id = ${t.modifierGroupId}
          and mg.business_id = any(auth_business_ids())
      )`,
    }),
    // Delete cuma untuk modifier yang belum pernah dipakai (dicek eksplisit
    // di server sebelum delete -- CLAUDE.md §3.4). RLS ini cuma tenancy.
    pgPolicy("modifiers_delete", {
      for: "delete",
      using: sql`exists (
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
    // DELETE dibutuhkan (bukan cuma select/insert): form produk melepas
    // modifier group lewat toggle multi-select, artinya baris relasi ini
    // benar-benar dihapus saat di-uncheck -- beda dari tabel snapshot/log
    // append-only di CLAUDE.md §3.2, karena baris ini cuma representasi
    // relasi "aktif sekarang", bukan riwayat transaksi.
    pgPolicy("product_modifier_groups_delete", {
      for: "delete",
      using: sql`exists (
        select 1 from products p
        where p.id = ${t.productId}
          and p.business_id = any(auth_business_ids())
      )`,
    }),
  ]
).enableRLS();

// T22a -- SATU-SATUNYA yang menentukan ketersediaan produk per outlet
// (docs/05-RENCANA-FASE-2.md §8.b, KOREKSI dari rencana brand_id semula).
// Aturan baca: produk TANPA baris sama sekali di sini = tersedia di SEMUA
// outlet (default terbuka, mayoritas menu). Produk yang PUNYA baris di
// sini = HANYA tersedia di outlet-outlet yang punya barisnya (whitelist).
// Ini menghindari perlu mengisi ratusan baris untuk kasus umum, sambil
// tetap presisi untuk pengecualian (menu Indokopi yang sengaja dijual di
// outlet Indosteak tertentu, snack yang beririsan sebagian).
export const productOutlets = pgTable(
  "product_outlets",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.outletId] }),
    pgPolicy("product_outlets_select", {
      for: "select",
      using: sql`exists (
        select 1 from products p
        where p.id = ${t.productId}
          and p.business_id = any(auth_business_ids())
      )`,
    }),
    pgPolicy("product_outlets_insert", {
      for: "insert",
      withCheck: sql`exists (
        select 1 from products p
        where p.id = ${t.productId}
          and p.business_id = any(auth_business_ids())
      )`,
    }),
    // DELETE dibutuhkan -- form produk melepas outlet lewat toggle
    // multi-select, baris ini representasi "tersedia sekarang", bukan
    // riwayat transaksi (sama alasan product_modifier_groups_delete).
    pgPolicy("product_outlets_delete", {
      for: "delete",
      using: sql`exists (
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

/**
 * Skema order & shift — BLUEPRINT §3.4 (M03/M04), T11.
 *
 * `orders`, `shifts`, dan `payment_methods` punya business_id langsung
 * (sesuai BLUEPRINT). Tabel lain di bagian ini anak dari salah satu di
 * antaranya (atau dari outlets) -- policy RLS-nya lewat EXISTS join ke
 * induk, pola yang sama seperti T07/T08 (docs/04-CATATAN-TEKNIS.md §7).
 * `order_item_modifiers` dan `refund_items` dua level lebih dalam
 * (order_item -> order -> business, refund -> order -> business), jadi
 * EXISTS-nya join dua tabel sekaligus untuk sampai ke business_id.
 *
 * Order TIDAK PERNAH dihapus, hanya berubah status (CLAUDE.md §3.2) --
 * karena itu tidak ada policy DELETE di tabel mana pun pada bagian ini.
 */

export const areas = pgTable(
  "areas",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id, { onDelete: "cascade" }),
    name: text("name").notNull(), // 'Indoor', 'Outdoor', 'Lantai 2'
  },
  (t) => [
    pgPolicy("areas_select", {
      for: "select",
      using: sql`exists (
        select 1 from outlets o
        where o.id = ${t.outletId}
          and o.business_id = any(auth_business_ids())
      )`,
    }),
    pgPolicy("areas_insert", {
      for: "insert",
      withCheck: sql`exists (
        select 1 from outlets o
        where o.id = ${t.outletId}
          and o.business_id = any(auth_business_ids())
      )`,
    }),
    pgPolicy("areas_update", {
      for: "update",
      using: sql`exists (
        select 1 from outlets o
        where o.id = ${t.outletId}
          and o.business_id = any(auth_business_ids())
      )`,
      withCheck: sql`exists (
        select 1 from outlets o
        where o.id = ${t.outletId}
          and o.business_id = any(auth_business_ids())
      )`,
    }),
  ]
).enableRLS();

export const tables = pgTable(
  "tables",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id, { onDelete: "cascade" }),
    areaId: uuid("area_id").references(() => areas.id),
    name: text("name").notNull(), // 'T1', 'VIP-2'
    capacity: integer("capacity").notNull().default(4),
    status: text("status").notNull().default("available"), // available|occupied|reserved|dirty
    posX: integer("pos_x"),
    posY: integer("pos_y"),
  },
  (t) => [
    pgPolicy("tables_select", {
      for: "select",
      using: sql`exists (
        select 1 from outlets o
        where o.id = ${t.outletId}
          and o.business_id = any(auth_business_ids())
      )`,
    }),
    pgPolicy("tables_insert", {
      for: "insert",
      withCheck: sql`exists (
        select 1 from outlets o
        where o.id = ${t.outletId}
          and o.business_id = any(auth_business_ids())
      )`,
    }),
    pgPolicy("tables_update", {
      for: "update",
      using: sql`exists (
        select 1 from outlets o
        where o.id = ${t.outletId}
          and o.business_id = any(auth_business_ids())
      )`,
      withCheck: sql`exists (
        select 1 from outlets o
        where o.id = ${t.outletId}
          and o.business_id = any(auth_business_ids())
      )`,
    }),
  ]
).enableRLS();

export const shiftStatusEnum = pgEnum("shift_status", [
  "open",
  "closed",
  "reconciled",
]);

export const shifts = pgTable(
  "shifts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    deviceId: uuid("device_id").references(() => devices.id),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    status: shiftStatusEnum("status").notNull().default("open"),
    openedAt: timestamp("opened_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    businessDate: date("business_date").notNull(),
    openingCash: numeric("opening_cash", { precision: 16, scale: 2 })
      .notNull()
      .default("0"),
    // Diisi kasir SEBELUM melihat angka sistem (anti-fraud, meniru
    // Kasirini) -- lihat docs/03-CALC-SPEC.md bagian shift.
    countedCash: numeric("counted_cash", { precision: 16, scale: 2 }),
    expectedCash: numeric("expected_cash", { precision: 16, scale: 2 }),
    cashVariance: numeric("cash_variance", { precision: 16, scale: 2 }),
    // Akun tamu bersama (TT09b) -- WAJIB diisi di openShiftWithDb() kalau
    // employees.isSharedAccount milik shift ini true, NULL selamanya untuk
    // shift yang dibuka karyawan bernama biasa. Tempat yang menampilkan
    // "siapa bertugas" (dashboard, getSalesByCashier, struk) mengutamakan
    // nilai ini dibanding employees.fullName kalau terisi -- supaya laporan
    // malam menyebut nama sungguhan pelayan, bukan literal nama akun tamu.
    servedByName: text("served_by_name"),
    note: text("note"),
  },
  (t) => [
    pgPolicy("shifts_select", {
      for: "select",
      using: sql`${t.businessId} = any(auth_business_ids())`,
    }),
    pgPolicy("shifts_insert", {
      for: "insert",
      withCheck: sql`${t.businessId} = any(auth_business_ids())`,
    }),
    pgPolicy("shifts_update", {
      for: "update",
      using: sql`${t.businessId} = any(auth_business_ids())`,
      withCheck: sql`${t.businessId} = any(auth_business_ids())`,
    }),
  ]
).enableRLS();

export const cashMovements = pgTable(
  "cash_movements",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    shiftId: uuid("shift_id")
      .notNull()
      .references(() => shifts.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // 'cash_in' | 'cash_out'
    amount: numeric("amount", { precision: 16, scale: 2 }).notNull(),
    reason: text("reason").notNull(), // 'setor bank', 'beli galon', 'kembalian modal'
    expenseId: uuid("expense_id"), // link ke expenses -- tabel belum ada (Fase 3)
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    pgPolicy("cash_movements_select", {
      for: "select",
      using: sql`exists (
        select 1 from shifts s
        where s.id = ${t.shiftId}
          and s.business_id = any(auth_business_ids())
      )`,
    }),
    pgPolicy("cash_movements_insert", {
      for: "insert",
      withCheck: sql`exists (
        select 1 from shifts s
        where s.id = ${t.shiftId}
          and s.business_id = any(auth_business_ids())
      )`,
    }),
    pgPolicy("cash_movements_update", {
      for: "update",
      using: sql`exists (
        select 1 from shifts s
        where s.id = ${t.shiftId}
          and s.business_id = any(auth_business_ids())
      )`,
      withCheck: sql`exists (
        select 1 from shifts s
        where s.id = ${t.shiftId}
          and s.business_id = any(auth_business_ids())
      )`,
    }),
  ]
).enableRLS();

export const orderStatusEnum = pgEnum("order_status", [
  "draft",
  "open",
  "in_kitchen",
  "served",
  "paid",
  "void",
  "refunded",
]);

export const orderChannelEnum = pgEnum("order_channel", [
  "dine_in",
  "takeaway",
  "delivery",
  "gofood",
  "grabfood",
  "shopeefood",
  "online_store",
  "reservation",
  // Thrifting (TT06, 10 September 2026) -- jual barang titipan walk-in,
  // bukan salah satu channel F&B di atas. Tanpa ini transaksi thrifting
  // akan salah tercatat 'dine_in' (default lama), mencemari laporan
  // getSalesByChannel dengan angka dine_in yang sebetulnya bukan makan di
  // tempat.
  "retail",
]);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    shiftId: uuid("shift_id").references(() => shifts.id),
    deviceId: uuid("device_id").references(() => devices.id),
    number: text("number").notNull(), // 'PST-250812-0001'
    status: orderStatusEnum("status").notNull().default("draft"),
    channel: orderChannelEnum("channel").notNull().default("dine_in"),
    priceTierId: uuid("price_tier_id").references(() => priceTiers.id),
    tableId: uuid("table_id").references(() => tables.id),
    customerId: uuid("customer_id"), // link ke customers -- tabel belum ada (Fase 2/3)
    guestCount: integer("guest_count").notNull().default(1),
    waiterId: uuid("waiter_id").references(() => employees.id),
    cashierId: uuid("cashier_id").references(() => employees.id),

    // Kolom kalkulasi -- lihat docs/03-CALC-SPEC.md bagian A untuk urutan
    // rumusnya. Semua numeric, tidak pernah dihitung ulang di UI.
    subtotal: numeric("subtotal", { precision: 16, scale: 2 })
      .notNull()
      .default("0"), // sebelum diskon, sesudah modifier
    itemDiscount: numeric("item_discount", { precision: 16, scale: 2 })
      .notNull()
      .default("0"),
    orderDiscount: numeric("order_discount", { precision: 16, scale: 2 })
      .notNull()
      .default("0"),
    discountTotal: numeric("discount_total", { precision: 16, scale: 2 })
      .notNull()
      .default("0"),
    netSales: numeric("net_sales", { precision: 16, scale: 2 })
      .notNull()
      .default("0"), // subtotal - discount_total
    serviceCharge: numeric("service_charge", { precision: 16, scale: 2 })
      .notNull()
      .default("0"),
    taxAmount: numeric("tax_amount", { precision: 16, scale: 2 })
      .notNull()
      .default("0"),
    rounding: numeric("rounding", { precision: 16, scale: 2 })
      .notNull()
      .default("0"),
    total: numeric("total", { precision: 16, scale: 2 }).notNull().default("0"),
    cogsTotal: numeric("cogs_total", { precision: 20, scale: 2 })
      .notNull()
      .default("0"), // SNAPSHOT HPP saat bayar
    grossProfit: numeric("gross_profit", { precision: 20, scale: 2 })
      .notNull()
      .default("0"), // net_sales - cogs_total

    // Untuk channel marketplace (GoFood, GrabFood, dst.)
    commissionPercent: numeric("commission_percent", { precision: 7, scale: 4 })
      .notNull()
      .default("0"),
    commissionAmount: numeric("commission_amount", { precision: 16, scale: 2 })
      .notNull()
      .default("0"),
    externalRef: text("external_ref"), // order id GoFood

    businessDate: date("business_date").notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    voidReason: text("void_reason"),
    note: text("note"),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique().on(t.businessId, t.number),
    index("orders_outlet_business_date_idx").on(t.outletId, t.businessDate),
    index("orders_active_status_idx")
      .on(t.status)
      .where(sql`${t.status} in ('draft', 'open', 'in_kitchen')`),
    pgPolicy("orders_select", {
      for: "select",
      using: sql`${t.businessId} = any(auth_business_ids())`,
    }),
    pgPolicy("orders_insert", {
      for: "insert",
      withCheck: sql`${t.businessId} = any(auth_business_ids())`,
    }),
    pgPolicy("orders_update", {
      for: "update",
      using: sql`${t.businessId} = any(auth_business_ids())`,
      withCheck: sql`${t.businessId} = any(auth_business_ids())`,
    }),
  ]
).enableRLS();

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id),
    variantId: uuid("variant_id").references(() => productVariants.id),
    // Thrifting (TT02, 10 September 2026) -- NULL untuk semua baris F&B,
    // tidak mengubah perilaku channel yang sudah ada sama sekali. Barang
    // dijamin siap_jual->terjual atomik oleh trigger claim_barang_for_sale
    // (lihat migration). pemilikBagiPercentAtSale/pemilikShareAmount/
    // tokoShareAmount SNAPSHOT saat transaksi (sama prinsip productName di
    // bawah) -- kalau pemilik.persenBagi diubah bulan depan, transaksi bulan
    // ini tidak ikut berubah.
    barangId: uuid("barang_id").references(() => barang.id),
    pemilikId: uuid("pemilik_id").references(() => pemilik.id),
    pemilikBagiPercentAtSale: numeric("pemilik_bagi_percent_at_sale", { precision: 5, scale: 2 }),
    pemilikShareAmount: numeric("pemilik_share_amount", { precision: 16, scale: 2 }),
    tokoShareAmount: numeric("toko_share_amount", { precision: 16, scale: 2 }),
    // SNAPSHOT -- jangan join ke products untuk laporan historis
    // (CLAUDE.md §3.2). Nilai-nilai ini tidak boleh berubah walau produk
    // aslinya diedit/nonaktif setelah transaksi ini terjadi.
    productName: text("product_name").notNull(),
    variantName: text("variant_name"),
    categoryName: text("category_name"),
    qty: numeric("qty", { precision: 16, scale: 4 }).notNull(),
    unitPrice: numeric("unit_price", { precision: 16, scale: 2 }).notNull(),
    modifierTotal: numeric("modifier_total", { precision: 16, scale: 2 })
      .notNull()
      .default("0"),
    grossAmount: numeric("gross_amount", { precision: 16, scale: 2 }).notNull(), // qty * (unit_price + modifier_total)
    discountAmount: numeric("discount_amount", { precision: 16, scale: 2 })
      .notNull()
      .default("0"),
    allocatedOrderDiscount: numeric("allocated_order_discount", {
      precision: 16,
      scale: 2,
    })
      .notNull()
      .default("0"), // alokasi proporsional dari order_discount
    netAmount: numeric("net_amount", { precision: 16, scale: 2 }).notNull(),
    unitCogs: numeric("unit_cogs", { precision: 20, scale: 8 })
      .notNull()
      .default("0"), // HPP per unit saat transaksi
    cogsAmount: numeric("cogs_amount", { precision: 20, scale: 2 })
      .notNull()
      .default("0"),
    prepStation: text("prep_station"),
    kitchenStatus: text("kitchen_status").notNull().default("pending"), // pending|cooking|ready|served
    isVoided: boolean("is_voided").notNull().default(false),
    voidReason: text("void_reason"),
    note: text("note"), // 'tanpa bawang'
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    pgPolicy("order_items_select", {
      for: "select",
      using: sql`exists (
        select 1 from orders o
        where o.id = ${t.orderId}
          and o.business_id = any(auth_business_ids())
      )`,
    }),
    pgPolicy("order_items_insert", {
      for: "insert",
      withCheck: sql`exists (
        select 1 from orders o
        where o.id = ${t.orderId}
          and o.business_id = any(auth_business_ids())
      )`,
    }),
    pgPolicy("order_items_update", {
      for: "update",
      using: sql`exists (
        select 1 from orders o
        where o.id = ${t.orderId}
          and o.business_id = any(auth_business_ids())
      )`,
      withCheck: sql`exists (
        select 1 from orders o
        where o.id = ${t.orderId}
          and o.business_id = any(auth_business_ids())
      )`,
    }),
  ]
).enableRLS();

export const orderItemModifiers = pgTable(
  "order_item_modifiers",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    orderItemId: uuid("order_item_id")
      .notNull()
      .references(() => orderItems.id, { onDelete: "cascade" }),
    modifierId: uuid("modifier_id").references(() => modifiers.id),
    modifierName: text("modifier_name").notNull(), // SNAPSHOT, sama alasannya dengan order_items
    price: numeric("price", { precision: 16, scale: 2 }).notNull().default("0"),
    qty: numeric("qty", { precision: 16, scale: 4 }).notNull().default("1"),
    unitCogs: numeric("unit_cogs", { precision: 20, scale: 8 })
      .notNull()
      .default("0"),
  },
  (t) => [
    // Dua level: order_item_modifiers -> order_items -> orders. Pola sama
    // seperti EXISTS satu level (docs/04-CATATAN-TEKNIS.md §7), cuma join
    // tabel tambahan di tengah untuk sampai ke business_id.
    pgPolicy("order_item_modifiers_select", {
      for: "select",
      using: sql`exists (
        select 1 from order_items oi
        join orders o on o.id = oi.order_id
        where oi.id = ${t.orderItemId}
          and o.business_id = any(auth_business_ids())
      )`,
    }),
    pgPolicy("order_item_modifiers_insert", {
      for: "insert",
      withCheck: sql`exists (
        select 1 from order_items oi
        join orders o on o.id = oi.order_id
        where oi.id = ${t.orderItemId}
          and o.business_id = any(auth_business_ids())
      )`,
    }),
    pgPolicy("order_item_modifiers_update", {
      for: "update",
      using: sql`exists (
        select 1 from order_items oi
        join orders o on o.id = oi.order_id
        where oi.id = ${t.orderItemId}
          and o.business_id = any(auth_business_ids())
      )`,
      withCheck: sql`exists (
        select 1 from order_items oi
        join orders o on o.id = oi.order_id
        where oi.id = ${t.orderItemId}
          and o.business_id = any(auth_business_ids())
      )`,
    }),
  ]
).enableRLS();

export const paymentMethods = pgTable(
  "payment_methods",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    code: text("code").notNull(), // 'CASH','QRIS','DEBIT_BCA','GOPAY'
    name: text("name").notNull(), // nama yang tercetak di struk (custom, ala Kasirini)
    type: text("type").notNull(), // cash|card|ewallet|qris|transfer|voucher|credit
    mdrPercent: numeric("mdr_percent", { precision: 7, scale: 4 })
      .notNull()
      .default("0"), // biaya EDC/QRIS, mis. 0.7
    isCashDrawer: boolean("is_cash_drawer").notNull().default(false),
    requiresRef: boolean("requires_ref").notNull().default(false), // butuh nomor approval
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    unique().on(t.businessId, t.code),
    pgPolicy("payment_methods_select", {
      for: "select",
      using: sql`${t.businessId} = any(auth_business_ids())`,
    }),
    pgPolicy("payment_methods_insert", {
      for: "insert",
      withCheck: sql`${t.businessId} = any(auth_business_ids())`,
    }),
    pgPolicy("payment_methods_update", {
      for: "update",
      using: sql`${t.businessId} = any(auth_business_ids())`,
      withCheck: sql`${t.businessId} = any(auth_business_ids())`,
    }),
    // Delete cuma untuk metode yang belum pernah dipakai (dicek eksplisit
    // di server sebelum delete -- CLAUDE.md §3.4). RLS ini cuma tenancy.
    pgPolicy("payment_methods_delete", {
      for: "delete",
      using: sql`${t.businessId} = any(auth_business_ids())`,
    }),
  ]
).enableRLS();

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    paymentMethodId: uuid("payment_method_id")
      .notNull()
      .references(() => paymentMethods.id),
    methodName: text("method_name").notNull(),
    amount: numeric("amount", { precision: 16, scale: 2 }).notNull(),
    receivedAmount: numeric("received_amount", { precision: 16, scale: 2 }), // uang diterima (tunai)
    changeAmount: numeric("change_amount", { precision: 16, scale: 2 })
      .notNull()
      .default("0"),
    mdrAmount: numeric("mdr_amount", { precision: 16, scale: 2 })
      .notNull()
      .default("0"),
    reference: text("reference"),
    status: text("status").notNull().default("success"),
    paidAt: timestamp("paid_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    pgPolicy("payments_select", {
      for: "select",
      using: sql`exists (
        select 1 from orders o
        where o.id = ${t.orderId}
          and o.business_id = any(auth_business_ids())
      )`,
    }),
    pgPolicy("payments_insert", {
      for: "insert",
      withCheck: sql`exists (
        select 1 from orders o
        where o.id = ${t.orderId}
          and o.business_id = any(auth_business_ids())
      )`,
    }),
    pgPolicy("payments_update", {
      for: "update",
      using: sql`exists (
        select 1 from orders o
        where o.id = ${t.orderId}
          and o.business_id = any(auth_business_ids())
      )`,
      withCheck: sql`exists (
        select 1 from orders o
        where o.id = ${t.orderId}
          and o.business_id = any(auth_business_ids())
      )`,
    }),
  ]
).enableRLS();

export const refunds = pgTable(
  "refunds",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    amount: numeric("amount", { precision: 16, scale: 2 }).notNull(),
    restock: boolean("restock").notNull().default(false),
    reason: text("reason").notNull(),
    approvedBy: uuid("approved_by").references(() => employees.id),
    businessDate: date("business_date").notNull(),
    // T16: metode pengembalian dana dipilih kasir, TIDAK di-hardcode
    // tunai -- penting terutama untuk outlet cashless (T15 lanjutan).
    paymentMethodId: uuid("payment_method_id")
      .notNull()
      .references(() => paymentMethods.id),
    reference: text("reference"), // nomor referensi non-tunai, pola sama seperti payments.reference (T13)
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    pgPolicy("refunds_select", {
      for: "select",
      using: sql`exists (
        select 1 from orders o
        where o.id = ${t.orderId}
          and o.business_id = any(auth_business_ids())
      )`,
    }),
    pgPolicy("refunds_insert", {
      for: "insert",
      withCheck: sql`exists (
        select 1 from orders o
        where o.id = ${t.orderId}
          and o.business_id = any(auth_business_ids())
      )`,
    }),
    pgPolicy("refunds_update", {
      for: "update",
      using: sql`exists (
        select 1 from orders o
        where o.id = ${t.orderId}
          and o.business_id = any(auth_business_ids())
      )`,
      withCheck: sql`exists (
        select 1 from orders o
        where o.id = ${t.orderId}
          and o.business_id = any(auth_business_ids())
      )`,
    }),
  ]
).enableRLS();

export const refundItems = pgTable(
  "refund_items",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    refundId: uuid("refund_id")
      .notNull()
      .references(() => refunds.id, { onDelete: "cascade" }),
    orderItemId: uuid("order_item_id")
      .notNull()
      .references(() => orderItems.id),
    qty: numeric("qty", { precision: 16, scale: 4 }).notNull(),
    amount: numeric("amount", { precision: 16, scale: 2 }).notNull(),
  },
  (t) => [
    // Dua level: refund_items -> refunds -> orders (sama seperti
    // order_item_modifiers di atas).
    pgPolicy("refund_items_select", {
      for: "select",
      using: sql`exists (
        select 1 from refunds r
        join orders o on o.id = r.order_id
        where r.id = ${t.refundId}
          and o.business_id = any(auth_business_ids())
      )`,
    }),
    pgPolicy("refund_items_insert", {
      for: "insert",
      withCheck: sql`exists (
        select 1 from refunds r
        join orders o on o.id = r.order_id
        where r.id = ${t.refundId}
          and o.business_id = any(auth_business_ids())
      )`,
    }),
    pgPolicy("refund_items_update", {
      for: "update",
      using: sql`exists (
        select 1 from refunds r
        join orders o on o.id = r.order_id
        where r.id = ${t.refundId}
          and o.business_id = any(auth_business_ids())
      )`,
      withCheck: sql`exists (
        select 1 from refunds r
        join orders o on o.id = r.order_id
        where r.id = ${t.refundId}
          and o.business_id = any(auth_business_ids())
      )`,
    }),
  ]
).enableRLS();

/**
 * Audit log generik (T16) -- append-only, dipakai pertama kali untuk
 * void/refund, tapi disengaja generik (action/ref_type teks bebas, bukan
 * enum) supaya modul-modul berikutnya bisa catat ke sini juga tanpa
 * migration baru tiap kali ada jenis aksi baru.
 *
 * employeeId nullable: void/refund dilakukan dari sesi Supabase Auth
 * (owner/manajer di /pos/receipt), bukan sesi PIN kasir seperti shift --
 * tidak ada jaminan user itu punya baris employees. Diisi best-effort
 * lewat employees.user_id kalau ketemu, kalau tidak tetap null (lihat
 * lib/pos/void-refund.ts#resolveEmployeeIdForUser).
 *
 * TIDAK ADA policy UPDATE/DELETE di bawah -- itu yang membuatnya
 * append-only (tanpa policy, operasi itu ditolak untuk role
 * authenticated). FORCE ROW LEVEL SECURITY ditambahkan manual ke
 * migration hasil generate (Drizzle tidak punya builder untuk itu, lihat
 * pola yang sama di migration 0001/0003/0005).
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    outletId: uuid("outlet_id").references(() => outlets.id),
    employeeId: uuid("employee_id").references(() => employees.id),
    action: text("action").notNull(), // 'void' | 'refund' | ... (teks bebas, lihat komentar di atas)
    refType: text("ref_type").notNull(), // 'order' | 'refund' | ...
    refId: uuid("ref_id").notNull(),
    reason: text("reason"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    pgPolicy("audit_logs_select", {
      for: "select",
      using: sql`${t.businessId} = any(auth_business_ids())`,
    }),
    pgPolicy("audit_logs_insert", {
      for: "insert",
      withCheck: sql`${t.businessId} = any(auth_business_ids())`,
    }),
  ]
).enableRLS();

// ---------------------------------------------------------------------------
// BLUEPRINT §3.3 — M05 Inventory, Resep & HPP (fondasi T21)
// ---------------------------------------------------------------------------

/**
 * Satuan & konversi — BLUEPRINT §3.3 "units".
 * Semua stok disimpan dalam base_unit (g, ml, pcs). Konversi hanya di
 * layer tampilan/input. factor = berapa base_unit dalam 1 unit ini
 * (1 kg = 1000 g → factor 1000).
 */
export const units = pgTable(
  "units",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    code: text("code").notNull(), // 'kg','g','l','ml','pcs','pack','botol'
    name: text("name").notNull(),
    baseUnit: text("base_unit").notNull(), // satuan dasar: 'g','ml','pcs'
    factor: numeric("factor", { precision: 20, scale: 8 }).notNull(), // 1 kg = 1000 g → factor 1000
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique().on(t.businessId, t.code),
    pgPolicy("units_select", {
      for: "select",
      using: sql`${t.businessId} = any(auth_business_ids())`,
    }),
    pgPolicy("units_insert", {
      for: "insert",
      withCheck: sql`${t.businessId} = any(auth_business_ids())`,
    }),
    pgPolicy("units_update", {
      for: "update",
      using: sql`${t.businessId} = any(auth_business_ids())`,
    }),
    pgPolicy("units_delete", {
      for: "delete",
      using: sql`${t.businessId} = any(auth_business_ids())`,
    }),
  ]
).enableRLS();

/**
 * Master bahan baku — BLUEPRINT §3.3 "ingredients".
 * category = teks bebas ('Bahan Kering','Dairy','Kemasan') bukan FK,
 * sesuai BLUEPRINT. Bisa ditingkatkan ke tabel terpisah nanti.
 */
export const ingredients = pgTable(
  "ingredients",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    code: text("code"),
    name: text("name").notNull(), // 'Biji Kopi Arabika', 'Susu UHT'
    category: text("category"), // 'Bahan Kering','Dairy','Kemasan'
    baseUnit: text("base_unit").notNull(), // 'g','ml','pcs'
    purchaseUnit: text("purchase_unit").notNull(), // 'kg','l','dus'
    purchaseFactor: numeric("purchase_factor", { precision: 20, scale: 8 })
      .notNull(), // 1 dus = 24 pcs → 24
    yieldPercent: numeric("yield_percent", { precision: 7, scale: 4 })
      .notNull()
      .default("100"), // 1 kg ayam → 800 g siap saji → 80
    isSemiFinished: boolean("is_semi_finished").notNull().default(false),
    shelfLifeDays: integer("shelf_life_days"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique().on(t.businessId, t.code),
    pgPolicy("ingredients_select", {
      for: "select",
      using: sql`${t.businessId} = any(auth_business_ids())`,
    }),
    pgPolicy("ingredients_insert", {
      for: "insert",
      withCheck: sql`${t.businessId} = any(auth_business_ids())`,
    }),
    pgPolicy("ingredients_update", {
      for: "update",
      using: sql`${t.businessId} = any(auth_business_ids())`,
    }),
    // Ditambah setelah ditemukan lewat verifikasi UI manual (bukan test --
    // test lib/ingredients/__tests__/manage.test.ts lolos tanpa policy ini
    // karena getAdminDb() BYPASSRLS): tanpa policy delete, deleteIngredientWithDb
    // lewat getUserDb() (jalur produksi sungguhan) diam-diam menghapus 0 baris,
    // tidak ada error sama sekali -- persis pola "policy hilang, bukan bocor",
    // sama seperti alasan migration 0016 menambah delete policy untuk 5
    // entitas lain. Tenancy-only, sama seperti policy lain di tabel ini --
    // aturan "cuma boleh kalau belum dipakai" tetap di application layer
    // (lib/ingredients/manage.ts), RLS di sini cuma lapisan terakhir (CLAUDE.md §3.4).
    pgPolicy("ingredients_delete", {
      for: "delete",
      using: sql`${t.businessId} = any(auth_business_ids())`,
    }),
  ]
).enableRLS();

/**
 * Level stok per outlet + WAC — BLUEPRINT §3.3 "stock_levels".
 * Composite PK (ingredient_id, outlet_id). Tidak pernah DELETE langsung,
 * hanya di-update oleh stock-ledger.ts saat ada movement.
 *
 * business_id didenormalisasi ke sini (bukan cuma lewat outlet_id) supaya
 * RLS bisa memeriksanya langsung tanpa subquery, DAN supaya ada kolom
 * eksplisit untuk trigger di bawah memvalidasi ingredient_id & outlet_id
 * sungguh-sungguh milik business_id yang sama (lihat CHECK trigger
 * `check_ingredient_outlet_business_id` di migration 0017 — tidak bisa
 * diekspresikan di schema.ts, CLAUDE.md §3.6). Tanpa ini, satu baris bisa
 * memasangkan ingredient bisnis A dengan outlet bisnis B untuk user yang
 * kebetulan anggota keduanya — RLS lama (subquery via outlet saja) tidak
 * menangkap itu. Ditemukan saat review migration T21.
 */
export const stockLevels = pgTable(
  "stock_levels",
  {
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id, { onDelete: "cascade" }),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id, { onDelete: "cascade" }),
    qtyOnHand: numeric("qty_on_hand", { precision: 16, scale: 4 })
      .notNull()
      .default("0"), // dalam base_unit
    avgCost: numeric("avg_cost", { precision: 20, scale: 8 })
      .notNull()
      .default("0"), // WAC per base_unit
    minStock: numeric("min_stock", { precision: 16, scale: 4 })
      .notNull()
      .default("0"), // trigger alert
    maxStock: numeric("max_stock", { precision: 16, scale: 4 }),
    lastCountedAt: timestamp("last_counted_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.ingredientId, t.outletId] }),
    pgPolicy("stock_levels_select", {
      for: "select",
      using: sql`${t.businessId} = any(auth_business_ids())`,
    }),
    pgPolicy("stock_levels_insert", {
      for: "insert",
      withCheck: sql`${t.businessId} = any(auth_business_ids())`,
    }),
    pgPolicy("stock_levels_update", {
      for: "update",
      using: sql`${t.businessId} = any(auth_business_ids())`,
    }),
  ]
).enableRLS();

/**
 * Tipe pergerakan stok — BLUEPRINT §3.3 "movement_type".
 * Append-only: movement TIDAK PERNAH di-update/delete (CLAUDE.md §3.2).
 */
export const movementTypeEnum = pgEnum("movement_type", [
  "purchase",
  "sale",
  "waste",
  "opname_adjust",
  "transfer_in",
  "transfer_out",
  "production_in",
  "production_out",
  "refund_in",
  "initial",
  "manual_adjust",
  // T22 -- SENGAJA bukan 'transfer_out' meski secara sekilas mirip:
  // transfer_out berarti stok sungguh berpindah ke outlet lain. Ini
  // membalik entri penerimaan yang salah -- tidak ada perpindahan fisik
  // apa pun. Kalau dipaksa pakai transfer_out, laporan volume transfer
  // antar-outlet nanti (kalau dibangun) akan tercemar oleh koreksi yang
  // bukan transfer sungguhan.
  "transfer_cancel",
  // T22 -- selisih sent_qty vs received_qty (docs/05-RENCANA-FASE-2.md
  // §8.h). PENTING: movement ini TIDAK PERNAH mengurangi
  // stock_levels.qty_on_hand siapa pun -- transfer_in (sebesar
  // received_qty) SUDAH mencatat saldo outlet dengan tepat sendirian;
  // transfer_loss cuma catatan NILAI RUGI untuk laporan "selisih
  // pengiriman per pengirim/periode". Kalau suatu saat kelihatan
  // "aneh" karena tidak mengubah saldo seperti movement lain, itu
  // DISENGAJA -- baca docs/04-CATATAN-TEKNIS.md sebelum "memperbaikinya".
  "transfer_loss",
]);

/**
 * Ledger pergerakan stok — BLUEPRINT §3.3 "stock_movements".
 * Append-only, satu-satunya sumber kebenaran pergerakan stok.
 *
 * balance_after & avg_cost_after = snapshot sesaat setelah movement ini,
 * dipakai untuk kartu stok (saldo berjalan). Dihitung oleh
 * lib/inventory/stock-ledger.ts, BUKAN oleh generated column Postgres,
 * karena nilainya bergantung pada movement sebelumnya (bukan kolom tabel
 * yang sama).
 *
 * TIDAK ADA policy UPDATE/DELETE — append-only (sama seperti audit_logs).
 *
 * business_id di sini sudah eksplisit, tapi RLS tetap tidak memverifikasi
 * bahwa outlet_id & ingredient_id sungguh milik business_id yang sama —
 * baris bisa saja diinsert dengan business_id benar tapi outlet_id/
 * ingredient_id dari bisnis lain (RLS cuma memeriksa kolom business_id
 * literal, bukan konsistensi FK-nya). Trigger
 * `check_ingredient_outlet_business_id` yang sama dengan stock_levels
 * dipasang di sini juga (migration 0017) untuk menutup celah itu — dan
 * karena trigger jalan lepas dari RLS, ini juga menutupi getAdminDb()
 * (BYPASSRLS, CLAUDE.md §3.4) kalau suatu saat dipakai keliru di sini.
 */
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    movementType: movementTypeEnum("movement_type").notNull(),
    qty: numeric("qty", { precision: 16, scale: 4 }).notNull(), // + masuk, − keluar
    unitCost: numeric("unit_cost", { precision: 20, scale: 8 }).notNull(), // cost saat kejadian
    // qty × unitCost. Presisi (20,2), bukan (16,2) seperti nilai transaksi
    // lain (CLAUDE.md §3.1) -- ini nilai TURUNAN dari qty(16,4) × unit_cost
    // (20,8), bukan nilai transaksi yang diinput langsung, jadi butuh lebih
    // banyak digit agar tidak overflow di movement bervolume besar.
    // JANGAN dikembalikan ke (16,2) -- lihat juga COMMENT ON COLUMN di
    // migration 0017.
    totalCost: numeric("total_cost", { precision: 20, scale: 2 }).notNull(),
    balanceAfter: numeric("balance_after", { precision: 16, scale: 4 }).notNull(), // saldo setelah movement
    avgCostAfter: numeric("avg_cost_after", { precision: 20, scale: 8 }).notNull(), // WAC setelah movement
    refType: text("ref_type"), // 'order','purchase','opname','waste'
    refId: uuid("ref_id"),
    businessDate: date("business_date").notNull(),
    note: text("note"),
    createdBy: uuid("created_by").references(() => employees.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("stock_movements_outlet_ingredient_idx").on(
      t.outletId,
      t.ingredientId,
      t.createdAt
    ),
    index("stock_movements_business_date_idx").on(t.businessDate),
    index("stock_movements_ref_idx").on(t.refType, t.refId),
    pgPolicy("stock_movements_select", {
      for: "select",
      using: sql`${t.businessId} = any(auth_business_ids())`,
    }),
    pgPolicy("stock_movements_insert", {
      for: "insert",
      withCheck: sql`${t.businessId} = any(auth_business_ids())`,
    }),
  ]
).enableRLS();

/**
 * Transfer stok dua sisi (T22, docs/05-RENCANA-FASE-2.md §8):
 * requested → approved → sent → received, dengan rejected (dari
 * requested) dan cancelled (dari approved/sent/received) sebagai
 * terminal alternatif. Menggantikan v1 (T22 versi satu-langkah, yang
 * SENGAJA melewati handshake sent -- lihat catatan lama di
 * BLUEPRINT.md §3.3, sudah tidak berlaku sejak field data lapangan
 * putaran 2 mengonfirmasi gudang akan pakai sistem juga).
 *
 * Kolom per tahap: requestedBy (createdBy) + createdAt = kapan/siapa
 * outlet minta; approvedBy/approvedAt ATAU rejectedBy/rejectedAt/
 * rejectedReason = keputusan gudang (approve TIDAK menetapkan angka
 * apa pun -- murni gerbang ya/tidak, angka baru dikunci saat send);
 * sentBy/sentAt = gudang benar-benar kirim (angka per baris ada di
 * stock_transfer_items.sent_*); receivedBy/receivedAt = outlet
 * konfirmasi terima (angka per baris di received_qty).
 *
 * number nullable (beda dari v1 NOT NULL) -- surat jalan fisik lazimnya
 * baru ada saat gudang benar-benar mengemas/kirim, outlet yang cuma
 * meminta tidak punya nomor apa pun untuk diisi.
 *
 * TIDAK ADA policy DELETE -- append-only, koreksi = status baru
 * (cancelled), bukan edit/hapus baris (CLAUDE.md §3.2). Policy UPDATE +
 * trigger check_stock_transfer_transition (migration) membatasi state
 * machine di atas SEKALIGUS kolom mana yang boleh berubah per transisi
 * -- pola sama check_stock_transfer_cancel_only v1, digeneralisasi
 * untuk semua transisi, bukan cuma cancel.
 */
export const stockTransfers = pgTable(
  "stock_transfers",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    fromOutletId: uuid("from_outlet_id")
      .notNull()
      .references(() => outlets.id), // outlet dengan is_central_kitchen = true
    toOutletId: uuid("to_outlet_id")
      .notNull()
      .references(() => outlets.id),
    number: text("number"), // nomor surat jalan/DO fisik -- diisi gudang saat kirim, boleh kosong
    status: text("status").notNull().default("requested"), // requested|approved|rejected|sent|received|cancelled
    note: text("note"), // catatan opsional dari outlet saat request

    requestedBy: uuid("requested_by").references(() => employees.id),
    // requestedAt = createdAt (di bawah) -- request ADALAH penciptaan baris ini,
    // tidak perlu kolom terpisah.

    approvedBy: uuid("approved_by").references(() => employees.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),

    rejectedBy: uuid("rejected_by").references(() => employees.id),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectedReason: text("rejected_reason"),

    sentBy: uuid("sent_by").references(() => employees.id),
    sentAt: timestamp("sent_at", { withTimezone: true }),

    receivedBy: uuid("received_by").references(() => employees.id),
    receivedAt: timestamp("received_at", { withTimezone: true }), // nullable -- beda dari v1, terima tidak lagi terjadi saat baris dibuat

    // Pembatalan (T22 v1) -- append-only tanpa jalur koreksi berarti staf
    // akan "membetulkan" lewat opname tanpa alasan jelas, persis kebiasaan
    // yang bikin Indokopi kacau. Diperluas T22: sekarang bisa dari
    // requested/approved (belum ada dampak stok apa pun, murni batal
    // administratif) atau received (reversal penuh, mekanisme v1
    // dipertahankan). SENGAJA TIDAK dari status 'sent' -- "salah kirim
    // tapi sudah terlanjur sent" ditangani lewat received_qty jauh di
    // bawah sent_qty + alasan saat terima (jalur yang sudah ada), bukan
    // jalur cancel terpisah yang semantiknya ambigu (barangnya balik ke
    // gudang, atau dianggap hilang total?) -- pertanyaan bisnis yang
    // belum dijawab, jangan ditebak.
    cancelReason: text("cancel_reason"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by").references(() => employees.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    pgPolicy("stock_transfers_select", {
      for: "select",
      using: sql`${t.businessId} = any(auth_business_ids())`,
    }),
    pgPolicy("stock_transfers_insert", {
      for: "insert",
      withCheck: sql`${t.businessId} = any(auth_business_ids())`,
    }),
    // RLS di sini CUMA menjaga tenancy -- state machine (transisi status
    // mana yang valid dari status mana) dan kolom mana yang boleh berubah
    // per transisi ditegakkan trigger check_stock_transfer_transition
    // (migration), bukan di sini. RLS tidak bisa membandingkan NEW vs OLD
    // untuk logika sekompleks itu (cuma bisa melihat satu baris per
    // evaluasi), sama alasan seperti cancel-only v1.
    pgPolicy("stock_transfers_update", {
      for: "update",
      using: sql`${t.businessId} = any(auth_business_ids())`,
      withCheck: sql`${t.businessId} = any(auth_business_ids())`,
    }),
  ]
).enableRLS();

/**
 * Tiga pasang qty terpisah (T22, docs/05-RENCANA-FASE-2.md §8.c/§8.h) --
 * masing-masing diisi orang berbeda, di tahap berbeda:
 * - requested_qty/requested_unit: outlet, saat request (WAJIB, baris
 *   tidak berarti apa-apa tanpa ini).
 * - sent_qty/sent_unit/sent_unit_cost: gudang, saat kirim (nullable --
 *   kosong sampai tahap send). send_diff_reason WAJIB diisi (ditegakkan
 *   server) kalau sent_qty != requested_qty -- "kirim 15 dari 20 karena
 *   stok gudang terbatas" beda tindak lanjutnya dari "hilang di jalan",
 *   outlet penerima perlu tahu mana yang terjadi SEJAK tahap kirim, bukan
 *   cuma tahu di tahap terima.
 * - received_qty: outlet, saat terima (nullable -- kosong sampai tahap
 *   terima), SATUAN SAMA dengan sent_unit (outlet cuma konfirmasi angka,
 *   tidak perlu pilih satuan lagi -- mengurangi friksi tepat di langkah
 *   yang paling sensitif waktu). receive_diff_reason WAJIB (ditegakkan
 *   server) kalau received_qty != sent_qty.
 * qty/unit_cost = hasil konversi ke base_unit DARI received_qty (bukan
 * sent_qty) -- ini yang ditulis ke stock_movements outlet tujuan, karena
 * outlet cuma benar-benar punya apa yang sungguh sampai. Nullable sampai
 * tahap terima selesai.
 *
 * TIDAK ADA policy DELETE. Policy UPDATE + trigger
 * check_transfer_item_immutable_core (migration) mengunci field inti
 * (transfer_id/ingredient_id/business_id/requested_qty/requested_unit/
 * created_by/created_at) SELAMANYA setelah baris dibuat -- field
 * lain (sent_x, received_x, qty, unit_cost) boleh diisi bertahap oleh
 * lib/stock-transfers/manage.ts, yang MENEGAKKAN urutan tahap lewat
 * status stock_transfers induk di dalam transaksi (bukan lewat RLS/
 * trigger tabel ini) -- sama filosofi dengan sequencing status
 * stock_transfers sendiri.
 */
export const stockTransferItems = pgTable(
  "stock_transfer_items",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    transferId: uuid("transfer_id")
      .notNull()
      .references(() => stockTransfers.id, { onDelete: "cascade" }),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id), // didenormalisasi, pola sama stock_levels
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id),

    requestedUnit: text("requested_unit").notNull(),
    requestedQty: numeric("requested_qty", { precision: 16, scale: 4 }).notNull(),

    sentUnit: text("sent_unit"),
    sentQty: numeric("sent_qty", { precision: 16, scale: 4 }),
    sentUnitCost: numeric("sent_unit_cost", { precision: 20, scale: 8 }),
    sendDiffReason: text("send_diff_reason"),

    receivedQty: numeric("received_qty", { precision: 16, scale: 4 }),
    receiveDiffReason: text("receive_diff_reason"),

    qty: numeric("qty", { precision: 16, scale: 4 }), // hasil konversi received_qty ke base_unit
    unitCost: numeric("unit_cost", { precision: 20, scale: 8 }), // hasil konversi sent_unit_cost ke per-base_unit

    createdBy: uuid("created_by").references(() => employees.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    pgPolicy("stock_transfer_items_select", {
      for: "select",
      using: sql`${t.businessId} = any(auth_business_ids())`,
    }),
    pgPolicy("stock_transfer_items_insert", {
      for: "insert",
      withCheck: sql`${t.businessId} = any(auth_business_ids())`,
    }),
    pgPolicy("stock_transfer_items_update", {
      for: "update",
      using: sql`${t.businessId} = any(auth_business_ids())`,
      withCheck: sql`${t.businessId} = any(auth_business_ids())`,
    }),
  ]
).enableRLS();

// ─────────────────────────────────────────────────────────────────────────
// Thrifting (TT01/TT02, 10 September 2026) — docs/RENCANA-PEMBANGUNAN-
// KASIR-THRIFTING.md di repo reportkoperumnasgroup (sumber spesifikasi,
// disetujui pemilik sebelum ditulis di sini). Tidak menyentuh perilaku F&B
// yang sudah ada — cuma tabel baru + kolom nullable/berdefault aman.
// ─────────────────────────────────────────────────────────────────────────

export const pemilik = pgTable(
  "pemilik",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    // NULLABLE, TIDAK unik -- pemilik proyek eksplisit "jangan terpaku kode
    // 2-huruf gaya SS", `nama` yang jadi identitas utama, `kode` cuma label
    // singkat opsional kalau admin mau.
    kode: text("kode"),
    nama: text("nama").notNull(),
    kontak: text("kontak"),
    persenBagi: numeric("persen_bagi", { precision: 5, scale: 2 })
      .notNull()
      .default("60"),
    isActive: boolean("is_active").notNull().default(true), // master data, tidak pernah dihapus (CLAUDE.md §3.2)
    catatan: text("catatan"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    pgPolicy("pemilik_select", {
      for: "select",
      using: sql`${t.businessId} = any(auth_business_ids())`,
    }),
    pgPolicy("pemilik_insert", {
      for: "insert",
      withCheck: sql`${t.businessId} = any(auth_business_ids())`,
    }),
    pgPolicy("pemilik_update", {
      for: "update",
      using: sql`${t.businessId} = any(auth_business_ids())`,
      withCheck: sql`${t.businessId} = any(auth_business_ids())`,
    }),
  ]
).enableRLS();

export const barangStatusEnum = pgEnum("barang_status", [
  "baru_masuk",
  "siap_jual",
  "terjual",
  "rusak",
]);

export const barang = pgTable(
  "barang",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    kode: text("kode").notNull(), // dicetak jadi label barcode, satu per potong fisik
    categoryId: uuid("category_id").references(() => categories.id),
    nama: text("nama").notNull(),
    merek: text("merek"),
    ukuran: text("ukuran"),
    warna: text("warna"),
    kondisi: text("kondisi"), // teks bebas ("Sangat baik"/"Baik"/"Cukup") -- BUKAN enum terstruktur (spesifikasi eksplisit)
    hargaModal: numeric("harga_modal", { precision: 16, scale: 2 })
      .notNull()
      .default("0"),
    hargaJual: numeric("harga_jual", { precision: 16, scale: 2 }).notNull(),
    status: barangStatusEnum("status").notNull().default("baru_masuk"),
    pemilikId: uuid("pemilik_id").references(() => pemilik.id), // null = milik toko sendiri
    imagePath: text("image_path"), // pola sama products.imagePath (T09c) -- bucket privat, signed URL saat dibaca
    masukPada: timestamp("masuk_pada", { withTimezone: true })
      .notNull()
      .defaultNow(),
    terjualPada: timestamp("terjual_pada", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique().on(t.businessId, t.kode),
    pgPolicy("barang_select", {
      for: "select",
      using: sql`${t.businessId} = any(auth_business_ids())`,
    }),
    pgPolicy("barang_insert", {
      for: "insert",
      withCheck: sql`${t.businessId} = any(auth_business_ids())`,
    }),
    pgPolicy("barang_update", {
      for: "update",
      using: sql`${t.businessId} = any(auth_business_ids())`,
      withCheck: sql`${t.businessId} = any(auth_business_ids())`,
    }),
  ]
).enableRLS();

/**
 * Ukuran & isi label barcode -- pemilik proyek eksplisit "jangan dikunci
 * ke kode", satu baris pengaturan AKTIF per bisnis, diubah kapan saja dari
 * Admin (TT05). Preset umum (33x15, 50x25, 50x30, 50x80mm) cuma mengisi
 * widthMm/heightMm di UI, bukan nilai terkunci di sini.
 */
export const labelSettings = pgTable(
  "label_settings",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" })
      .unique(),
    widthMm: numeric("width_mm", { precision: 5, scale: 1 }).notNull().default("50"),
    heightMm: numeric("height_mm", { precision: 5, scale: 1 }).notNull().default("80"),
    showBarcode: boolean("show_barcode").notNull().default(true),
    showName: boolean("show_name").notNull().default(true),
    showPrice: boolean("show_price").notNull().default(true),
    showPemilikKode: boolean("show_pemilik_kode").notNull().default(false),
    showUkuran: boolean("show_ukuran").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    pgPolicy("label_settings_select", {
      for: "select",
      using: sql`${t.businessId} = any(auth_business_ids())`,
    }),
    pgPolicy("label_settings_insert", {
      for: "insert",
      withCheck: sql`${t.businessId} = any(auth_business_ids())`,
    }),
    pgPolicy("label_settings_update", {
      for: "update",
      using: sql`${t.businessId} = any(auth_business_ids())`,
      withCheck: sql`${t.businessId} = any(auth_business_ids())`,
    }),
  ]
).enableRLS();
