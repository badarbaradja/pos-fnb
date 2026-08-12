# Blueprint Sistem POS F&B (Kasirini-style) — Next.js + Supabase

Dokumen kerja untuk membangun SaaS POS untuk cafe, resto, kedai kopi, dan bisnis F&B multi-outlet.
Versi 1.0 — disusun sebagai acuan arsitektur, skema data, rumus bisnis, dan roadmap.

---

## 0. Hasil riset: apa sebenarnya Kasirini itu

Kasirini (kasirini.id, PT/brand "iniaja", package Android `id.iniaja.kasirini`) adalah aplikasi POS + pembukuan untuk UMKM Indonesia. Positioning-nya: **gratis, Android-first, dan 100% jalan tanpa internet**.

### 0.1 Fitur yang mereka klaim (verifikasi dari situs resmi & Play Store)

**Penjualan**
- Item favorit, kategori item, mode barcode, mode cash register
- Multi jenis penjualan dalam satu nota (dine-in + bungkus)
- Simpan/hold nota, kirim transaksi dari pelayan ke kasir otomatis
- Semua metode bayar: tunai, debit, kredit, e-wallet, QRIS — nama metode bisa dikustom & tercetak di nota
- Multi harga: harga toko / online / pengiriman berbeda untuk item yang sama
- Pembulatan otomatis untuk cegah selisih

**Stok**
- Stok item (produk utuh) **dan** stok bahan (BOM/resep) — dua level berbeda
- Pembelian stok, stok opname, stok terbuang (waste), pengingat stok minimum
- Satuan stok custom

**Pegawai**
- Shift otomatis, ganti shift bisa offline
- PIN pegawai, batasi hak akses per fitur
- Tambah pegawai tanpa perlu daftar akun online
- "Jumlah uang tersembunyi": kasir wajib input fisik uang sebelum sistem menampilkan angka sistem (anti-kecurangan)

**Pelanggan**
- Detail pelanggan, kelompok pelanggan, harga khusus per kelompok, diskon loyalitas

**Laporan**
- Klaim 150+ laporan; riwayat penjualan lengkap (operator, pelanggan, nominal, refund)
- Laporan stok, laporan pelanggan, laporan per outlet & per perangkat
- Laporan jam teramai & item terlaris

**Teknis**
- Sinkronisasi otomatis lintas perangkat, serial number per perangkat, perangkat tak terbatas
- Minimum Android 4.4, RAM 1 GB

### 0.2 Yang TIDAK mereka kerjakan (ini celah kamu)

Ini penting karena kamu bilang butuh sampai laba bersih:

| Kebutuhan | Kasirini | Peluang |
|---|---|---|
| HPP berbasis resep | Ada (stok bahan) | Perdalam: sub-resep, yield, WAC |
| Laba kotor | Ada (implisit dari margin item) | — |
| **Biaya gaji/karyawan sebagai cost** | Tidak | **Diferensiasi utama** |
| **Biaya operasional (sewa, listrik, gas)** | Tidak | **Diferensiasi utama** |
| **Laporan Laba Rugi (P&L) utuh** | Tidak | **Diferensiasi utama** |
| Prime cost, food cost %, labor cost % | Tidak | Diferensiasi |
| Menu engineering | Tidak | Diferensiasi |
| Komisi GoFood/GrabFood/ShopeeFood | Tidak eksplisit | Wajib untuk F&B |
| KDS (Kitchen Display) | Tidak | Wajib untuk resto serius |
| Manajemen meja/table | Tidak | Wajib untuk resto dine-in |
| Web-first / dashboard owner desktop | Terbatas | Kekuatan Next.js kamu |

**Kesimpulan positioning yang saya sarankan:**
> "POS + Pembukuan F&B. Bukan cuma tahu omzet, tapi tahu laba bersih real-time."

Kasirini menang di offline & gratis. Kamu tidak akan menang di harga. Kamu menang di **kedalaman finansial + web dashboard + kustomisasi per klien** (karena kamu jualan ke klien spesifik, bukan mass market).

---

## 1. Scope, persona, dan tiering

### 1.1 Target klien
- Cafe/coffee shop 1–3 outlet (paling realistis untuk mulai)
- Resto casual dining dengan dine-in + takeaway + online delivery
- Cloud kitchen / bakery dengan central kitchen
- Franchise kecil (butuh konsolidasi multi-outlet)

### 1.2 Persona & yang mereka butuhkan

| Persona | Device | Kebutuhan utama |
|---|---|---|
| **Owner** | Web desktop / mobile | P&L, laba bersih, perbandingan outlet, alert anomali |
| **Manajer Outlet** | Web/tablet | Approve opname, purchase, jadwal shift, laporan harian |
| **Kasir** | Tablet/PC | Cepat input, split bill, tutup shift, cetak struk |
| **Waiter** | HP | Ambil order per meja, kirim ke dapur |
| **Dapur/Barista** | Layar KDS | Antrian order, tandai selesai |
| **Gudang/Purchasing** | Web | PO, terima barang, opname, waste |
| **Akuntan/Admin** | Web | Input beban, rekonsiliasi, export |

### 1.3 Tiering produk (untuk monetisasi nanti)

- **Basic** — POS, stok item, laporan penjualan, 1 outlet
- **Pro** — Resep/HPP, multi-outlet, purchasing, KDS, shift & gaji
- **Enterprise** — P&L lengkap, central kitchen, transfer antar outlet, API, custom report

---

## 2. Peta modul (13 modul)

```
M01  Tenancy, Auth & Device        → siapa, di mana, pakai alat apa
M02  Master Data & Katalog         → produk, varian, modifier, harga
M03  POS / Order Management        → transaksi inti
M04  Payment, Bill & Struk         → uang masuk
M05  Inventory & HPP               → stok item, stok bahan, resep, WAC
M06  Purchasing & Supplier         → PO, penerimaan, hutang usaha
M07  Karyawan, Shift & Payroll     → biaya tenaga kerja
M08  Beban Operasional & Aset      → sewa, listrik, penyusutan
M09  Reporting & Analytics         → 40+ laporan, P&L
M10  Promo, Diskon & Loyalty       → strategi harga
M11  Device, Printer & KDS         → hardware layer
M12  Channel & Marketplace         → GoFood, GrabFood, komisi
M13  Settings, Subscription, Audit → SaaS layer
```

Ketergantungan: M01 → M02 → M03 → M04 → (M05 ‖ M07 ‖ M08) → M09.
**M05, M07, M08 adalah tiga input yang bertemu di M09 untuk menghasilkan laba bersih.**

---

## 3. Model data lengkap

### 3.0 Keputusan desain yang harus diambil di awal (jangan ditunda)

**a. Tipe data uang**
Jangan pernah pakai `float`/`double`. Rupiah tidak punya sen di level transaksi, tapi **harga per gram bahan punya desimal panjang**.

```
Nilai transaksi (subtotal, total, payment)  → numeric(16,2)
Harga jual produk                            → numeric(16,2)
Unit cost bahan (per gram/ml)                → numeric(20,8)   ← penting!
Kuantitas stok                               → numeric(16,4)
Persentase (pajak, diskon)                   → numeric(7,4)
```
Contoh kenapa `numeric(20,8)`: susu 1 liter Rp 18.500 → cost per ml = 18,5. Tapi kopi bubuk 1 kg Rp 145.000 → per gram 145. Sementara vanilla essence 100 ml Rp 25.000 → per ml 250. Kalau resep pakai 0,5 ml, error pembulatan menumpuk lintas ribuan transaksi.

Di frontend **wajib** pakai `decimal.js` atau `dinero.js`, bukan `Number`.

**b. Primary key**
Pakai **UUID v7** (atau ULID) yang di-generate **di client**, bukan `serial`/`identity`. Alasannya: mode offline harus bisa bikin ID tanpa server, dan UUID v7 tetap sortable secara waktu (index-friendly, tidak seperti UUID v4).

**c. Prinsip immutability**
- `stock_movements` = **append-only ledger**. Tidak pernah UPDATE/DELETE. Koreksi = movement baru.
- `order_items` menyimpan **snapshot** nama, harga jual, dan HPP saat transaksi. Kalau produk diubah harganya besok, laporan bulan lalu tidak boleh ikut berubah.
- `payments` append-only. Refund = record baru bertanda negatif atau tabel refund terpisah.

**d. Business date ≠ calendar date**
Cafe tutup jam 02:00 dini hari. Transaksi jam 01:30 harus masuk laporan hari sebelumnya. Simpan `business_date DATE` terpisah dari `created_at TIMESTAMPTZ`, dihitung dari `outlet.day_cutoff_time` (misal 04:00). Ini penyebab bug laporan nomor 1 di POS.

---

### 3.1 M01 — Tenancy, Auth & Device

