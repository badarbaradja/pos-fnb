import { and, desc, eq, gte, ilike, inArray, lte, sql } from "drizzle-orm";
import { Decimal } from "decimal.js";
import type { UserDbHandle } from "@/lib/db/client";
import {
  brands,
  businesses,
  employees,
  orderItems,
  orders,
  outlets,
  payments,
  refunds,
  shifts,
} from "@/lib/db/schema";
import { averageCheck } from "@/lib/calc/kpi";

/**
 * lib/db/queries/sales-report.ts — T17. Isi pertama folder `lib/db/queries/`
 * (sudah didefinisikan di struktur folder CLAUDE.md §5, belum pernah dipakai).
 *
 * SEMUA agregasi (SUM/COUNT/GROUP BY) dieksekusi di SQL lewat template
 * `sql` Drizzle -- BUKAN pola "fetch semua baris lalu .reduce() di JS"
 * yang dipakai lib/pos/shift.ts untuk hal lain (diminta eksplisit).
 * Rumus turunan yang butuh penanganan pembagi-nol (average check) tetap
 * lewat lib/calc/kpi.ts, dipanggil SETELAH angka SQL didapat -- satu-
 * satunya tempat kpi.ts disentuh di file ini.
 *
 * Filter tanggal SELALU pakai orders.business_date, bukan created_at/
 * paid_at (CLAUDE.md §3.3). Order berstatus SELAIN 'paid' (termasuk
 * 'void') tidak pernah masuk agregasi manapun di sini -- 'refunded'
 * secara status tidak pernah dipakai kode manapun (T16 sengaja
 * membiarkan order tetap 'paid' setelah refund sebagian), jadi
 * status='paid' sudah tepat menangkap "order sah yang dihitung".
 *
 * Refund HANYA dikurangkan di getSalesSummary (net sales), sesuai
 * instruksi eksplisit. Breakdown per produk/kategori/kasir/metode/
 * saluran/jam SENGAJA TIDAK menetokan refund per baris -- itu perlu
 * join refund_items per baris, tidak diminta dan menambah kompleksitas
 * signifikan. Angkanya tetap nilai kotor-terjual (order tetap dihitung
 * utuh di breakdown itu, sama seperti tidak di-void).
 */

type Db = UserDbHandle["db"];

export type SalesReportFilter = {
  businessId: string;
  // string = satu outlet, string[] = beberapa outlet sekaligus (dipakai
  // saat menyaring per BRAND -- Indosteak/Indokopi masing-masing dua
  // outlet, lihat getSalesByBrand & dashboard §a 11 September 2026),
  // null = semua outlet bisnis ini.
  outletId: string | string[] | null;
  startDate: string; // business_date, 'yyyy-MM-dd'
  endDate: string;
};

function outletFilterClause(outletId: SalesReportFilter["outletId"]) {
  if (Array.isArray(outletId)) {
    // Array kosong (brand tanpa outlet aktif) HARUS tidak mengembalikan
    // apa pun -- inArray([]) di Drizzle menghasilkan SQL yang salah
    // (selalu true), jadi ditangani eksplisit di sini, bukan diserahkan
    // ke inArray() apa adanya.
    return outletId.length > 0 ? inArray(orders.outletId, outletId) : sql`false`;
  }
  return outletId ? eq(orders.outletId, outletId) : undefined;
}

function buildOrderFilter(f: SalesReportFilter) {
  return and(
    eq(orders.businessId, f.businessId),
    eq(orders.status, "paid"),
    gte(orders.businessDate, f.startDate),
    lte(orders.businessDate, f.endDate),
    outletFilterClause(f.outletId)
  );
}

// ---------------------------------------------------------------------
// 1. Ringkasan
// ---------------------------------------------------------------------

export type SalesSummary = {
  grossSales: string;
  discountTotal: string;
  refundTotal: string;
  netSales: string; // SUDAH dikurangi refund
  taxAmount: string;
  serviceCharge: string;
  orderCount: number;
  averageCheck: string | null;
};

