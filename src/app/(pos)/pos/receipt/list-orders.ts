import { and, desc, eq, ilike, inArray } from "drizzle-orm";
import type { UserDbHandle } from "@/lib/db/client";
import { businesses, orders, payments } from "@/lib/db/schema";
import { businessDate } from "@/lib/utils/business-date";

type Db = UserDbHandle["db"];

export type OrderListRow = {
  id: string;
  number: string;
  paidAt: Date | null;
  total: string;
  channel: string;
  status: "paid" | "void";
  paymentMethodNames: string[]; // bisa lebih dari satu kalau split payment
};

async function attachPaymentMethods(
  db: Db,
  orderRows: (typeof orders.$inferSelect)[]
): Promise<OrderListRow[]> {
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

  return orderRows.map((o) => ({
    id: o.id,
    number: o.number,
    paidAt: o.paidAt,
    total: o.total,
    channel: o.channel,
    // Query pemanggil selalu filter status ke ("paid","void") -- lihat
    // listTodaysOrders/searchOrdersByNumber.
    status: o.status as "paid" | "void",
    paymentMethodNames: methodsByOrder.get(o.id) ?? [],
  }));
}

export async function getBusinessTimezone(db: Db, businessId: string): Promise<string> {
  const [business] = await db
    .select({ timezone: businesses.timezone })
    .from(businesses)
    .where(eq(businesses.id, businessId));
  return business?.timezone ?? "Asia/Jakarta";
}

/**
 * Alat kerja kasir untuk cetak ulang (T14) -- BUKAN laporan penjualan
 * (itu T17). Sengaja dibatasi transaksi hari operasional berjalan
 * (business_date, bukan tanggal kalender server -- CLAUDE.md §3.3), supaya
 * daftarnya tetap pendek dan relevan buat kasir yang sedang kerja, bukan
 * daftar semua transaksi sepanjang masa.
 *
 * `outletId`/`dayCutoffTime` WAJIB dari lib/pos/device-pairing.ts#getPairedDevice
 * (T22e) -- fungsi ini tidak lagi menebak outlet sendiri.
 */
export async function listTodaysOrders(
  db: Db,
  businessId: string,
  outletId: string,
  dayCutoffTime: string,
  timezone: string
): Promise<OrderListRow[]> {
  const today = businessDate(new Date(), timezone, dayCutoffTime);

  const orderRows = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.businessId, businessId),
        eq(orders.outletId, outletId),
        eq(orders.businessDate, today),
        // Order void tetap DITAMPILKAN (ditandai jelas di UI, T16) --
        // cuma tidak lagi ikut ke agregasi manapun, karena setiap
        // agregasi (lib/pos/shift.ts, dst.) filter status='paid' saja.
        inArray(orders.status, ["paid", "void"])
      )
    )
    .orderBy(desc(orders.paidAt));

  return attachPaymentMethods(db, orderRows);
}

/**
 * Pencarian nomor struk -- opsional, dipakai buat cari transaksi LAMA (di
 * luar hari ini). Cocok sebagian (ILIKE), tidak dibatasi business_date.
 * Dibatasi 50 hasil supaya tetap ringkas -- ini bukan tabel laporan
 * dengan paginasi (T17), cukup untuk kasir cari satu struk tertentu.
 */
export async function searchOrdersByNumber(
  db: Db,
  businessId: string,
  query: string
): Promise<OrderListRow[]> {
  const orderRows = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.businessId, businessId),
        inArray(orders.status, ["paid", "void"]),
        ilike(orders.number, `%${query}%`)
      )
    )
    .orderBy(desc(orders.paidAt))
    .limit(50);

  return attachPaymentMethods(db, orderRows);
}