```sql
create type user_role as enum ('owner','manager','cashier','waiter','kitchen','warehouse','accountant');

create table businesses (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  business_type text not null default 'cafe',      -- cafe|resto|bakery|bar
  timezone      text not null default 'Asia/Jakarta',
  currency      text not null default 'IDR',
  logo_url      text,
  npwp          text,
  plan          text not null default 'basic',
  trial_ends_at timestamptz,
  created_at    timestamptz not null default now()
);

create table outlets (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references businesses(id) on delete cascade,
  code            text not null,                   -- 'PST', 'CBG1' → dipakai di nomor struk
  name            text not null,
  address         text,
  phone           text,
  day_cutoff_time time not null default '04:00',   -- batas hari operasional
  is_central_kitchen boolean not null default false,
  tax_percent     numeric(7,4) not null default 10,   -- PB1/PBJT, cek perda
  tax_inclusive   boolean not null default false,     -- harga sudah termasuk pajak?
  service_charge_percent numeric(7,4) not null default 0,
  service_charge_in_tax_base boolean not null default true,  -- apakah service charge masuk basis pajak?
  rounding_to     integer not null default 100,     -- pembulatan ke 100 rupiah
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (business_id, code)
);

-- profil user, terhubung ke auth.users Supabase
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null,
  phone       text,
  avatar_url  text
);

create table memberships (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  user_id     uuid not null references profiles(id) on delete cascade,
  role        user_role not null,
  outlet_ids  uuid[],            -- null = semua outlet
  is_active   boolean not null default true,
  unique (business_id, user_id)
);

-- pegawai TIDAK harus punya akun auth (belajar dari Kasirini: "tambah pegawai tanpa daftar")
create table employees (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references businesses(id) on delete cascade,
  outlet_id      uuid references outlets(id),
  user_id        uuid references profiles(id),        -- optional link ke akun
  code           text not null,
  full_name      text not null,
  role           user_role not null default 'cashier',
  pin_hash       text,                                 -- bcrypt PIN 6 digit
  employment_type text not null default 'fulltime',    -- fulltime|parttime|daily|freelance
  join_date      date,
  resign_date    date,
  is_active      boolean not null default true,
  unique (business_id, code)
);

create table devices (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references businesses(id) on delete cascade,
  outlet_id     uuid not null references outlets(id) on delete cascade,
  serial_number text not null,                -- ditampilkan ke user, dipakai pairing
  name          text not null,                -- 'Kasir 1', 'Tablet Waiter A'
  device_type   text not null default 'pos',  -- pos|waiter|kds|display
  last_sync_at  timestamptz,
  last_seq      bigint not null default 0,    -- counter nomor struk lokal
  is_active     boolean not null default true,
  unique (business_id, serial_number)
);

create table permissions_override (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references employees(id) on delete cascade,
  permission_key text not null,               -- lihat matriks RBAC bagian 7
  allowed       boolean not null
);
```

### 3.2 M02 — Master Data & Katalog

```sql
create table categories (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name        text not null,
  color       text,
  sort_order  integer not null default 0,
  parent_id   uuid references categories(id)
);

create type product_type as enum ('simple','recipe','bundle','service','open_price');

create table products (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references businesses(id) on delete cascade,
  category_id    uuid references categories(id),
  sku            text,
  barcode        text,
  name           text not null,
  description    text,
  image_url      text,
  product_type   product_type not null default 'recipe',
  -- 'simple'  : dijual utuh, stok dikurangi langsung (botol Aqua, snack)
  -- 'recipe'  : dibuat dari bahan, stok bahan yang dikurangi (latte, nasi goreng)
  -- 'bundle'  : paket dari beberapa produk
  -- 'service' : tidak ada stok (biaya kemasan, tip)
  track_stock    boolean not null default true,
  is_favorite    boolean not null default false,
  is_taxable     boolean not null default true,
  prep_station   text,                         -- 'kitchen' | 'bar' | 'dessert' → routing KDS
  prep_minutes   integer,
  sort_order     integer not null default 0,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now()
);

create table product_variants (
  id             uuid primary key default gen_random_uuid(),
  product_id     uuid not null references products(id) on delete cascade,
  name           text not null,               -- 'Regular', 'Large', 'Hot', 'Iced'
  sku            text,
  price_delta    numeric(16,2) not null default 0,
  is_default     boolean not null default false,
  is_active      boolean not null default true
);

-- MULTI HARGA (fitur kunci Kasirini): dine-in, takeaway, GoFood, member
create table price_tiers (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references businesses(id) on delete cascade,
  code           text not null,               -- 'DINEIN','TAKEAWAY','GOFOOD','MEMBER'
  name           text not null,
  channel        text,                        -- link ke sales channel
  markup_percent numeric(7,4) default 0,      -- default markup kalau harga tidak diisi manual
  is_default     boolean not null default false,
  unique (business_id, code)
);

create table product_prices (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references products(id) on delete cascade,
  variant_id    uuid references product_variants(id) on delete cascade,
  price_tier_id uuid not null references price_tiers(id) on delete cascade,
  outlet_id     uuid references outlets(id),     -- null = berlaku semua outlet
  price         numeric(16,2) not null,
  valid_from    date,
  valid_to      date,
  unique nulls not distinct (product_id, variant_id, price_tier_id, outlet_id, valid_from)
);

-- MODIFIER (extra shot, less sugar, level pedas)
create table modifier_groups (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  name         text not null,                -- 'Level Gula', 'Topping'
  min_select   integer not null default 0,
  max_select   integer not null default 1,
  is_required  boolean not null default false
);

create table modifiers (
  id                uuid primary key default gen_random_uuid(),
  modifier_group_id uuid not null references modifier_groups(id) on delete cascade,
  name              text not null,           -- 'Extra Shot', 'Less Ice'
  price             numeric(16,2) not null default 0,
  ingredient_id     uuid,                    -- kalau modifier ini konsumsi bahan
  ingredient_qty    numeric(16,4),           -- misal extra shot = 9 gram kopi
  sort_order        integer not null default 0
);

create table product_modifier_groups (
  product_id        uuid references products(id) on delete cascade,
  modifier_group_id uuid references modifier_groups(id) on delete cascade,
  primary key (product_id, modifier_group_id)
);

create table product_bundle_items (
  bundle_id   uuid references products(id) on delete cascade,
  product_id  uuid references products(id),
  variant_id  uuid references product_variants(id),
  qty         numeric(16,4) not null default 1,
  primary key (bundle_id, product_id, variant_id)
);
```

### 3.3 M05 — Inventory, Resep & HPP (inti perhitungan)

```sql
-- SATUAN & KONVERSI: sumber bug paling umum di POS F&B
create table units (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  code        text not null,          -- 'kg','g','l','ml','pcs','pack','botol'
  name        text not null,
  base_unit   text not null,          -- satuan dasar untuk kelompok ini: 'g','ml','pcs'
  factor      numeric(20,8) not null  -- 1 kg = 1000 g → factor 1000
);
-- Aturan: SEMUA stok disimpan dalam base_unit. Konversi hanya di layer tampilan/input.

create table ingredients (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references businesses(id) on delete cascade,
  code           text,
  name           text not null,                 -- 'Biji Kopi Arabika', 'Susu UHT'
  category       text,                          -- 'Bahan Kering','Dairy','Kemasan'
  base_unit      text not null,                 -- 'g','ml','pcs'
  purchase_unit  text not null,                 -- 'kg','l','dus'
  purchase_factor numeric(20,8) not null,       -- 1 dus = 24 pcs → 24
  yield_percent  numeric(7,4) not null default 100,
  -- yield: 1 kg ayam mentah → 800 g siap saji. Cost efektif = cost / (yield/100)
  is_semi_finished boolean not null default false,  -- hasil sub-resep (saus, adonan)
  shelf_life_days integer,
  is_active      boolean not null default true
);

-- Level stok per outlet + moving average cost
create table stock_levels (
  ingredient_id uuid not null references ingredients(id) on delete cascade,
  outlet_id     uuid not null references outlets(id) on delete cascade,
  qty_on_hand   numeric(16,4) not null default 0,      -- dalam base_unit
  avg_cost      numeric(20,8) not null default 0,      -- WAC per base_unit
  min_stock     numeric(16,4) not null default 0,      -- trigger alert
  max_stock     numeric(16,4),
  last_counted_at timestamptz,
  primary key (ingredient_id, outlet_id)
);

-- LEDGER: append-only, satu-satunya sumber kebenaran pergerakan stok
create type movement_type as enum (
  'purchase','sale','waste','opname_adjust','transfer_in','transfer_out',
  'production_in','production_out','refund_in','initial','manual_adjust'
);

create table stock_movements (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references businesses(id),
  outlet_id     uuid not null references outlets(id),
  ingredient_id uuid not null references ingredients(id),
  movement_type movement_type not null,
  qty           numeric(16,4) not null,      -- POSITIF masuk, NEGATIF keluar
  unit_cost     numeric(20,8) not null,      -- cost saat kejadian (snapshot)
  total_cost    numeric(20,2) not null,      -- qty * unit_cost
  balance_after numeric(16,4) not null,      -- saldo setelah movement (untuk audit)
  avg_cost_after numeric(20,8) not null,
  ref_type      text,                        -- 'order','purchase','opname','waste'
  ref_id        uuid,
  business_date date not null,
  note          text,
  created_by    uuid references employees(id),
  created_at    timestamptz not null default now()
);
create index on stock_movements (outlet_id, ingredient_id, created_at desc);
create index on stock_movements (business_date);
create index on stock_movements (ref_type, ref_id);

-- RESEP / BILL OF MATERIALS
create table recipes (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  product_id   uuid references products(id) on delete cascade,
  variant_id   uuid references product_variants(id) on delete cascade,
  -- ATAU resep untuk semi-finished (sub-resep):
  output_ingredient_id uuid references ingredients(id),
  output_qty   numeric(16,4) not null default 1,   -- 1 batch saus = 2000 g
  overhead_cost numeric(20,2) not null default 0,  -- gas, listrik per batch (opsional)
  version      integer not null default 1,
  is_active    boolean not null default true,
  check (product_id is not null or output_ingredient_id is not null)
);

create table recipe_items (
  id             uuid primary key default gen_random_uuid(),
  recipe_id      uuid not null references recipes(id) on delete cascade,
  ingredient_id  uuid not null references ingredients(id),
  qty            numeric(16,4) not null,     -- dalam base_unit ingredient
  is_optional    boolean not null default false,
  waste_percent  numeric(7,4) not null default 0   -- allowance tumpah/serpih
);

create table suppliers (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name        text not null,
  contact_name text, phone text, email text, address text,
  payment_terms_days integer not null default 0,   -- 0 = tunai, 30 = tempo
  is_active   boolean not null default true
);

create type purchase_status as enum ('draft','ordered','partial','received','cancelled');

create table purchases (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references businesses(id),
  outlet_id     uuid not null references outlets(id),
  supplier_id   uuid references suppliers(id),
  number        text not null,
  status        purchase_status not null default 'draft',
  order_date    date,
  received_date date,
  due_date      date,
  subtotal      numeric(16,2) not null default 0,
  discount      numeric(16,2) not null default 0,
  tax           numeric(16,2) not null default 0,
  shipping_cost numeric(16,2) not null default 0,   -- dialokasikan ke unit cost!
  total         numeric(16,2) not null default 0,
  paid_amount   numeric(16,2) not null default 0,
  note          text,
  created_by    uuid references employees(id),
  created_at    timestamptz not null default now()
);

create table purchase_items (
  id            uuid primary key default gen_random_uuid(),
  purchase_id   uuid not null references purchases(id) on delete cascade,
  ingredient_id uuid not null references ingredients(id),
  qty_ordered   numeric(16,4) not null,
  qty_received  numeric(16,4) not null default 0,
  purchase_unit text not null,
  unit_price    numeric(20,8) not null,       -- harga per purchase_unit
  discount      numeric(16,2) not null default 0,
  line_total    numeric(16,2) not null,
  expiry_date   date
);

-- STOK OPNAME
create type opname_status as enum ('draft','submitted','approved','cancelled');

create table stock_opnames (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id),
  outlet_id   uuid not null references outlets(id),
  number      text not null,
  status      opname_status not null default 'draft',
  opname_date date not null,
  note        text,
  total_variance_value numeric(16,2) not null default 0,
  created_by  uuid references employees(id),
  approved_by uuid references employees(id),
  approved_at timestamptz
);

create table opname_items (
  id            uuid primary key default gen_random_uuid(),
  opname_id     uuid not null references stock_opnames(id) on delete cascade,
  ingredient_id uuid not null references ingredients(id),
  system_qty    numeric(16,4) not null,    -- snapshot saat opname dibuka
  actual_qty    numeric(16,4) not null,
  variance_qty  numeric(16,4) generated always as (actual_qty - system_qty) stored,
  unit_cost     numeric(20,8) not null,
  variance_value numeric(20,2),
  note          text
);

create table waste_logs (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references businesses(id),
  outlet_id     uuid not null references outlets(id),
  ingredient_id uuid references ingredients(id),
  product_id    uuid references products(id),      -- waste produk jadi
  qty           numeric(16,4) not null,
  unit_cost     numeric(20,8) not null,
  total_cost    numeric(20,2) not null,
  reason        text not null,   -- 'expired','damaged','spill','staff_meal','complimentary','training'
  business_date date not null,
  created_by    uuid references employees(id),
  created_at    timestamptz not null default now()
);

create table stock_transfers (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references businesses(id),
  from_outlet_id uuid not null references outlets(id),
  to_outlet_id   uuid not null references outlets(id),
  number         text not null,
  status         text not null default 'draft',   -- draft|sent|received|cancelled
  sent_at        timestamptz,
  received_at    timestamptz,
  note           text
);

create table stock_transfer_items (
  id            uuid primary key default gen_random_uuid(),
  transfer_id   uuid not null references stock_transfers(id) on delete cascade,
  ingredient_id uuid not null references ingredients(id),
  qty_sent      numeric(16,4) not null,
  qty_received  numeric(16,4),
  unit_cost     numeric(20,8) not null
);
```