export async function getSalesSummary(db: Db, filter: SalesReportFilter): Promise<SalesSummary> {
  const [row] = await db
    .select({
      grossSales: sql<string>`coalesce(sum(${orders.subtotal}), '0')`,
      discountTotal: sql<string>`coalesce(sum(${orders.discountTotal}), '0')`,
      netSales: sql<string>`coalesce(sum(${orders.netSales}), '0')`,
      taxAmount: sql<string>`coalesce(sum(${orders.taxAmount}), '0')`,
      serviceCharge: sql<string>`coalesce(sum(${orders.serviceCharge}), '0')`,
      orderCount: sql<string>`count(*)`,
    })
    .from(orders)
    .where(buildOrderFilter(filter));

  // refunds tidak punya kolom status/outlet_id sendiri -- join ke orders
  // supaya pakai filter yang sama persis.
  const [refundRow] = await db
    .select({ refundTotal: sql<string>`coalesce(sum(${refunds.amount}), '0')` })
    .from(refunds)
    .innerJoin(orders, eq(refunds.orderId, orders.id))
    .where(buildOrderFilter(filter));

  const netSales = new Decimal(row?.netSales ?? "0");
  const refundTotal = new Decimal(refundRow?.refundTotal ?? "0");
  const netSalesAfterRefund = netSales.minus(refundTotal);
  const orderCount = Number(row?.orderCount ?? "0");

  const avgCheck = averageCheck(netSalesAfterRefund, new Decimal(orderCount));

  return {
    grossSales: row?.grossSales ?? "0",
    discountTotal: row?.discountTotal ?? "0",
    refundTotal: refundTotal.toFixed(2),
    netSales: netSalesAfterRefund.toFixed(2),
    taxAmount: row?.taxAmount ?? "0",
    serviceCharge: row?.serviceCharge ?? "0",
    orderCount,
    averageCheck: avgCheck ? avgCheck.toFixed(2) : null,
  };
}

// ---------------------------------------------------------------------
// 2. Per produk
// ---------------------------------------------------------------------

export type SalesByProductRow = {
  productId: string | null;
  productName: string;
  qty: string;
  netAmount: string;
};

