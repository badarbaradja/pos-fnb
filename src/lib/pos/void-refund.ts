import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { Decimal } from "decimal.js";
import type { UserDbHandle } from "@/lib/db/client";
import {
  auditLogs,
  businesses,
  employees,
  orderItems,
  orders,
  outlets,
  paymentMethods,
  refundItems,
  refunds,
  shifts,
} from "@/lib/db/schema";
import { businessDate } from "@/lib/utils/business-date";
import { generateId } from "@/lib/utils/id";
import { id as strings } from "@/lib/i18n/id";

/**
 * lib/pos/void-refund.ts — logika inti T16, pola thin-wrapper yang sama
 * dengan lib/pos/pay-order.ts dan lib/pos/shift.ts (testable tanpa
 * request Next.js sungguhan, dipisah dari Server Action pembungkus di
 * app/(pos)/pos/receipt/actions.ts).
 *
 * Dua aturan anti-fraud ditegakkan di SETIAP fungsi tulis di file ini,
 * bukan cuma di UI:
 * 1. Shift order itu harus masih 'open'. Shift yang sudah closed berarti
 *    kasir sudah commit ke angka rekonsiliasinya (T15) -- void/refund
 *    sesudahnya akan mengubah laporan yang sudah "disegel".
 * 2. Refund tidak pernah diasumsikan tunai -- metode pengembalian dipilih
 *    eksplisit dari daftar yang SAMA dengan yang dipakai getPosCatalog()
 *    (difilter cashEnabled), supaya outlet cashless (T15 lanjutan) tidak
 *    bisa memilih metode tunai untuk refund juga.
 */

type Db = UserDbHandle["db"];

/**
 * Order tanpa shiftId (seharusnya tidak mungkin lagi sejak T15, tapi
 * defensif) atau shift yang bukan 'open' dianggap sama-sama "tidak bisa
 * dibuktikan masih aktif" -- ditolak, bukan diberi pengecualian.
 */
async function isOrderShiftOpen(db: Db, orderShiftId: string | null): Promise<boolean> {
  if (!orderShiftId) return false;
  const [shift] = await db
    .select({ status: shifts.status })
    .from(shifts)
    .where(eq(shifts.id, orderShiftId));
  return shift?.status === "open";
}

/**
 * Void/refund dilakukan dari /pos/receipt, digerbangi requirePermissionDb
 * (sesi Supabase Auth owner/manajer) -- BUKAN sesi PIN kasir seperti buka
 * shift (T15). Tidak ada jaminan user itu punya baris employees sama
 * sekali. Best-effort: cari lewat employees.user_id kalau ketemu, kalau
 * tidak biarkan null -- audit log tetap tercatat lengkap (businessId,
 * aksi, kapan, alasan), cuma atribusi karyawannya kosong.
 */
export async function resolveEmployeeIdForUser(
  db: Db,
  businessId: string,
  userId: string
): Promise<string | null> {
  const [employee] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.businessId, businessId), eq(employees.userId, userId)));
  return employee?.id ?? null;
}

// ---------------------------------------------------------------------
// Void
// ---------------------------------------------------------------------

export const voidOrderSchema = z.object({
  orderId: z.string().uuid(),
  reason: z.string().min(1),
});

export type VoidOrderResult = { error?: string; success?: { voidedAt: string } };

export async function voidOrderWithDb(
  db: Db,
  businessId: string,
  employeeId: string | null,
  rawInput: unknown
): Promise<VoidOrderResult> {
  const parsed = voidOrderSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: strings.common.unexpectedError };
  }
  const data = parsed.data;

  try {
    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, data.orderId), eq(orders.businessId, businessId)));
    if (!order) {
      return { error: strings.common.unexpectedError };
    }
    if (order.status !== "paid") {
      return { error: strings.voidRefund.orderNotVoidableError };
    }
    if (!(await isOrderShiftOpen(db, order.shiftId))) {
      return { error: strings.voidRefund.shiftClosedError };
    }

    const now = new Date();
    let voided = false;

    await db.transaction(async (tx) => {
      const updated = await tx
        .update(orders)
        .set({ status: "void", voidReason: data.reason })
        .where(and(eq(orders.id, data.orderId), eq(orders.status, "paid")))
        .returning({ id: orders.id });
      if (updated.length === 0) {
        return;
      }
      voided = true;

      await tx.insert(auditLogs).values({
        id: generateId(),
        businessId,
        outletId: order.outletId,
        employeeId,
        action: "void",
        refType: "order",
        refId: order.id,
        reason: data.reason,
        metadata: { orderNumber: order.number, total: order.total },
        createdAt: now,
      });
    });

    if (!voided) {
      return { error: strings.voidRefund.orderNotVoidableError };
    }

    return { success: { voidedAt: now.toISOString() } };
  } catch (err) {
    console.error("voidOrderWithDb gagal:", err);
    return { error: strings.common.unexpectedError };
  }
}

// ---------------------------------------------------------------------
// Refund
// ---------------------------------------------------------------------

export type RefundPaymentMethod = {
  id: string;
  name: string;
  isCashDrawer: boolean;
  requiresRef: boolean;
};