### 3.4 M03/M04 — Order, Payment & Shift

```sql
create table areas (
  id        uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references outlets(id) on delete cascade,
  name      text not null            -- 'Indoor','Outdoor','Lantai 2'
);

create table tables (
  id        uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references outlets(id) on delete cascade,
  area_id   uuid references areas(id),
  name      text not null,           -- 'T1','VIP-2'
  capacity  integer not null default 4,
  status    text not null default 'available',  -- available|occupied|reserved|dirty
  pos_x     integer, pos_y integer   -- untuk floor plan
);

create type shift_status as enum ('open','closed','reconciled');

create table shifts (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references businesses(id),
  outlet_id      uuid not null references outlets(id),
  device_id      uuid references devices(id),
  employee_id    uuid not null references employees(id),
  status         shift_status not null default 'open',
  opened_at      timestamptz not null default now(),
  closed_at      timestamptz,
  business_date  date not null,
  opening_cash   numeric(16,2) not null default 0,
  -- diisi kasir SEBELUM melihat angka sistem (anti-fraud, meniru Kasirini)
  counted_cash   numeric(16,2),
  expected_cash  numeric(16,2),
  cash_variance  numeric(16,2),
  note           text
);

create table cash_movements (       -- kas masuk/keluar di luar penjualan
  id          uuid primary key default gen_random_uuid(),
  shift_id    uuid not null references shifts(id) on delete cascade,
  type        text not null,        -- 'cash_in' | 'cash_out'
  amount      numeric(16,2) not null,
  reason      text not null,        -- 'setor bank','beli galon','kembalian modal'
  expense_id  uuid,                 -- kalau ini beban operasional, link ke expenses
  created_at  timestamptz not null default now()
);

create type order_status as enum ('draft','open','in_kitchen','served','paid','void','refunded');
create type order_channel as enum ('dine_in','takeaway','delivery','gofood','grabfood','shopeefood','online_store','reservation');

create table orders (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references businesses(id),
  outlet_id         uuid not null references outlets(id),
  shift_id          uuid references shifts(id),
  device_id         uuid references devices(id),
  number            text not null,               -- 'PST-250812-0001'
  status            order_status not null default 'draft',
  channel           order_channel not null default 'dine_in',
  price_tier_id     uuid references price_tiers(id),
  table_id          uuid references tables(id),
  customer_id       uuid,
  guest_count       integer not null default 1,
  waiter_id         uuid references employees(id),
  cashier_id        uuid references employees(id),

  -- kolom kalkulasi (lihat rumus bagian 5.1)
  subtotal          numeric(16,2) not null default 0,  -- sebelum diskon, sesudah modifier
  item_discount     numeric(16,2) not null default 0,
  order_discount    numeric(16,2) not null default 0,
  discount_total    numeric(16,2) not null default 0,
  net_sales         numeric(16,2) not null default 0,  -- subtotal - discount_total
  service_charge    numeric(16,2) not null default 0,
  tax_amount        numeric(16,2) not null default 0,
  rounding          numeric(16,2) not null default 0,
  total             numeric(16,2) not null default 0,
  cogs_total        numeric(20,2) not null default 0,  -- SNAPSHOT HPP saat bayar
  gross_profit      numeric(20,2) not null default 0,  -- net_sales - cogs_total

  -- untuk channel marketplace
  commission_percent numeric(7,4) not null default 0,
  commission_amount  numeric(16,2) not null default 0,
  external_ref       text,                             -- order id GoFood

  business_date     date not null,
  opened_at         timestamptz not null default now(),
  paid_at           timestamptz,
  void_reason       text,
  note              text,
  synced_at         timestamptz,
  created_at        timestamptz not null default now(),
  unique (business_id, number)
);
create index on orders (outlet_id, business_date);
create index on orders (status) where status in ('draft','open','in_kitchen');

create table order_items (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references orders(id) on delete cascade,
  product_id        uuid references products(id),
  variant_id        uuid references product_variants(id),
  -- SNAPSHOT (jangan join ke products untuk laporan historis!)
  product_name      text not null,
  variant_name      text,
  category_name     text,
  qty               numeric(16,4) not null,
  unit_price        numeric(16,2) not null,
  modifier_total    numeric(16,2) not null default 0,
  gross_amount      numeric(16,2) not null,       -- qty * (unit_price + modifier_total)
  discount_amount   numeric(16,2) not null default 0,
  allocated_order_discount numeric(16,2) not null default 0,  -- alokasi proporsional
  net_amount        numeric(16,2) not null,
  unit_cogs         numeric(20,8) not null default 0,  -- HPP per unit saat transaksi
  cogs_amount       numeric(20,2) not null default 0,
  prep_station      text,
  kitchen_status    text not null default 'pending', -- pending|cooking|ready|served
  is_voided         boolean not null default false,
  void_reason       text,
  note              text,                           -- 'tanpa bawang'
  sort_order        integer not null default 0
);

create table order_item_modifiers (
  id            uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references order_items(id) on delete cascade,
  modifier_id   uuid references modifiers(id),
  modifier_name text not null,
  price         numeric(16,2) not null default 0,
  qty           numeric(16,4) not null default 1,
  unit_cogs     numeric(20,8) not null default 0
);

create table payment_methods (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references businesses(id) on delete cascade,
  code           text not null,        -- 'CASH','QRIS','DEBIT_BCA','GOPAY'
  name           text not null,        -- nama yang tercetak di struk (custom, ala Kasirini)
  type           text not null,        -- cash|card|ewallet|qris|transfer|voucher|credit
  mdr_percent    numeric(7,4) not null default 0,   -- biaya EDC/QRIS 0,7%
  is_cash_drawer boolean not null default false,
  requires_ref   boolean not null default false,     -- butuh nomor approval
  is_active      boolean not null default true,
  sort_order     integer not null default 0
);

create table payments (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references orders(id) on delete cascade,
  payment_method_id uuid not null references payment_methods(id),
  method_name       text not null,
  amount            numeric(16,2) not null,
  received_amount   numeric(16,2),         -- uang diterima (tunai)
  change_amount     numeric(16,2) not null default 0,
  mdr_amount        numeric(16,2) not null default 0,
  reference         text,
  status            text not null default 'success',
  paid_at           timestamptz not null default now()
);

create table refunds (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references orders(id),
  amount       numeric(16,2) not null,
  restock      boolean not null default false,
  reason       text not null,
  approved_by  uuid references employees(id),
  business_date date not null,
  created_at   timestamptz not null default now()
);

create table refund_items (
  id            uuid primary key default gen_random_uuid(),
  refund_id     uuid not null references refunds(id) on delete cascade,
  order_item_id uuid not null references order_items(id),
  qty           numeric(16,4) not null,
  amount        numeric(16,2) not null
);
```

### 3.5 M07/M08 — Biaya Karyawan & Beban Operasional

Ini bagian yang membuat sistemmu bisa menghitung **laba bersih**, dan yang tidak dimiliki Kasirini.