export async function getSalesByProduct(
  db: Db,
  filter: SalesReportFilter
): Promise<SalesByProductRow[]> {
  return db
    .select({
      productId: orderItems.productId,
      productName: orderItems.productName,
      qty: sql<string>`coalesce(sum(${orderItems.qty}), '0')`,
      netAmount: sql<string>`coalesce(sum(${orderItems.netAmount}), '0')`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(buildOrderFilter(filter))
    .groupBy(orderItems.productId, orderItems.productName)
    .orderBy(desc(sql`sum(${orderItems.netAmount})`));
}

// ---------------------------------------------------------------------
// 3. Per kategori
// ---------------------------------------------------------------------

export type SalesByCategoryRow = {
  categoryName: string | null; // null = produk tanpa kategori saat transaksi
  qty: string;
  netAmount: string;
};

export async function getSalesByCategory(
  db: Db,
  filter: SalesReportFilter
): Promise<SalesByCategoryRow[]> {
  return db
    .select({
      categoryName: orderItems.categoryName,
      qty: sql<string>`coalesce(sum(${orderItems.qty}), '0')`,
      netAmount: sql<string>`coalesce(sum(${orderItems.netAmount}), '0')`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(buildOrderFilter(filter))
    .groupBy(orderItems.categoryName)
    .orderBy(desc(sql`sum(${orderItems.netAmount})`));
}

// ---------------------------------------------------------------------
// 4. Per kasir
// ---------------------------------------------------------------------

export type SalesByCashierRow = {
  cashierId: string | null;
  cashierName: string | null; // null = order tanpa cashier_id (seharusnya tidak mungkin sejak T15)
  orderCount: number;
  netAmount: string;
};

export async function getSalesByCashier(
  db: Db,
  filter: SalesReportFilter
): Promise<SalesByCashierRow[]> {
  // Akun tamu bersama (TT09b): cashierName mengutamakan shifts.servedByName
  // kalau order ini berasal dari shift yang dibuka akun bersama -- tanpa
  // ini SEMUA transaksi lewat akun tamu (Rani pagi, Dimas malam, dst)
  // akan bertumpuk jadi SATU baris "Akun Tamu -- Bestie Thrift", padahal
  // laporan harus bisa membedakan siapa sungguhan bertugas. Grup per
  // (cashierId, nama-tampilan) -- karyawan bernama biasa (servedByName
  // selalu null) tidak berubah perilakunya sama sekali.
  const rows = await db
    .select({
      cashierId: orders.cashierId,
      cashierName: sql<string | null>`coalesce(${shifts.servedByName}, ${employees.fullName})`,
      orderCount: sql<string>`count(*)`,
      netAmount: sql<string>`coalesce(sum(${orders.netSales}), '0')`,
    })
    .from(orders)
    .leftJoin(employees, eq(orders.cashierId, employees.id))
    .leftJoin(shifts, eq(orders.shiftId, shifts.id))
    .where(buildOrderFilter(filter))
    .groupBy(orders.cashierId, sql`coalesce(${shifts.servedByName}, ${employees.fullName})`)
    .orderBy(desc(sql`sum(${orders.netSales})`));

  return rows.map((r) => ({ ...r, orderCount: Number(r.orderCount) }));
}

// ---------------------------------------------------------------------
// 5. Per metode pembayaran
// ---------------------------------------------------------------------

export type SalesByPaymentMethodRow = {
  methodName: string;
  amount: string;
};

export async function getSalesByPaymentMethod(
  db: Db,
  filter: SalesReportFilter
): Promise<SalesByPaymentMethodRow[]> {
  // amount - change_amount, BUKAN amount mentah -- pelajaran bug T15
  // (getShiftSalesSummary): amount adalah yang DITENDANG, bisa lebih
  // besar dari total kalau ada kembalian. Penjualan sesungguhnya per
  // metode adalah net-nya.
  return db
    .select({
      methodName: payments.methodName,
      amount: sql<string>`coalesce(sum(${payments.amount} - ${payments.changeAmount}), '0')`,
    })
    .from(payments)
    .innerJoin(orders, eq(payments.orderId, orders.id))
    .where(buildOrderFilter(filter))
    .groupBy(payments.methodName)
    .orderBy(desc(sql`sum(${payments.amount} - ${payments.changeAmount})`));
}

// ---------------------------------------------------------------------
// 6. Per saluran
// ---------------------------------------------------------------------

export type SalesByChannelRow = {
  channel: string;
  orderCount: number;
  netAmount: string;
};

export async function getSalesByChannel(
  db: Db,
  filter: SalesReportFilter
): Promise<SalesByChannelRow[]> {
  const rows = await db
    .select({
      channel: orders.channel,
      orderCount: sql<string>`count(*)`,
      netAmount: sql<string>`coalesce(sum(${orders.netSales}), '0')`,
    })
    .from(orders)
    .where(buildOrderFilter(filter))
    .groupBy(orders.channel)
    .orderBy(desc(sql`sum(${orders.netSales})`));

  return rows.map((r) => ({ ...r, orderCount: Number(r.orderCount) }));
}

// ---------------------------------------------------------------------
// 7. Per jam
// ---------------------------------------------------------------------

export type SalesByHourRow = {
  hour: number; // 0-23
  orderCount: number;
  total: string;
};

export async function getSalesByHour(
  db: Db,
  filter: SalesReportFilter
): Promise<SalesByHourRow[]> {
  const [business] = await db
    .select({ timezone: businesses.timezone })
    .from(businesses)
    .where(eq(businesses.id, filter.businessId));
  const timezone = business?.timezone ?? "Asia/Jakarta";

  // Zona waktu BISNIS, bukan server (CLAUDE.md §3.3) -- ${timezone} di
  // sini di-bind sebagai parameter oleh template sql Drizzle, bukan
  // string concat, jadi aman dari injection walau nilainya dinamis.
  //
  // GROUP BY/ORDER BY pakai POSISI kolom (`1`), bukan mengulang ekspresi
  // extract(...) -- Drizzle merender ${orders.paidAt} beda (dengan/tanpa
  // qualifier tabel) tergantung posisinya di query, jadi SELECT dan
  // GROUP BY yang seharusnya sama secara SQL malah dianggap Postgres
  // sebagai dua ekspresi berbeda ("column must appear in GROUP BY").
  // GROUP BY 1 kebal terhadap itu karena tidak mengulang teks ekspresinya.
  const rows = await db
    .select({
      hour: sql<string>`extract(hour from (${orders.paidAt} at time zone ${timezone}))`.mapWith(
        Number
      ),
      orderCount: sql<string>`count(*)`,
      total: sql<string>`coalesce(sum(${orders.total}), '0')`,
    })
    .from(orders)
    .where(buildOrderFilter(filter))
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  return rows.map((r) => ({ ...r, orderCount: Number(r.orderCount) }));
}

// ---------------------------------------------------------------------
// 8. Riwayat transaksi (raw listing, bukan agregasi -- paginasi)
// ---------------------------------------------------------------------

export type TransactionHistoryRow = {
  id: string;
  number: string;
  paidAt: Date | null;
  total: string;
  status: "paid" | "void";
  channel: string;
  paymentMethodNames: string[];
};

export type TransactionHistoryResult = {
  rows: TransactionHistoryRow[];
  totalCount: number;
};

/**
 * BEDA dari buildOrderFilter() di atas -- riwayat ini menampilkan order
 * 'void' juga (ditandai di UI), instruksi "kecualikan dari SEMUA
 * agregasi" berlaku untuk 7 breakdown angka, bukan listing mentah ini
 * (pola sama seperti /pos/receipt menampilkan order void, T16).
 */
export async function getTransactionHistory(
  db: Db,
  filter: SalesReportFilter,
  options: { search: string; page: number; pageSize: number }
): Promise<TransactionHistoryResult> {
  const whereClause = and(
    eq(orders.businessId, filter.businessId),
    inArray(orders.status, ["paid", "void"]),
    gte(orders.businessDate, filter.startDate),
    lte(orders.businessDate, filter.endDate),
    outletFilterClause(filter.outletId),
    options.search ? ilike(orders.number, `%${options.search}%`) : undefined
  );

  const [countRow] = await db
    .select({ count: sql<string>`count(*)` })
    .from(orders)
    .where(whereClause);

  const orderRows = await db
    .select()
    .from(orders)
    .where(whereClause)
    .orderBy(desc(orders.paidAt))
    .limit(options.pageSize)
    .offset((options.page - 1) * options.pageSize);

  const orderIds = orderRows.map((o) => o.id);
  const paymentRows = orderIds.length
    ? await db
        .select({ orderId: payments.orderId, methodName: payments.methodName })
        .from(payments)
        .where(inArray(payments.orderId, orderIds))
    : [];
  const methodsByOrder = new Map<string, string[]>();
  for (const p of paymentRows) {
    const list = methodsByOrder.get(p.orderId) ?? [];
    list.push(p.methodName);
    methodsByOrder.set(p.orderId, list);
  }

  return {
    rows: orderRows.map((o) => ({
      id: o.id,
      number: o.number,
      paidAt: o.paidAt,
      total: o.total,
      status: o.status as "paid" | "void",
      channel: o.channel,
      paymentMethodNames: methodsByOrder.get(o.id) ?? [],
    })),
    totalCount: Number(countRow?.count ?? "0"),
  };
}

// ---------------------------------------------------------------------
// 9. Per hari (tren, T18) -- beda dari breakdown lain: ORDER BY tanggal
//    ASC (kronologis untuk grafik), bukan ORDER BY nilai DESC.
// ---------------------------------------------------------------------

export type SalesByDayRow = {
  businessDate: string;
  orderCount: number;
  netSales: string;
};

/**
 * Refund TIDAK ditetokan per hari, sama seperti breakdown produk/kategori/
 * dst di atas -- ikut keputusan scoping T17 (refund cuma dikurangkan di
 * getSalesSummary), bukan pengecualian baru.
 */
export async function getSalesByDay(db: Db, filter: SalesReportFilter): Promise<SalesByDayRow[]> {
  const rows = await db
    .select({
      businessDate: orders.businessDate,
      orderCount: sql<string>`count(*)`,
      netSales: sql<string>`coalesce(sum(${orders.netSales}), '0')`,
    })
    .from(orders)
    .where(buildOrderFilter(filter))
    .groupBy(orders.businessDate)
    .orderBy(orders.businessDate);

  return rows.map((r) => ({ ...r, orderCount: Number(r.orderCount) }));
}

// ---------------------------------------------------------------------
// 10. Per outlet (perbandingan multi-outlet, T18)
// ---------------------------------------------------------------------

export type SalesByOutletRow = {
  outletId: string;
  outletName: string;
  orderCount: number;
  netSales: string;
};

/** Dipanggil dengan filter.outletId selalu null -- tujuannya justru melihat semua outlet sekaligus. */
export async function getSalesByOutlet(
  db: Db,
  filter: SalesReportFilter
): Promise<SalesByOutletRow[]> {
  const rows = await db
    .select({
      outletId: outlets.id,
      outletName: outlets.name,
      orderCount: sql<string>`count(*)`,
      netSales: sql<string>`coalesce(sum(${orders.netSales}), '0')`,
    })
    .from(orders)
    .innerJoin(outlets, eq(orders.outletId, outlets.id))
    .where(buildOrderFilter(filter))
    .groupBy(outlets.id, outlets.name)
    .orderBy(desc(sql`sum(${orders.netSales})`));

  return rows.map((r) => ({ ...r, orderCount: Number(r.orderCount) }));
}

// ---------------------------------------------------------------------
// 11. Per brand/jenis usaha (dashboard §a, 11 September 2026) -- instruksi
//    CEO: "Omzet Hari Ini" tidak boleh menggabung Indosteak/Indokopi/Barang
//    Titipan jadi satu angka. Indosteak & Indokopi masing-masing punya DUA
//    outlet -- menjumlah ke level brand dulu, baru diperinci ke outlet,
//    adalah arah yang alami (disetujui CEO), makanya fungsi ini yang
//    dipakai layar depan, bukan getSalesByOutlet.
// ---------------------------------------------------------------------

export type SalesByBrandRow = {
  brandId: string;
  brandName: string;
  outletIds: string[]; // dipakai membangun filter drill-down ke getSalesSummary/getSalesByOutlet
  orderCount: number;
  netSales: string;
};

/**
 * SATU BARIS PER BRAND, LEFT JOIN berantai brands -> outlets -> orders
 * (bukan dari `orders` seperti breakdown lain di file ini) -- brand
 * tanpa transaksi sama sekali di rentang ini TETAP muncul dengan Rp0,
 * bukan hilang dari daftar. Pelajaran yang sama baru saja ditegakkan di
 * Tinjau Kebersihan reportkoperumnasgroup: "yang tidak ada datanya
 * justru yang paling perlu kelihatan" -- brand yang omzetnya nol hari
 * ini justru yang paling perlu diperhatikan pemilik, bukan didiamkan
 * tak terlihat. Rantai LEFT JOIN ini TIDAK menggandakan baris order --
 * satu order cuma pernah py satu outlet, satu outlet cuma py satu
 * brand, jadi agregasi SQL biasa (bukan reduce di JS) tetap benar,
 * sesuai aturan file ini di komentar atas.
 */
export async function getSalesByBrand(
  db: Db,
  filter: Pick<SalesReportFilter, "businessId" | "startDate" | "endDate">
): Promise<SalesByBrandRow[]> {
  const rows = await db
    .select({
      brandId: brands.id,
      brandName: brands.name,
      outletIds: sql<
        (string | null)[]
      >`array_agg(distinct ${outlets.id}) filter (where ${outlets.id} is not null)`,
      orderCount: sql<string>`count(${orders.id})`,
      netSales: sql<string>`coalesce(sum(${orders.netSales}), '0')`,
    })
    .from(brands)
    .leftJoin(outlets, and(eq(outlets.brandId, brands.id), eq(outlets.isActive, true)))
    .leftJoin(
      orders,
      and(
        eq(orders.outletId, outlets.id),
        eq(orders.status, "paid"),
        gte(orders.businessDate, filter.startDate),
        lte(orders.businessDate, filter.endDate)
      )
    )
    .where(eq(brands.businessId, filter.businessId))
    .groupBy(brands.id, brands.name)
    .orderBy(desc(sql`coalesce(sum(${orders.netSales}), 0)`));

  return rows
    .map((r) => ({
      brandId: r.brandId,
      brandName: r.brandName,
      outletIds: (r.outletIds ?? []).filter((id): id is string => id !== null),
      orderCount: Number(r.orderCount),
      netSales: r.netSales,
    }))
    // Brand TANPA satu pun outlet AKTIF (mis. brand demo lama yang
    // seluruh outletnya sudah dinonaktifkan) bukan "jenis usaha" yang
    // relevan ditampilkan -- beda dengan brand yang punya outlet tapi
    // omzetnya nol hari ini (itu TETAP muncul, lihat komentar fungsi ini).
    .filter((r) => r.outletIds.length > 0);
}
