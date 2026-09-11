import { and, asc, eq, inArray } from "drizzle-orm";
import type { UserDbHandle } from "@/lib/db/client";
import {
  businesses,
  employees,
  orderItemModifiers,
  orderItems,
  orders,
  outlets,
  payments,
  shifts,
} from "@/lib/db/schema";
import type { OrderForReceipt } from "@/lib/printing/receipt-template";

type Db = UserDbHandle["db"];

async function assemble(
  db: Db,
  businessId: string,
  orderRow: typeof orders.$inferSelect
): Promise<OrderForReceipt> {
  const [business] = await db
    .select({ name: businesses.name, timezone: businesses.timezone })
    .from(businesses)
    .where(eq(businesses.id, businessId));
  const [outlet] = await db
    .select({ name: outlets.name, address: outlets.address, phone: outlets.phone })
    .from(outlets)
    .where(eq(outlets.id, orderRow.outletId));

  let cashierName: string | null = null;
  if (orderRow.cashierId) {
    const [cashier] = await db
      .select({ fullName: employees.fullName })
      .from(employees)
      .where(eq(employees.id, orderRow.cashierId));
    cashierName = cashier?.fullName ?? null;
  }
  // Akun tamu bersama (TT09b) -- kalau order ini lahir dari shift yang
  // dibuka akun bersama, struk menyebut nama pelayan sungguhan
  // (shifts.servedByName), bukan literal nama akun tamu. Shift F&B biasa
  // (servedByName selalu null): tidak berubah sama sekali.
  if (orderRow.shiftId) {
    const [shift] = await db
      .select({ servedByName: shifts.servedByName })
      .from(shifts)
      .where(eq(shifts.id, orderRow.shiftId));
    if (shift?.servedByName) {
      cashierName = shift.servedByName;
    }
  }

  const itemRows = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, orderRow.id))
    .orderBy(asc(orderItems.sortOrder));

  const itemIds = itemRows.map((i) => i.id);
  const modifierRows = itemIds.length
    ? await db
        .select()
        .from(orderItemModifiers)
        .where(inArray(orderItemModifiers.orderItemId, itemIds))
    : [];
  const modifiersByItem = new Map<string, typeof modifierRows>();
  for (const m of modifierRows) {
    const list = modifiersByItem.get(m.orderItemId) ?? [];
    list.push(m);
    modifiersByItem.set(m.orderItemId, list);
  }

  const paymentRows = await db
    .select()
    .from(payments)
    .where(eq(payments.orderId, orderRow.id))
    .orderBy(asc(payments.paidAt));

  return {
    business: { name: business?.name ?? "", timezone: business?.timezone ?? "Asia/Jakarta" },
    outlet: {
      name: outlet?.name ?? "",
      address: outlet?.address ?? null,
      phone: outlet?.phone ?? null,
    },
    order: {
      number: orderRow.number,
      channel: orderRow.channel,
      businessDate: orderRow.businessDate,
      paidAt: orderRow.paidAt,
      subtotal: orderRow.subtotal,
      itemDiscount: orderRow.itemDiscount,
      orderDiscount: orderRow.orderDiscount,
      serviceCharge: orderRow.serviceCharge,
      taxAmount: orderRow.taxAmount,
      rounding: orderRow.rounding,
      total: orderRow.total,
    },
    cashierName,
    items: itemRows.map((item) => ({
      productName: item.productName,
      variantName: item.variantName,
      qty: item.qty,
      unitPrice: item.unitPrice,
      netAmount: item.netAmount,
      note: item.note,
      modifiers: (modifiersByItem.get(item.id) ?? []).map((m) => ({
        modifierName: m.modifierName,
        price: m.price,
      })),
    })),
    payments: paymentRows.map((p) => ({
      methodName: p.methodName,
      amount: p.amount,
      receivedAmount: p.receivedAmount,
      changeAmount: p.changeAmount,
      reference: p.reference,
    })),
  };
}

/**
 * Dipakai halaman struk utama (app/(pos)/receipt/[orderId]/page.tsx) --
 * baik cetak pertama kali (setelah bayar) maupun cetak ulang lewat link
 * langsung, keduanya lewat fungsi yang sama (snapshot order_items, bukan
 * katalog -- docs/03-CALC-SPEC.md, CLAUDE.md §3.2).
 */
export async function getOrderForReceiptById(
  db: Db,
  businessId: string,
  orderId: string
): Promise<OrderForReceipt | null> {
  const [orderRow] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.businessId, businessId)));
  if (!orderRow) {
    return null;
  }
  return assemble(db, businessId, orderRow);
}