```sql
-- Struktur gaji
create table employee_salaries (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null references employees(id) on delete cascade,
  effective_from  date not null,
  salary_type     text not null,          -- 'monthly' | 'daily' | 'hourly'
  base_amount     numeric(16,2) not null, -- gaji pokok per bulan/hari/jam
  meal_allowance  numeric(16,2) not null default 0,   -- uang makan per hari hadir
  transport_allowance numeric(16,2) not null default 0,
  position_allowance  numeric(16,2) not null default 0,
  overtime_rate   numeric(16,2) not null default 0,   -- per jam
  bpjs_kes_company numeric(7,4) not null default 4,   -- % ditanggung perusahaan
  bpjs_tk_company  numeric(7,4) not null default 6.24,
  service_charge_share boolean not null default true, -- ikut bagi service charge?
  is_active       boolean not null default true
);

create table attendances (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references businesses(id),
  outlet_id     uuid not null references outlets(id),
  employee_id   uuid not null references employees(id),
  business_date date not null,
  clock_in      timestamptz,
  clock_out     timestamptz,
  work_minutes  integer,
  overtime_minutes integer not null default 0,
  status        text not null default 'present',  -- present|absent|leave|sick|holiday
  labor_cost    numeric(16,2) not null default 0, -- biaya harian ter-alokasi
  note          text,
  unique (employee_id, business_date)
);

create table payroll_periods (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id),
  outlet_id    uuid references outlets(id),
  period_start date not null,
  period_end   date not null,
  status       text not null default 'draft',   -- draft|approved|paid
  total_gross  numeric(16,2) not null default 0,
  total_deduction numeric(16,2) not null default 0,
  total_net    numeric(16,2) not null default 0,
  total_company_cost numeric(16,2) not null default 0,  -- ini yang masuk P&L
  paid_at      timestamptz
);

create table payroll_items (
  id                uuid primary key default gen_random_uuid(),
  payroll_period_id uuid not null references payroll_periods(id) on delete cascade,
  employee_id       uuid not null references employees(id),
  days_present      integer not null default 0,
  base_salary       numeric(16,2) not null default 0,
  overtime_amount   numeric(16,2) not null default 0,
  allowance_amount  numeric(16,2) not null default 0,
  service_charge_share numeric(16,2) not null default 0,
  bonus             numeric(16,2) not null default 0,
  gross             numeric(16,2) not null default 0,
  deduction_late    numeric(16,2) not null default 0,
  deduction_bpjs_employee numeric(16,2) not null default 0,
  deduction_other   numeric(16,2) not null default 0,
  pph21             numeric(16,2) not null default 0,
  net_pay           numeric(16,2) not null default 0,
  company_bpjs      numeric(16,2) not null default 0,
  company_cost      numeric(16,2) not null default 0   -- gross + company_bpjs
);

-- BEBAN OPERASIONAL
create table expense_categories (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name        text not null,
  cost_type   text not null,      -- 'fixed' | 'variable' | 'semi_variable'
  pnl_group   text not null,      -- 'labor'|'occupancy'|'utility'|'marketing'|'admin'|'other'
  is_cogs     boolean not null default false  -- true kalau masuk HPP (mis. gas dapur)
);
-- Seed default: Sewa Tempat, Listrik, Air, Gas LPG, Internet, Gaji, THR,
-- Marketing/Ads, Kemasan, Perlengkapan Kebersihan, Maintenance Alat,
-- Biaya Aplikasi/Software, Transportasi, Pajak & Retribusi, Penyusutan.

create table expenses (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references businesses(id),
  outlet_id       uuid references outlets(id),    -- null = beban HQ, dialokasikan
  category_id     uuid not null references expense_categories(id),
  description     text not null,
  amount          numeric(16,2) not null,
  expense_date    date not null,
  business_date   date not null,
  payment_method_id uuid references payment_methods(id),
  supplier_id     uuid references suppliers(id),
  attachment_url  text,                    -- foto nota
  is_recurring    boolean not null default false,
  recurring_id    uuid,
  shift_id        uuid references shifts(id),   -- kalau dibayar dari kas kasir
  created_by      uuid references employees(id),
  created_at      timestamptz not null default now()
);

create table recurring_expenses (       -- sewa bulanan, langganan internet
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id),
  outlet_id    uuid references outlets(id),
  category_id  uuid not null references expense_categories(id),
  description  text not null,
  amount       numeric(16,2) not null,
  frequency    text not null default 'monthly',   -- monthly|weekly|yearly
  day_of_month integer,
  start_date   date not null,
  end_date     date,
  auto_post    boolean not null default true,
  is_active    boolean not null default true
);

create table assets (                   -- untuk penyusutan
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references businesses(id),
  outlet_id         uuid references outlets(id),
  name              text not null,      -- 'Mesin Espresso La Marzocco'
  acquisition_date  date not null,
  acquisition_cost  numeric(16,2) not null,
  residual_value    numeric(16,2) not null default 0,
  useful_life_months integer not null,   -- 60 = 5 tahun
  method            text not null default 'straight_line',
  monthly_depreciation numeric(16,2) generated always as
    ((acquisition_cost - residual_value) / nullif(useful_life_months,0)) stored,
  is_active         boolean not null default true
);
```

### 3.6 M10/M12 — Promo, Pelanggan, Channel

```sql
create table customers (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references businesses(id) on delete cascade,
  code          text,
  name          text not null,
  phone         text,
  email         text,
  birth_date    date,
  customer_group_id uuid,
  price_tier_id uuid references price_tiers(id),  -- harga khusus member
  points        numeric(16,2) not null default 0,
  total_spent   numeric(16,2) not null default 0,
  visit_count   integer not null default 0,
  last_visit_at timestamptz,
  note          text
);

create table customer_groups (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references businesses(id) on delete cascade,
  name          text not null,          -- 'Reguler','Silver','Gold','Karyawan'
  discount_percent numeric(7,4) not null default 0,
  price_tier_id uuid references price_tiers(id),
  point_multiplier numeric(7,4) not null default 1
);

create table promotions (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references businesses(id) on delete cascade,
  name          text not null,
  promo_type    text not null,   -- 'percent'|'amount'|'buy_x_get_y'|'bundle_price'|'happy_hour'
  value         numeric(16,2),
  min_purchase  numeric(16,2) not null default 0,
  max_discount  numeric(16,2),
  applies_to    text not null default 'order',  -- order|product|category
  target_ids    uuid[],
  channels      order_channel[],
  days_of_week  integer[],       -- {1,2,3} = Sen-Rab
  start_time    time, end_time   time,
  start_date    date, end_date   date,
  quota         integer,
  used_count    integer not null default 0,
  is_stackable  boolean not null default false,
  requires_approval boolean not null default false,
  is_active     boolean not null default true
);

create table order_promotions (
  order_id     uuid references orders(id) on delete cascade,
  promotion_id uuid references promotions(id),
  discount_amount numeric(16,2) not null,
  primary key (order_id, promotion_id)
);

create table sales_channels (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references businesses(id) on delete cascade,
  code              order_channel not null,
  name              text not null,
  commission_percent numeric(7,4) not null default 0,   -- GoFood ±20%
  price_tier_id     uuid references price_tiers(id),
  settlement_days   integer not null default 0,
  is_active         boolean not null default true
);
```

### 3.7 Tabel agregat (performa laporan)

Jangan hitung P&L dari raw table setiap kali dashboard dibuka. Buat rollup harian.

```sql
create table daily_sales_summary (
  outlet_id      uuid not null references outlets(id),
  business_date  date not null,
  gross_sales    numeric(16,2) not null default 0,
  discount_total numeric(16,2) not null default 0,
  refund_total   numeric(16,2) not null default 0,
  net_sales      numeric(16,2) not null default 0,
  service_charge numeric(16,2) not null default 0,
  tax_amount     numeric(16,2) not null default 0,
  commission_total numeric(16,2) not null default 0,
  mdr_total      numeric(16,2) not null default 0,
  cogs_total     numeric(20,2) not null default 0,
  gross_profit   numeric(20,2) not null default 0,
  order_count    integer not null default 0,
  guest_count    integer not null default 0,
  void_count     integer not null default 0,
  avg_check      numeric(16,2) not null default 0,
  labor_cost     numeric(16,2) not null default 0,
  opex_total     numeric(16,2) not null default 0,
  net_profit     numeric(20,2) not null default 0,
  updated_at     timestamptz not null default now(),
  primary key (outlet_id, business_date)
);
```
Isi lewat trigger setelah order `paid`, atau lewat cron job tiap 15 menit + rebuild penuh saat tutup shift.

---

## 4. Alur bisnis & state machine

### 4.1 Siklus order

```
[draft] ──kirim ke dapur──> [in_kitchen] ──semua item ready──> [served]
   │                              │                                │
   │                              └──────────────┬─────────────────┘
   │                                             ▼
   └──────────────bayar langsung────────────> [paid] ──refund──> [refunded]
   │
   └──batal sebelum kirim──> [void]  (tanpa jejak stok)
```

Aturan penting:
- **Void sebelum `in_kitchen`** → tidak ada pergerakan stok, tidak muncul di laporan penjualan.
- **Void setelah `in_kitchen`** → stok SUDAH terpotong. Harus dicatat sebagai `waste_logs` dengan reason `void_after_prep`, karena barangnya benar-benar hilang. Ini kebocoran biaya yang tidak terlihat kalau sistem cuma menghapus order.
- **Refund setelah `paid`** → buat record refund, opsional restock, dan reverse COGS.
- Order tidak pernah dihapus. Hanya berubah status.

### 4.2 Kapan stok dipotong? (keputusan desain)

Tiga opsi, pilih satu dan konsisten:

| Opsi | Potong stok saat | Cocok untuk | Risiko |
|---|---|---|---|
| A | Item dikirim ke dapur | Resto dine-in | Stok berkurang walau order batal → harus di-handle waste |
| B | Order dibayar | Cafe cepat saji, takeaway | Stok "telat" akurat saat rush hour |
| C | Item ditandai `ready` oleh dapur | Resto premium | Butuh disiplin KDS |