/**
 * Daftar metode pengembalian dana -- SAMA filternya dengan
 * getPosCatalog() (src/app/(pos)/pos/get-pos-catalog.ts): outlet
 * cashless (cash_enabled = false) tidak menampilkan metode tunai sama
 * sekali. Dipakai dialog refund untuk isi pilihan, dan dipakai ULANG di
 * refundOrderWithDb untuk validasi server-side -- satu sumber kebenaran.
 */
export async function getRefundPaymentMethods(
  db: Db,
  businessId: string,
  outletId: string
): Promise<RefundPaymentMethod[]> {
  const [outlet] = await db
    .select({ cashEnabled: outlets.cashEnabled })
    .from(outlets)
    .where(eq(outlets.id, outletId));

  let rows = await db
    .select()
    .from(paymentMethods)
    .where(and(eq(paymentMethods.businessId, businessId), eq(paymentMethods.isActive, true)));

  if (!outlet?.cashEnabled) {
    rows = rows.filter((pm) => !pm.isCashDrawer);
  }

  return rows.map((pm) => ({
    id: pm.id,
    name: pm.name,
    isCashDrawer: pm.isCashDrawer,
    requiresRef: pm.requiresRef,
  }));
}

export type RefundableItem = {
  orderItemId: string;
  productName: string;
  variantName: string | null;
  qty: string; // qty asli dibeli
  netAmount: string; // net_amount asli baris ini
  refundedQty: string; // sudah direfund sebelumnya (semua refund)
};