**Rekomendasi: Opsi B untuk MVP** (paling sederhana, tidak ada state stok menggantung), lalu tawarkan Opsi A sebagai setting di V2.

### 4.3 Matriks pergerakan stok

| Event | movement_type | Tanda qty | Sumber unit_cost |
|---|---|---|---|
| Terima pembelian | `purchase` | + | harga beli + alokasi ongkir |
| Order dibayar | `sale` | − | `avg_cost` saat itu |
| Waste dicatat | `waste` | − | `avg_cost` |
| Opname disetujui | `opname_adjust` | ± | `avg_cost` |
| Transfer keluar | `transfer_out` | − | `avg_cost` outlet asal |
| Transfer masuk | `transfer_in` | + | `avg_cost` outlet asal (bukan outlet tujuan) |
| Produksi sub-resep | `production_out` (bahan) + `production_in` (semi-finished) | −/+ | dihitung dari resep |
| Refund dengan restock | `refund_in` | + | `unit_cogs` dari `order_items` (bukan avg saat ini) |
| Saldo awal migrasi | `initial` | + | input manual |

### 4.4 Siklus shift kasir

```
1. Kasir login (PIN) → buka shift → input modal awal (opening_cash)
2. Transaksi berjalan, semua order terikat shift_id
3. Kas masuk/keluar dicatat (cash_movements)
4. Tutup shift:
   a. Sistem MINTA kasir input uang fisik dulu (counted_cash)   ← anti-fraud
   b. BARU sistem tampilkan expected_cash & selisih
   c. Kalau selisih > toleransi (mis. Rp 20.000) → wajib isi alasan + approval manajer
5. Cetak ringkasan shift, status → closed
6. Manajer verifikasi → reconciled
```

### 4.5 Siklus tutup hari (end of day)

Jalankan job saat melewati `day_cutoff_time`:
1. Pastikan semua shift closed; kalau ada order `open` → paksa jadi `void` atau pindah ke hari berikutnya (setting).
2. Hitung ulang `daily_sales_summary`.
3. Alokasikan `labor_cost` harian dari `attendances`.
4. Alokasikan beban tetap harian (sewa bulanan ÷ jumlah hari operasi).
5. Posting penyusutan aset harian.
6. Cek `min_stock` → generate notifikasi restock.
7. Kirim ringkasan WhatsApp/email ke owner.

---

## 5. Rumus perhitungan lengkap

Ini bagian paling kritikal. Salah urutan di sini = angka klien salah = kamu kehilangan klien.

### 5.1 Kalkulasi struk (order calculation waterfall)

**Urutan wajib, tidak boleh ditukar:**

```
STEP 1  Harga baris
        line_gross = qty × (unit_price + Σ modifier_price)

STEP 2  Diskon per item
        line_after_item_disc = line_gross − item_discount

STEP 3  Subtotal
        subtotal = Σ line_gross
        item_discount_total = Σ item_discount

STEP 4  Diskon transaksi (order-level)
        order_discount = f(promo, member, voucher)
        Kalau persen: order_discount = pct × (subtotal − item_discount_total)
        Terapkan cap: order_discount = min(order_discount, max_discount)

STEP 5  ALOKASI diskon transaksi ke tiap baris (PENTING untuk margin per menu)
        alloc_i = order_discount × (line_after_item_disc_i / Σ line_after_item_disc)
        Baris terakhir menyerap sisa pembulatan agar Σ alloc = order_discount persis.

STEP 6  Net sales
        net_sales = subtotal − item_discount_total − order_discount

STEP 7  Service charge  (dihitung dari net sales, SEBELUM pajak)
        service_charge = round(service_charge_pct × net_sales)

STEP 8  Dasar pengenaan pajak
        tax_base = net_sales + service_charge
        (item yang is_taxable = false dikeluarkan dari basis ini)

STEP 9  Pajak
        Kalau tax_inclusive = false (harga belum termasuk pajak):
            tax = round(tax_pct × tax_base)
            total_before_rounding = tax_base + tax
        Kalau tax_inclusive = true (harga sudah termasuk pajak):
            tax = tax_base − (tax_base / (1 + tax_pct))
            total_before_rounding = tax_base

STEP 10 Pembulatan
        total = round_to(total_before_rounding, outlet.rounding_to)
        rounding = total − total_before_rounding
```

**Contoh angka nyata:**
```
2 × Latte @ 28.000  + extra shot 5.000        = 2 × 33.000 = 66.000
1 × Nasi Goreng @ 35.000, diskon item 5.000   = 30.000
──────────────────────────────────────────────────────────
subtotal                                        = 101.000
item_discount                                   =   5.000
order_discount (promo 10%, cap 15.000)          =   9.600
net_sales                                       =  86.400
service_charge 5%                               =   4.320
tax_base                                        =  90.720
PB1 10%                                         =   9.072
total_before_rounding                           =  99.792
total (bulat ke 100)                            = 99.800
rounding                                        =      +8
```

Alokasi diskon transaksi ke baris:
```
Latte      : 9.600 × (66.000/96.000) = 6.600
NasiGoreng : 9.600 × (30.000/96.000) = 3.000
```

### 5.2 Catatan pajak Indonesia (jangan hard-code!)

- Restoran/cafe umumnya dikenakan **pajak daerah atas makanan & minuman (PB1 / PBJT)**, bukan PPN. Tarifnya ditetapkan Perda masing-masing kabupaten/kota, dengan batas maksimum yang diatur UU HKPD (umumnya 10%).
- Objek PBJT makanan-minuman pada dasarnya **tidak dikenai PPN**, sehingga jangan menagih keduanya sekaligus.
- Usaha kecil di bawah ambang omzet tertentu bisa tidak wajib memungut. Ambang ini berbeda per daerah.
- Beberapa daerah punya aturan berbeda soal apakah *service charge* masuk dasar pengenaan pajak.

**Konsekuensi desain:** `tax_percent`, `tax_inclusive`, dan `service_charge_in_tax_base` harus jadi setting per outlet. Sediakan juga toggle "tidak memungut pajak" untuk klien UMKM. Verifikasi tarif dengan klien / Bapenda setempat sebelum go-live — ini kewajiban legal mereka, dan sistemmu hanya alat.

### 5.3 HPP / COGS — tiga metode yang harus ada

**(a) HPP Teoritis berbasis resep (per menu, real-time)**

```
Untuk tiap bahan dalam resep:
    effective_qty_i = recipe_qty_i × (1 + waste_percent_i/100)
    effective_cost_i = avg_cost_i / (yield_percent_i / 100)
    cost_i = effective_qty_i × effective_cost_i

HPP_produk = Σ cost_i + overhead_per_unit
             (untuk sub-resep: HPP_batch / output_qty)
```

Contoh Caffe Latte:
```
Biji kopi   18 g × Rp 145/g  (yield 100%)               = 2.610
Susu UHT   200 ml × Rp 18,5/ml (yield 100%)             = 3.700
Gula cair   10 ml × Rp 12/ml                            =   120
Cup + lid    1 pcs × Rp 1.350                           = 1.350
Waste allowance kopi 3%                                 =    78
─────────────────────────────────────────────────────────────
HPP per cup                                             = 7.858
Harga jual 28.000 → food cost 28,1% → margin 71,9%
```

**(b) Weighted Average Cost (WAC) — update tiap pembelian masuk**

```
new_avg_cost = (qty_lama × avg_cost_lama + qty_masuk × cost_masuk)
               / (qty_lama + qty_masuk)

cost_masuk per base unit =
    (harga_beli_per_purchase_unit − diskon_per_unit + alokasi_ongkir_per_unit)
    / purchase_factor
```
Alokasi ongkir: `ongkir_total × (line_total_i / Σ line_total)`, lalu dibagi qty.

Edge case: kalau `qty_lama < 0` (stok minus karena penjualan mendahului penerimaan), jangan pakai rumus di atas — set `avg_cost = cost_masuk` dan catat warning.

**(c) HPP Aktual periodik (untuk rekonsiliasi bulanan)**

```
HPP_aktual = Persediaan_awal + Pembelian − Persediaan_akhir
```
di mana Persediaan awal/akhir diambil dari nilai opname (qty × avg_cost).

**(d) Variance analysis — nilai jual utama ke owner**

```
Pemakaian_teoritis = Σ (qty_terjual × recipe_qty)          [dari resep]
Pemakaian_aktual   = stok_awal + pembelian − stok_akhir     [dari opname]
Variance_qty       = Pemakaian_aktual − Pemakaian_teoritis
Variance_value     = Variance_qty × avg_cost
Variance_%         = Variance_qty / Pemakaian_teoritis × 100
```
Interpretasi: variance positif = ada kebocoran (porsi kelebihan, tumpah, dicuri, tidak tercatat). Target industri < 2–3%. **Laporan ini yang bikin owner mau bayar.**

### 5.4 Laba kotor & laba bersih

```
Gross Sales        = Σ line_gross semua order paid
(−) Discount       = item_discount + order_discount
(−) Refund         = Σ refund amount
─────────────────────────────────────────────
NET SALES          = penjualan bersih (basis semua rasio)

(−) COGS           = Σ order_items.cogs_amount + waste_value
─────────────────────────────────────────────
LABA KOTOR (Gross Profit)
Gross Margin %     = Laba Kotor / Net Sales × 100

(−) Biaya Tenaga Kerja  (gaji + tunjangan + BPJS perusahaan + lembur + THR prorata)
(−) Biaya Sewa & Okupansi
(−) Utilitas (listrik, air, gas, internet)
(−) Marketing & Promosi
(−) Komisi marketplace (GoFood/Grab/Shopee)
(−) MDR / biaya EDC & QRIS
(−) Perlengkapan & maintenance
(−) Biaya administrasi
(−) Penyusutan aset
─────────────────────────────────────────────
LABA OPERASIONAL (Operating Profit / EBIT)

(±) Pendapatan/beban lain (bunga, sewa disewakan)
(−) Pajak penghasilan badan/UMKM
─────────────────────────────────────────────
LABA BERSIH (Net Profit)
Net Margin %       = Laba Bersih / Net Sales × 100
```

**Perlakuan service charge (harus diputuskan bersama klien):**
- Skema A — service charge dibagikan ke karyawan: bukan pendapatan. Catat sebagai **liabilitas** (`service_charge_payable`), keluar lewat payroll. Tidak masuk Net Sales.
- Skema B — service charge jadi milik usaha: masuk sebagai pendapatan lain, dan gaji dibayar penuh dari kas usaha.

Default yang saya sarankan: **Skema A**, karena ini praktik paling umum di resto Indonesia. Buat setting `service_charge_treatment` per bisnis.

**Perlakuan penjualan marketplace (sering salah dicatat!):**
```
GoFood order Rp 100.000
Gross sales dicatat        = 100.000    ← catat harga jual penuh
Komisi 20%                 =  20.000    ← beban, BUKAN pengurang gross sales
Uang masuk rekening        =  80.000
```
Kalau kamu catat hanya 80.000, food cost % jadi terdistorsi dan owner salah ambil keputusan menu.

### 5.5 Biaya tenaga kerja: alokasi harian

Owner butuh tahu labor cost **per hari**, bukan cuma per bulan.

```
Karyawan bulanan:
    biaya_perusahaan_bulanan = gaji_pokok + tunjangan_tetap
                             + (gaji_pokok × %BPJS_kesehatan_perusahaan)
                             + (gaji_pokok × %BPJS_TK_perusahaan)
                             + (THR / 12)
    biaya_harian = biaya_perusahaan_bulanan / hari_operasi_bulan_itu

Karyawan harian:
    biaya_harian = upah_harian + uang_makan + uang_transport

Lembur:
    lembur = jam_lembur × tarif_lembur
    (kalau mengikuti aturan ketenagakerjaan: jam ke-1 = 1,5×; jam berikutnya = 2×
     tarif per jam, dengan tarif per jam umumnya = gaji bulanan / 173)

LABOR COST harian outlet = Σ biaya_harian karyawan hadir + Σ lembur hari itu
```

Alokasi karyawan lintas outlet (mis. manajer area): bagi `biaya_harian` proporsional terhadap net sales tiap outlet, atau pakai persentase manual yang di-set di `employee_salaries`.

### 5.6 Penyusutan & beban tetap

```
Penyusutan garis lurus bulanan = (harga_perolehan − nilai_residu) / umur_manfaat_bulan
Penyusutan harian              = penyusutan_bulanan / hari_dalam_bulan

Sewa harian = sewa_bulanan / hari_operasi_bulan
```
Post otomatis ke `expenses` lewat job harian agar P&L harian tidak melompat-lompat di tanggal 1.

### 5.7 KPI wajib F&B (tampilkan di dashboard owner)

```
Food Cost %        = COGS / Net Sales × 100          → target cafe 25–33%
Beverage Cost %    = COGS minuman / Net Sales minuman → target 18–25%
Labor Cost %       = Total biaya TK / Net Sales × 100 → target 20–30%
PRIME COST %       = Food Cost % + Labor Cost %      → target ≤ 60–65%  ★ KPI #1
Occupancy Cost %   = (sewa + utilitas) / Net Sales   → target ≤ 10%
Average Check      = Net Sales / jumlah order
Sales per Guest    = Net Sales / total guest_count
Table Turnover     = jumlah order dine-in / jumlah meja (per hari)
Sales per Labor Hour = Net Sales / total jam kerja
Void Rate          = order void / total order        → > 3% = red flag
Discount Rate      = total diskon / gross sales      → > 8% = red flag
Waste %            = nilai waste / COGS              → target < 3%
```

**Break-even:**
```
Contribution Margin Ratio = (Net Sales − Biaya Variabel) / Net Sales
BEP (Rupiah)  = Total Biaya Tetap / CM Ratio
BEP (Porsi)   = Total Biaya Tetap / (Harga rata-rata − HPP rata-rata)
BEP harian    = BEP bulanan / hari operasi
Margin of Safety % = (Penjualan aktual − BEP) / Penjualan aktual × 100
```
Biaya variabel = COGS + komisi + MDR + upah harian/freelance.
Biaya tetap = sewa + gaji bulanan + utilitas dasar + penyusutan + langganan.

**Menu engineering (kuadran):**
```
Popularity index   = qty_terjual_menu / total_qty_terjual
Contribution margin= harga_jual − HPP
Ambang popularitas = (1 / jumlah_menu) × 0,70
Ambang margin      = rata-rata contribution margin tertimbang

Popularitas TINGGI + Margin TINGGI  → STAR       (pertahankan, tonjolkan)
Popularitas TINGGI + Margin RENDAH  → PLOWHORSE  (naikkan harga / turunkan HPP)
Popularitas RENDAH + Margin TINGGI  → PUZZLE     (promosikan, reposisi menu)
Popularitas RENDAH + Margin RENDAH  → DOG        (hapus dari menu)
```

### 5.8 Rekonsiliasi kas shift

```
expected_cash = opening_cash
              + Σ pembayaran tunai (payments where type='cash')
              − Σ kembalian
              + Σ cash_in
              − Σ cash_out
              − Σ refund tunai

cash_variance = counted_cash − expected_cash
```
Aturan UI: field `counted_cash` **wajib diisi sebelum** `expected_cash` ditampilkan. Simpan `counted_cash` pertama kali sebagai immutable (tidak bisa diedit setelah lihat angka sistem).

### 5.9 Penomoran struk (harus aman offline)

```
Format: {OUTLET_CODE}-{YYMMDD}-{DEVICE_SEQ}-{COUNTER}
Contoh: PST-260812-01-0037
```
Counter di-generate lokal per device, bukan dari server. Ini menghindari duplikasi saat beberapa perangkat offline bersamaan. Simpan `last_seq` di `devices` dan mirror di storage lokal.

---

## 6. Katalog laporan (target 40+, cukup untuk klaim "laporan lengkap")

### 6.1 Penjualan
1. Ringkasan penjualan harian/mingguan/bulanan
2. Penjualan per jam (heatmap jam teramai) — untuk atur jadwal shift
3. Penjualan per hari dalam seminggu
4. Penjualan per outlet (perbandingan)
5. Penjualan per channel (dine-in vs takeaway vs GoFood)
6. Penjualan per metode pembayaran
7. Penjualan per kasir / per waiter
8. Penjualan per perangkat
9. Penjualan per meja / per area
10. Riwayat transaksi detail (dengan filter operator, pelanggan, nominal)
11. Laporan void & alasannya
12. Laporan refund
13. Laporan diskon (siapa memberi, berapa, ke siapa)
14. Average check trend
15. Perbandingan periode (MoM, YoY)

### 6.2 Produk
16. Item terlaris (qty) & item penyumbang omzet terbesar (rupiah) — sering beda!
17. Item paling menguntungkan (contribution margin)
18. Item tidak laku / slow moving
19. Penjualan per kategori
20. Menu engineering matrix
21. Analisis modifier (topping mana yang laku)
22. Laporan bundling/paket

### 6.3 Inventory
23. Kartu stok per bahan (mutasi lengkap)
24. Nilai persediaan saat ini (per outlet & konsolidasi)
25. Stok di bawah minimum (rekomendasi PO)
26. Laporan pembelian per supplier
27. Perbandingan harga beli antar waktu (kenaikan harga bahan)
28. Laporan waste (per alasan, per bahan, tren)
29. Hasil stok opname & selisihnya
30. **Variance teoritis vs aktual** ★
31. Laporan transfer antar outlet
32. Bahan mendekati kedaluwarsa
33. Inventory turnover ratio

### 6.4 Karyawan
34. Absensi & jam kerja
35. Biaya tenaga kerja per outlet per periode
36. Produktivitas: sales per employee, sales per labor hour
37. Ringkasan shift & selisih kas per kasir
38. Slip gaji & rekap payroll
39. Ranking penjualan per waiter (untuk insentif)

### 6.5 Keuangan
40. **Laporan Laba Rugi (P&L)** — harian, bulanan, per outlet, konsolidasi ★
41. Ringkasan arus kas sederhana
42. Rekap beban per kategori
43. Dashboard KPI (prime cost, food cost %, labor cost %)
44. Analisis break-even
45. Hutang ke supplier (aging AP)
46. Rekonsiliasi settlement marketplace (klaim vs terima)

---

## 7. Matriks RBAC

| Permission key | Owner | Manajer | Kasir | Waiter | Dapur | Gudang | Akuntan |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `pos.create_order` | ✓ | ✓ | ✓ | ✓ | — | — | — |
| `pos.void_item_before_send` | ✓ | ✓ | ✓ | ✓ | — | — | — |
| `pos.void_after_send` | ✓ | ✓ | ⚠ | — | — | — | — |
| `pos.discount_manual` | ✓ | ✓ | ⚠ | — | — | — | — |
| `pos.open_price` | ✓ | ✓ | ⚠ | — | — | — | — |
| `pos.refund` | ✓ | ✓ | ⚠ | — | — | — | — |
| `pos.reprint_receipt` | ✓ | ✓ | ✓ | — | — | — | — |
| `pos.open_drawer_no_sale` | ✓ | ✓ | ⚠ | — | — | — | — |
| `shift.open_close` | ✓ | ✓ | ✓ | — | — | — | — |
| `shift.view_expected_cash` | ✓ | ✓ | — | — | — | — | ✓ |
| `shift.reconcile` | ✓ | ✓ | — | — | — | — | ✓ |
| `product.manage` | ✓ | ✓ | — | — | — | — | — |
| `price.manage` | ✓ | ⚠ | — | — | — | — | — |
| `recipe.view_hpp` | ✓ | ✓ | — | — | — | ⚠ | ✓ |
| `stock.purchase` | ✓ | ✓ | — | — | — | ✓ | — |
| `stock.opname_input` | ✓ | ✓ | ✓ | — | — | ✓ | — |
| `stock.opname_approve` | ✓ | ✓ | — | — | — | — | — |
| `stock.waste` | ✓ | ✓ | ✓ | — | ✓ | ✓ | — |
| `stock.transfer` | ✓ | ✓ | — | — | — | ✓ | — |
| `kds.view` | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| `employee.manage` | ✓ | ⚠ | — | — | — | — | — |
| `payroll.view` | ✓ | ⚠ | — | — | — | — | ✓ |
| `payroll.process` | ✓ | — | — | — | — | — | ✓ |
| `expense.create` | ✓ | ✓ | ⚠ | — | — | ✓ | ✓ |
| `expense.approve` | ✓ | ✓ | — | — | — | — | — |
| `report.sales` | ✓ | ✓ | ⚠ | — | — | — | ✓ |
| `report.profit_loss` | ✓ | ⚠ | — | — | — | — | ✓ |
| `settings.business` | ✓ | — | — | — | — | — | — |
| `settings.tax` | ✓ | — | — | — | — | — | ✓ |