/** Dipakai dialog refund untuk tahu qty yang masih bisa direfund per baris. */
export async function getOrderItemsForRefund(
  db: Db,
  businessId: string,
  orderId: string
): Promise<RefundableItem[]> {
  const itemRows = await db
    .select({
      id: orderItems.id,
      productName: orderItems.productName,
      variantName: orderItems.variantName,
      qty: orderItems.qty,
      netAmount: orderItems.netAmount,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(and(eq(orderItems.orderId, orderId), eq(orders.businessId, businessId)));

  const itemIds = itemRows.map((r) => r.id);
  const refundedRows = itemIds.length
    ? await db
        .select({ orderItemId: refundItems.orderItemId, qty: refundItems.qty })
        .from(refundItems)
        .where(inArray(refundItems.orderItemId, itemIds))
    : [];

  const refundedByItem = new Map<string, Decimal>();
  for (const r of refundedRows) {
    const sum = refundedByItem.get(r.orderItemId) ?? new Decimal(0);
    refundedByItem.set(r.orderItemId, sum.plus(r.qty));
  }

  return itemRows.map((r) => ({
    orderItemId: r.id,
    productName: r.productName,
    variantName: r.variantName,
    qty: r.qty,
    netAmount: r.netAmount,
    refundedQty: (refundedByItem.get(r.id) ?? new Decimal(0)).toFixed(4),
  }));
}

const refundLineSchema = z.object({
  orderItemId: z.string().uuid(),
  qty: z.string(),
});

export const refundOrderSchema = z.object({
  id: z.string().uuid(), // client-generated, pola sama dengan orders/payments (idempotency)
  orderId: z.string().uuid(),
  paymentMethodId: z.string().uuid(),
  reference: z.string(),
  restock: z.boolean(),
  reason: z.string().min(1),
  lines: z.array(refundLineSchema).min(1),
});

export type RefundOrderResult = { error?: string; success?: { refundId: string; amount: string } };

export async function refundOrderWithDb(
  db: Db,
  businessId: string,
  employeeId: string | null,
  rawInput: unknown
): Promise<RefundOrderResult> {
  const parsed = refundOrderSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: strings.common.unexpectedError };
  }
  const data = parsed.data;

  try {
    const [existingRefund] = await db.select({ id: refunds.id }).from(refunds).where(eq(refunds.id, data.id));
    if (existingRefund) {
      return { error: strings.voidRefund.duplicateRefundError };
    }

    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, data.orderId), eq(orders.businessId, businessId)));
    if (!order) {
      return { error: strings.common.unexpectedError };
    }
    if (order.status !== "paid") {
      return { error: strings.voidRefund.orderNotRefundableError };
    }
    if (!(await isOrderShiftOpen(db, order.shiftId))) {
      return { error: strings.voidRefund.shiftClosedError };
    }

    const [business] = await db
      .select({ timezone: businesses.timezone })
      .from(businesses)
      .where(eq(businesses.id, businessId));
    const [outlet] = await db
      .select({ dayCutoffTime: outlets.dayCutoffTime, cashEnabled: outlets.cashEnabled })
      .from(outlets)
      .where(eq(outlets.id, order.outletId));
    if (!business || !outlet) {
      return { error: strings.common.unexpectedError };
    }

    const [method] = await db
      .select()
      .from(paymentMethods)
      .where(and(eq(paymentMethods.id, data.paymentMethodId), eq(paymentMethods.businessId, businessId)));
    if (!method) {
      return { error: strings.common.unexpectedError };
    }
    // Defense-in-depth -- outlet cashless tidak boleh refund tunai, sama
    // filter yang dipakai getRefundPaymentMethods()/getPosCatalog().
    if (!outlet.cashEnabled && method.isCashDrawer) {
      return { error: strings.voidRefund.cashMethodDisabledError };
    }

    // Fetch order_items yang diminta, pastikan benar milik order ini.
    const orderItemIds = data.lines.map((l) => l.orderItemId);
    const itemRows = await db
      .select()
      .from(orderItems)
      .where(and(inArray(orderItems.id, orderItemIds), eq(orderItems.orderId, data.orderId)));
    const itemById = new Map(itemRows.map((i) => [i.id, i]));
    for (const line of data.lines) {
      if (!itemById.has(line.orderItemId)) {
        return { error: strings.common.unexpectedError };
      }
    }

    // Qty yang sudah direfund sebelumnya, per order_item (lintas semua
    // refund lain untuk order ini) -- konservasi kuantitas, tidak boleh
    // me-refund qty yang sama dua kali.
    const alreadyRefundedRows = orderItemIds.length
      ? await db
          .select({ orderItemId: refundItems.orderItemId, qty: refundItems.qty })
          .from(refundItems)
          .where(inArray(refundItems.orderItemId, orderItemIds))
      : [];
    const alreadyRefundedByItem = new Map<string, Decimal>();
    for (const r of alreadyRefundedRows) {
      const sum = alreadyRefundedByItem.get(r.orderItemId) ?? new Decimal(0);
      alreadyRefundedByItem.set(r.orderItemId, sum.plus(r.qty));
    }

    const refundItemValues: { orderItemId: string; qty: string; amount: string }[] = [];
    let totalRefundAmount = new Decimal(0);

    for (const line of data.lines) {
      const item = itemById.get(line.orderItemId)!;
      const qtyToRefund = new Decimal(line.qty);
      if (qtyToRefund.lessThanOrEqualTo(0)) {
        return { error: strings.common.unexpectedError };
      }
      const originalQty = new Decimal(item.qty);
      const alreadyRefunded = alreadyRefundedByItem.get(item.id) ?? new Decimal(0);
      if (qtyToRefund.plus(alreadyRefunded).greaterThan(originalQty)) {
        return { error: strings.voidRefund.qtyExceedsRemainingError };
      }

      // Nominal dari order_items.net_amount, proporsional terhadap qty
      // yang direfund -- TIDAK dihitung ulang dari harga katalog
      // (CLAUDE.md §3.1, diminta eksplisit).
      const netAmount = new Decimal(item.netAmount);
      const lineRefundAmount = netAmount.times(qtyToRefund).dividedBy(originalQty).toDecimalPlaces(2);
      totalRefundAmount = totalRefundAmount.plus(lineRefundAmount);

      refundItemValues.push({
        orderItemId: item.id,
        qty: qtyToRefund.toFixed(4),
        amount: lineRefundAmount.toFixed(2),
      });
    }

    // Total refund order ini (akumulasi dari refund SEBELUMNYA + refund
    // ini) tidak boleh melebihi total yang dibayar -- tegak di server,
    // termasuk akumulasi (diminta eksplisit).
    const previousRefundRows = await db
      .select({ amount: refunds.amount })
      .from(refunds)
      .where(eq(refunds.orderId, data.orderId));
    const previousRefundTotal = previousRefundRows.reduce(
      (sum, r) => sum.plus(r.amount),
      new Decimal(0)
    );
    const orderTotal = new Decimal(order.total);
    if (previousRefundTotal.plus(totalRefundAmount).greaterThan(orderTotal)) {
      return { error: strings.voidRefund.refundExceedsTotalError };
    }

    const now = new Date();
    const bDate = businessDate(now, business.timezone, outlet.dayCutoffTime);
    const refundId = data.id;

    await db.transaction(async (tx) => {
      await tx.insert(refunds).values({
        id: refundId,
        orderId: data.orderId,
        amount: totalRefundAmount.toFixed(2),
        // Reversal stok belum diproses -- inventori baru ada di Fase 2.
        // Nilai disimpan apa adanya sekarang, pemrosesannya menyusul di
        // T25.
        restock: data.restock,
        reason: data.reason,
        approvedBy: employeeId,
        businessDate: bDate,
        paymentMethodId: data.paymentMethodId,
        reference: data.reference.trim() || null,
        createdAt: now,
      });

      for (const line of refundItemValues) {
        await tx.insert(refundItems).values({
          id: generateId(),
          refundId,
          orderItemId: line.orderItemId,
          qty: line.qty,
          amount: line.amount,
        });
      }

      await tx.insert(auditLogs).values({
        id: generateId(),
        businessId,
        outletId: order.outletId,
        employeeId,
        action: "refund",
        refType: "refund",
        refId: refundId,
        reason: data.reason,
        metadata: { orderId: data.orderId, amount: totalRefundAmount.toFixed(2) },
        createdAt: now,
      });
    });

    return { success: { refundId, amount: totalRefundAmount.toFixed(2) } };
  } catch (err) {
    console.error("refundOrderWithDb gagal:", err);
    return { error: strings.common.unexpectedError };
  }
}