✓ = default aktif  ⚠ = default nonaktif, bisa diaktifkan per karyawan  — = tidak tersedia

Implementasi: simpan default per role di konstanta kode, override per karyawan di `permissions_override`. Cek di **tiga lapis**: UI (sembunyikan tombol), server action (validasi), RLS (proteksi data).

---

## 8. Offline-first & sinkronisasi

Ini keunggulan Kasirini dan **wajib** kalau kamu jualan ke cafe di area sinyal buruk. Tapi ini juga bagian tersulit — pertimbangkan menunda ke V2.

### 8.1 Tingkat offline (pilih ambisi yang realistis)

| Level | Kemampuan | Effort |
|---|---|---|
| L0 | Online only | Rendah |
| L1 | **Read cache** — menu & harga di-cache, POS tetap tampil saat internet putus, tapi tidak bisa transaksi | Rendah |
| L2 | **Write queue** — transaksi disimpan lokal, dikirim saat online kembali (target realistis) | Sedang |
| L3 | Full local DB dengan sync dua arah, multi-device offline | Tinggi |

**Rekomendasi: mulai L1 di MVP, naik ke L2 di V1.5.** L3 baru masuk akal kalau sudah punya 20+ klien membayar.

### 8.2 Arsitektur L2 (outbox pattern)

```
┌─────────────── Browser / PWA ────────────────┐
│  UI (React)                                  │
│    ↓ semua mutasi lewat satu fungsi          │
│  Repository layer                            │
│    ├─→ IndexedDB (Dexie)  ← sumber baca UI   │
│    └─→ outbox table (queue mutasi)           │
│              ↓ background sync               │
└──────────────┼───────────────────────────────┘
               ↓ (saat online)
        POST /api/sync  { mutations: [...] }
               ↓
        Supabase Postgres
               ↓ Realtime broadcast
        Device lain menerima perubahan
```

**Aturan yang bikin ini tidak berantakan:**
1. **ID di-generate client** (UUID v7) — server tidak pernah menolak karena ID bentrok.
2. **Idempotency key** per mutasi. Server simpan `processed_mutations(id, business_id)`; kalau sudah ada, skip dan balas sukses. Ini melindungi dari retry ganda.
3. **Order = insert-only**, tidak pernah di-edit dari dua device sekaligus → tidak ada konflik.
4. **Stok = ledger append-only** → tidak ada konflik, tinggal jumlahkan. Saldo `stock_levels` adalah cache yang dihitung ulang dari ledger.
5. **Master data = server wins (LWW)** dengan `updated_at`. Kasir tidak boleh edit produk saat offline.
6. Simpan `sync_state { last_pulled_at, cursor }` per device; pull perubahan dengan `where updated_at > cursor`.
7. Batasi antrean: kalau outbox > 500 mutasi atau > 3 hari, tampilkan peringatan keras di UI.

### 8.3 Yang WAJIB tetap jalan offline
- Ambil order, hitung total, bayar tunai, cetak struk (printer Bluetooth/USB)
- Tutup shift & cetak ringkasan
- Lihat menu, harga, dan stok terakhir yang tersinkron

### 8.4 Yang BOLEH gagal offline
- Pembayaran QRIS dinamis (butuh server payment gateway)
- Laporan lintas outlet
- Kelola produk, resep, harga
- Approval opname & purchase

### 8.5 Library yang relevan
- `dexie` + `dexie-react-hooks` — IndexedDB dengan API waras (paling ringan, kontrol penuh)
- `@powersync/web` atau ElectricSQL — sync engine siap pakai untuk Postgres, hemat waktu tapi menambah dependensi & biaya
- `workbox` / `next-pwa` — service worker & app shell caching
- `uuidv7` — generate ID sortable

---

## 9. Arsitektur Next.js

### 9.1 Stack yang saya rekomendasikan

| Layer | Pilihan | Alasan |
|---|---|---|
| Framework | Next.js 15 App Router | RSC untuk dashboard berat data, Server Actions untuk mutasi |
| Database | Supabase Postgres | Kamu sudah kuasai, RLS + Realtime + Auth sepaket |
| ORM | Drizzle ORM | Type-safe, migration jelas, SQL-first (cocok karena skema ini kompleks) |
| Validasi | Zod | Satu skema untuk client + server |
| State server | TanStack Query | Cache, optimistic update, retry — wajib untuk POS |
| State lokal | Zustand | Keranjang order, sesi shift |
| UI | Tailwind + shadcn/ui | Cepat, konsisten |
| Uang | decimal.js | **Wajib.** `0.1 + 0.2 !== 0.3` |
| Tanggal | date-fns + date-fns-tz | Business date & timezone WIB/WITA/WIT |
| Chart | Recharts | Cukup untuk dashboard P&L |
| Tabel | TanStack Table | Laporan dengan sort/filter/pivot |
| Offline | Dexie + Workbox | Lihat bagian 8 |
| Print | ESC/POS via bridge | Lihat 9.4 |
| Payment | Midtrans / Xendit | QRIS dinamis + webhook |
| Realtime | Supabase Realtime | KDS, notifikasi order |
| Error | Sentry | Wajib untuk produk yang dipakai klien |

### 9.2 Struktur folder

```
src/
├── app/
│   ├── (auth)/login/                    # login owner/manajer
│   ├── (pos)/                           # layout fullscreen, tanpa nav
│   │   ├── pos/                         # kasir utama
│   │   ├── waiter/                      # tablet pramusaji
│   │   ├── kds/                         # kitchen display
│   │   └── shift/
│   ├── (dashboard)/
│   │   ├── dashboard/                   # ringkasan owner
│   │   ├── penjualan/
│   │   ├── produk/{daftar,kategori,resep,harga,modifier}/
│   │   ├── inventori/{bahan,pembelian,opname,waste,transfer}/
│   │   ├── karyawan/{daftar,absensi,shift,payroll}/
│   │   ├── keuangan/{beban,aset,laba-rugi}/
│   │   ├── pelanggan/
│   │   ├── laporan/[slug]/
│   │   └── pengaturan/{outlet,pajak,perangkat,pengguna,langganan}/
│   ├── api/
│   │   ├── sync/route.ts                # endpoint outbox
│   │   ├── webhook/midtrans/route.ts
│   │   ├── cron/end-of-day/route.ts
│   │   └── print/route.ts
│   └── (marketing)/                     # landing page + pricing
├── lib/
│   ├── db/{schema,migrations,queries}/
│   ├── calc/                            # ★ SEMUA RUMUS DI SINI, MURNI & TERUJI
│   │   ├── order-calculator.ts          # bagian 5.1
│   │   ├── cogs.ts                      # bagian 5.3
│   │   ├── pnl.ts                       # bagian 5.4
│   │   ├── labor-cost.ts                # bagian 5.5
│   │   ├── kpi.ts                       # bagian 5.7
│   │   └── __tests__/                   # unit test wajib di sini
│   ├── offline/{db,outbox,sync}.ts
│   ├── auth/{permissions,session}.ts
│   └── utils/{money,business-date,receipt-number}.ts
├── components/{pos,dashboard,reports,ui}/
├── hooks/
└── types/
```

**Prinsip nomor satu:** semua fungsi di `lib/calc/` harus **fungsi murni** — input objek, output objek, tanpa akses database. Dengan begitu bisa di-unit-test, dijalankan di client (offline) *dan* di server (rekalkulasi) dengan hasil identik.

### 9.3 Server Action vs API Route

- **Server Action** — mutasi dari dashboard (buat produk, approve opname, input beban). Ringkas, type-safe.
- **API Route** — apa pun yang dipanggil dari luar atau dari layer offline: `/api/sync`, webhook payment, cron, print bridge. Server Action tidak cocok untuk dipanggil dari service worker.
- **RSC** untuk halaman laporan (query berat dijalankan di server, kirim HTML jadi).
- **Client Component** untuk POS (butuh interaktivitas & state lokal penuh).

### 9.4 Masalah printer (ini akan makan waktumu, siapkan dari awal)

Web browser tidak bisa langsung cetak ke printer thermal ESC/POS dengan andal. Opsi:

| Opsi | Cara | Catatan |
|---|---|---|
| **A. Printer jaringan (LAN/WiFi)** | Kirim byte ESC/POS ke IP:9100 dari **server** atau local agent | Paling stabil untuk resto. Butuh printer LAN (mis. Epson TM-series) |
| **B. Local print agent** | App kecil (Node/Electron/Tauri) di PC kasir, web POST ke `localhost:9100` | Fleksibel, tapi klien harus install |
| **C. Android + RawBT / intent** | Buka POS di WebView Android, print lewat aplikasi jembatan | Paling murah, cocok kalau target klien pakai HP/tablet |
| **D. Web Bluetooth API** | `navigator.bluetooth` langsung ke printer BLE | Hanya Chrome/Android, butuh HTTPS, sering rewel, banyak printer tidak BLE |
| **E. window.print() + CSS 80mm** | Cetak lewat driver OS | Paling cepat dibuat, cukup untuk demo & klien yang pakai laptop |

**Saran:** MVP pakai **E** (CSS `@page { size: 80mm auto }`), lalu **A/B** untuk klien produksi. Bangun `lib/printing/receipt-template.ts` yang menghasilkan struktur abstrak, dengan renderer terpisah untuk HTML dan ESC/POS.

### 9.5 RLS multi-tenant (Supabase)

```sql
-- helper: ambil business_id user yang login
create or replace function auth_business_ids()
returns uuid[] language sql stable security definer as $$
  select coalesce(array_agg(business_id), '{}')
  from memberships
  where user_id = auth.uid() and is_active = true
$$;

alter table orders enable row level security;

create policy "orders_select" on orders for select
  using (business_id = any(auth_business_ids()));

create policy "orders_insert" on orders for insert
  with check (business_id = any(auth_business_ids()));

-- contoh yang lebih ketat: kasir hanya lihat order outlet-nya sendiri
create policy "orders_select_outlet" on orders for select
  using (
    exists (
      select 1 from memberships m
      where m.user_id = auth.uid()
        and m.business_id = orders.business_id
        and m.is_active
        and (m.outlet_ids is null or orders.outlet_id = any(m.outlet_ids))
    )
  );
```

Peringatan dari pengalaman umum: **jangan lupa `enable row level security` di setiap tabel baru.** Satu tabel terlewat = data semua klien bocor. Buat test otomatis yang mengecek `pg_tables` untuk tabel tanpa RLS.

Untuk operasi sistem (cron, sync, trigger stok) pakai `service_role` di server, jangan akali RLS dari client.

### 9.6 Performa yang perlu diantisipasi
- Index komposit `(outlet_id, business_date)` di `orders`, `stock_movements`, `expenses`.
- Partisi `orders` dan `stock_movements` per bulan kalau sudah > 1 juta baris.
- `daily_sales_summary` sebagai rollup, jangan agregasi raw untuk dashboard.
- Laporan berat (P&L bulanan multi-outlet) → jalankan sebagai job, kirim hasil, jangan blok request.
- POS harus render < 100 ms per tap. Cache seluruh katalog di memori saat shift dibuka.

---

## 10. Roadmap bertahap

### Fase 0 — Fondasi (1–2 minggu)
- Setup Next.js + Supabase + Drizzle + auth
- Skema tenancy, outlet, membership, employee, device
- Layout dashboard + POS shell
- `lib/calc/order-calculator.ts` + unit test (kerjakan **sebelum** UI)

### Fase 1 — MVP POS (3–4 minggu) → sudah bisa dijual ke klien pertama
- Master produk, kategori, varian, modifier, harga multi-tier
- POS: keranjang, diskon, pajak, service charge, pembulatan
- Metode bayar, split payment, kembalian
- Shift buka/tutup + rekonsiliasi kas
- Cetak struk (CSS 80mm)
- Laporan: ringkasan harian, per produk, per kasir, riwayat transaksi

### Fase 2 — Inventory & HPP (3–4 minggu) → ini yang bikin harga jualmu naik
- Bahan, satuan, konversi, yield
- Resep/BOM + sub-resep
- Ledger stok + WAC
- Pembelian & supplier
- Opname & waste
- HPP otomatis di setiap order → laba kotor real
- Laporan: kartu stok, nilai persediaan, variance, food cost %

### Fase 3 — Biaya & Laba Bersih (2–3 minggu) → diferensiasi utama
- Karyawan, absensi, struktur gaji
- Payroll sederhana + alokasi labor cost harian
- Beban operasional + beban berulang + aset & penyusutan
- **Laporan Laba Rugi lengkap**
- Dashboard KPI: prime cost, food cost %, labor cost %, BEP

### Fase 4 — Operasional Resto (2–3 minggu)
- Manajemen meja & area, floor plan
- Aplikasi waiter (ambil order dari HP)
- KDS via Realtime
- Split bill, merge table, pindah meja
- Multi-outlet + transfer stok

### Fase 5 — Growth (berkelanjutan)
- Offline L2 (outbox sync)
- QRIS dinamis via Midtrans/Xendit
- Integrasi channel GoFood/GrabFood (manual entry dulu, API kalau memungkinkan)
- Loyalty & poin, promo terjadwal
- Menu engineering, forecasting, notifikasi WhatsApp
- Self-service subscription & billing

**Total realistis untuk versi jual: 3–4 bulan kerja fokus** (Fase 0–3). Kalau sambil kuliah, hitung 5–6 bulan.

---

## 11. Checklist jebakan (baca ulang sebelum setiap fase)

**Data & angka**
- [ ] Tidak ada `float` untuk uang, di mana pun
- [ ] `order_items` menyimpan snapshot nama, harga, dan HPP — laporan lama tidak boleh berubah
- [ ] Produk/bahan tidak pernah di-DELETE, hanya `is_active = false`
- [ ] Diskon transaksi dialokasikan ke baris, kalau tidak margin per menu akan salah
- [ ] Pembulatan hanya dilakukan sekali di akhir, bukan di tiap langkah
- [ ] Σ alokasi diskon harus persis sama dengan diskon total (baris terakhir menyerap sisa)
- [ ] Perubahan harga produk butuh riwayat, bukan overwrite

**Waktu**
- [ ] `business_date` terpisah dari `created_at`, dihitung dari cutoff outlet
- [ ] Semua timestamp `timestamptz`, konversi ke zona outlet di layer tampilan
- [ ] Laporan "hari ini" untuk outlet WITA tidak boleh pakai zona server

**Stok**
- [ ] Kebijakan stok minus: blokir, izinkan dengan warning, atau izinkan diam-diam (buat setting)
- [ ] Void setelah masuk dapur → catat sebagai waste, bukan hapus movement
- [ ] Refund dengan restock pakai `unit_cogs` order lama, bukan `avg_cost` sekarang
- [ ] Opname harus mengunci snapshot `system_qty` saat dibuka, bukan saat disetujui
- [ ] Transfer antar outlet membawa cost outlet asal
- [ ] Bahan dengan yield < 100% (ayam, sayur) — cost efektif harus dibagi yield

**Transaksi**
- [ ] Idempotency di endpoint bayar — double tap tidak boleh jadi dua pembayaran
- [ ] Nomor struk unik per bisnis walau beberapa device offline bersamaan
- [ ] Split bill: satu order bisa punya banyak `payments`
- [ ] Order yang "hilang" (device rusak sebelum sync) — sediakan menu recovery

**Pajak & legal**
- [ ] Tarif pajak per outlet, bukan konstanta global
- [ ] Toggle tax-inclusive vs exclusive
- [ ] Struk memuat informasi yang diminta Perda setempat (nama usaha, NPWPD kalau ada)
- [ ] Kalau kamu simpan data pelanggan, siapkan kebijakan privasi — ada kewajiban pelindungan data pribadi di Indonesia

**Marketplace**
- [ ] Penjualan GoFood dicatat gross, komisi jadi beban terpisah
- [ ] Harga tier GoFood biasanya di-markup untuk menutup komisi — sediakan price tier khusus
- [ ] Rekonsiliasi settlement: yang masuk rekening ≠ total penjualan

**Operasional**
- [ ] `counted_cash` immutable setelah `expected_cash` ditampilkan
- [ ] Semua aksi sensitif (void, diskon manual, buka laci) masuk audit log
- [ ] Backup harian + uji restore, bukan cuma percaya Supabase
- [ ] Batas bawah: apa yang terjadi kalau internet mati saat jam sibuk? Uji skenario ini sebelum go-live

---

## 12. Monetisasi (kalau kamu jual ke klien)

**Model A — Proyek custom (paling cocok untuk mulai)**
Rp 8–25 juta per klien untuk instalasi + kustomisasi, plus Rp 300–800 rb/bulan maintenance & hosting.
Kelebihan: cash flow cepat, requirement jelas. Kekurangan: tidak scalable.

**Model B — SaaS langganan**
Basic Rp 99 rb/outlet/bulan · Pro Rp 249 rb · Enterprise Rp 499 rb.
Butuh 30–50 outlet berbayar baru terasa. Perlu onboarding, support, dan billing otomatis.

**Model C — Hybrid (rekomendasi)**
Mulai dari Model A dengan 2–3 klien awal (mereka membiayai pengembangan produkmu), sambil membangun kode yang multi-tenant sejak hari pertama. Setelah stabil, konversi ke Model B.

**Catatan biaya infrastruktur:** Supabase Pro sekitar $25/bulan bisa menampung puluhan outlet kecil. Vercel Pro $20/bulan. Jadi margin Model B sangat sehat — bottleneck-nya support, bukan server.

---

## 13. Langkah pertama yang konkret

Kalau saya di posisimu, urutan minggu pertama:

1. **Hari 1–2:** Tulis `lib/calc/order-calculator.ts` beserta 20+ unit test dari contoh di bagian 5.1. Belum sentuh UI sama sekali. Kalau kalkulator ini benar, sisanya cuma CRUD.
2. **Hari 3–4:** Migrasi Drizzle untuk M01 + M02 + M03 (tenancy, katalog, order). Seed data satu cafe fiktif dengan 20 menu dan 30 bahan.
3. **Hari 5–7:** UI POS satu layar: grid produk, keranjang, tombol bayar, struk HTML. Belum ada auth, belum ada stok.
4. **Minggu 2:** Auth + shift + rekonsiliasi kas. Ini titik di mana sistem sudah "nyata".
5. **Minggu 3:** Ajak satu cafe kenalan untuk uji coba paralel dengan sistem lama mereka selama seminggu. Feedback dari sini lebih berharga daripada dua minggu coding.

Satu saran tambahan: **cari klien pertama sebelum fitur lengkap.** Cafe yang mau jadi pilot akan memberi tahu mana dari 13 modul di atas yang benar-benar mereka pakai — biasanya jauh lebih sedikit dari yang kita kira.
