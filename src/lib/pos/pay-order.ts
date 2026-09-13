import { z } from "zod";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { Decimal } from "decimal.js";
import type { UserDbHandle } from "@/lib/db/client";
import {
  businesses,
  categories,
  devices,
  modifiers,
  orderChannelEnum,
  orders,
  orderItems,
  orderItemModifiers,
  outlets,
  paymentMethods,
  payments,
  priceTiers,
  products,
  productPrices,
  productVariants,
} from "@/lib/db/schema";
import { calculateOrder, type CalcLine, type CalcSettings } from "@/lib/calc/order-calculator";
import { assertRowsAffected } from "@/lib/db/errors";
import { businessDate } from "@/lib/utils/business-date";
import { generateId } from "@/lib/utils/id";
import { checkShiftSellability, getOpenShiftForDevice, getShiftSellabilityErrorMessage } from "@/lib/pos/shift";
import { id as strings } from "@/lib/i18n/id";

/**
 * payOrderWithDb() — logika inti T13, dipisah dari Server Action
 * pembungkusnya (app/(pos)/pos/actions.ts) supaya bisa dites langsung
 * dengan koneksi Drizzle yang sudah RLS-enforced (getUserDb(accessToken)),
 * tanpa perlu request Next.js sungguhan -- pola yang sama dengan
 * lib/auth/outlets.ts#listMyOutletsWithClient.
 *
 * Titik SATU-SATUNYA tempat keranjang (live) dibekukan jadi order
 * (snapshot) -- lihat docs/04-CATATAN-TEKNIS.md §9.
 *
 * Prinsip yang dijaga di sini:
 * - TIDAK PERCAYA angka dari klien. Klien cuma kirim "niat" (id produk/
 *   varian/modifier, qty, diskon, pembayaran) -- harga, nama produk/
 *   varian/kategori/modifier semua di-fetch ULANG dari DB di sini, lalu
 *   calculateOrder() dipanggil lagi di server untuk dapat angka final
 *   yang benar-benar disimpan. RLS (getUserDb) otomatis memfilter baris
 *   yang bukan milik bisnis ini -- kalau id yang dikirim klien tidak
 *   ketemu setelah fetch, itu sudah cukup jadi sinyal "tidak valid",
 *   tidak perlu exists-check terpisah.
 * - Idempotent lewat id yang di-generate client (CLAUDE.md §3.4: orders,
 *   order_items, payments wajib id dari client). Kalau orders.id ini
 *   sudah ada, dianggap submit ganda (double-tap) -- kembalikan hasil
 *   yang sudah ada, jangan proses ulang / jangan nomor struk baru.
 * - unit_cogs dan cogs_total DISENGAJA "0" -- skema resep/bahan belum
 *   ada (Fase 2), jadi belum ada cara menghitung HPP sungguhan. Ini
 *   BUKAN dianggap sudah benar, cuma placeholder sampai Fase 2.
 */

const lineSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullable(),
  modifierIds: z.array(z.string().uuid()),
  qty: z.string(),
  itemDiscount: z.string(),
  note: z.string(),
});

const paymentInputSchema = z.object({
  id: z.string().uuid(),
  paymentMethodId: z.string().uuid(),
  amount: z.string(),
  reference: z.string(), // opsional secara bisnis -- string kosong kalau tidak diisi/tidak relevan
});

export const payOrderSchema = z.object({
  orderId: z.string().uuid(),
  outletId: z.string().uuid(),
  deviceId: z.string().uuid(),
  priceTierId: z.string().uuid(),
  lines: z.array(lineSchema).min(1),
  discountType: z.enum(["none", "amount", "percent"]),
  orderDiscountAmount: z.string(),
  orderDiscountPercentInput: z.string(),
  payments: z.array(paymentInputSchema).min(1),
});

export type PayOrderInput = z.infer<typeof payOrderSchema>;

export type PayOrderResult = {
  error?: string;
  success?: {
    orderId: string;
    orderNumber: string;
    total: string;
    change: string;
  };
};

/**
 * channel order diturunkan dari price_tiers.channel (kolom itu text bebas,
 * bukan enum -- 'link ke sales channel', lihat schema.ts), bukan
 * di-hardcode. Tanpa ini order bisa terjual pakai harga GoFood tapi
 * tercatat sebagai dine_in, laporan per channel jadi salah. Kalau tier
 * tidak punya channel (mis. MEMBER) atau isinya bukan salah satu nilai
 * order_channel yang valid, default ke 'dine_in'.
 */
function resolveOrderChannel(
  priceTierChannel: string | null
): (typeof orderChannelEnum.enumValues)[number] {
  const validChannels: readonly string[] = orderChannelEnum.enumValues;
  if (priceTierChannel && validChannels.includes(priceTierChannel)) {
    return priceTierChannel as (typeof orderChannelEnum.enumValues)[number];
  }
  return "dine_in";
}

export async function payOrderWithDb(
  db: UserDbHandle["db"],
  businessId: string,
  rawInput: unknown
): Promise<PayOrderResult> {
  const parsed = payOrderSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: strings.common.unexpectedError };
  }
  const data = parsed.data;

  try {
    const [business] = await db
      .select({ timezone: businesses.timezone })
      .from(businesses)
      .where(eq(businesses.id, businessId));
    const [outlet] = await db
      .select()
      .from(outlets)
      .where(and(eq(outlets.id, data.outletId), eq(outlets.businessId, businessId)));
    const [device] = await db
      .select()
      .from(devices)
      .where(and(eq(devices.id, data.deviceId), eq(devices.businessId, businessId)));
    const [priceTier] = await db
      .select()
      .from(priceTiers)
      .where(and(eq(priceTiers.id, data.priceTierId), eq(priceTiers.businessId, businessId)));
    if (!business || !outlet || !device || !priceTier) {
      return { error: strings.common.unexpectedError };
    }

    // T15 gap fix: order harus terikat shift_id/cashier_id yang aktif.
    // Diturunkan dari deviceId yang sudah divalidasi di atas (bukan dari
    // input klien -- "tidak percaya angka dari klien", sama prinsipnya
    // dengan field lain di fungsi ini). Kalau device sedang tidak punya
    // shift yang bisa dipakai jualan (belum ada shift, shift sudah masuk
    // proses tutup / counted_cash terkunci, atau shift-nya basi --
    // businessDate bukan hari ini lagi, §14 prasyarat shift 13 September
    // 2026), pembayaran ditolak -- pertahanan berlapis, bukan cuma
    // andalkan gate UI di pos/page.tsx.
    const rawActiveShift = await getOpenShiftForDevice(db, businessId, data.deviceId);
    const sellabilityIssue = checkShiftSellability(rawActiveShift, business.timezone, outlet.dayCutoffTime);
    if (sellabilityIssue !== null) {
      return { error: getShiftSellabilityErrorMessage(sellabilityIssue) };
    }
    const activeShift = rawActiveShift!;

    // --- Fetch ulang produk/varian/modifier/harga dari DB (bukan dari klien) ---
    const productIds = [...new Set(data.lines.map((l) => l.productId))];
    const variantIds = [
      ...new Set(data.lines.map((l) => l.variantId).filter((v): v is string => v != null)),
    ];
    const modifierIds = [...new Set(data.lines.flatMap((l) => l.modifierIds))];
    const paymentMethodIds = [...new Set(data.payments.map((p) => p.paymentMethodId))];

    const productRows = productIds.length
      ? await db
          .select({
            id: products.id,
            name: products.name,
            categoryName: categories.name,
            isTaxable: products.isTaxable,
          })
          .from(products)
          .leftJoin(categories, eq(products.categoryId, categories.id))
          .where(and(inArray(products.id, productIds), eq(products.businessId, businessId)))
      : [];
    const productById = new Map(productRows.map((p) => [p.id, p]));

    const variantRows = variantIds.length
      ? await db
          .select()
          .from(productVariants)
          .where(inArray(productVariants.id, variantIds))
      : [];
    const variantById = new Map(variantRows.map((v) => [v.id, v]));

    const priceRows = productIds.length
      ? await db
          .select({ productId: productPrices.productId, price: productPrices.price })
          .from(productPrices)
          .where(
            and(
              inArray(productPrices.productId, productIds),
              eq(productPrices.priceTierId, data.priceTierId),
              isNull(productPrices.variantId)
            )
          )
      : [];
    const priceByProductId = new Map(priceRows.map((p) => [p.productId, p.price]));

    const modifierRows = modifierIds.length
      ? await db.select().from(modifiers).where(inArray(modifiers.id, modifierIds))
      : [];
    const modifierById = new Map(modifierRows.map((m) => [m.id, m]));

    const paymentMethodRows = paymentMethodIds.length
      ? await db
          .select()
          .from(paymentMethods)
          .where(
            and(
              inArray(paymentMethods.id, paymentMethodIds),
              eq(paymentMethods.businessId, businessId)
            )
          )
      : [];
    const paymentMethodById = new Map(paymentMethodRows.map((pm) => [pm.id, pm]));

    // Validasi kelengkapan: kalau ada id yang dikirim klien tapi tidak
    // ketemu setelah fetch (RLS + filter businessId), datanya tidak valid.
    for (const line of data.lines) {
      if (!productById.has(line.productId)) {
        return { error: strings.common.unexpectedError };
      }
      if (line.variantId && !variantById.has(line.variantId)) {
        return { error: strings.common.unexpectedError };
      }
      if (!priceByProductId.has(line.productId)) {
        return { error: strings.common.unexpectedError };
      }
      for (const modifierId of line.modifierIds) {
        if (!modifierById.has(modifierId)) {
          return { error: strings.common.unexpectedError };
        }
      }
    }
    for (const payment of data.payments) {
      if (!paymentMethodById.has(payment.paymentMethodId)) {
        return { error: strings.common.unexpectedError };
      }
    }

    // --- Bangun CalcLine[] dari data yang sudah diverifikasi, panggil
    // calculateOrder() ULANG di server -- ini yang benar-benar disimpan. ---
    const calcLines: CalcLine[] = data.lines.map((line) => {
      const basePrice = new Decimal(priceByProductId.get(line.productId)!);
      const variant = line.variantId ? variantById.get(line.variantId) : undefined;
      const variantDelta = variant ? new Decimal(variant.priceDelta) : new Decimal(0);
      const modifierTotal = line.modifierIds.reduce(
        (sum, mId) => sum.plus(modifierById.get(mId)!.price),
        new Decimal(0)
      );
      return {
        id: line.id,
        qty: new Decimal(line.qty),
        unitPrice: basePrice.plus(variantDelta),
        modifierTotal,
        itemDiscount: new Decimal(line.itemDiscount),
        isTaxable: productById.get(line.productId)!.isTaxable,
      };
    });

    const calcSettings: CalcSettings = {
      discountType: data.discountType,
      orderDiscountPercent: new Decimal(data.orderDiscountPercentInput).dividedBy(100),
      orderDiscountAmount: new Decimal(data.orderDiscountAmount),
      maxDiscount: null,
      serviceChargePercent: new Decimal(outlet.serviceChargePercent).dividedBy(100),
      taxPercent: new Decimal(outlet.taxPercent).dividedBy(100),
      taxInclusive: outlet.taxInclusive,
      serviceChargeInTaxBase: outlet.serviceChargeInTaxBase,
      roundingTo: outlet.roundingTo,
      roundingMode: "nearest",
    };

    const result = calculateOrder(calcLines, calcSettings);
    const resultByLineId = new Map(result.lines.map((l) => [l.id, l]));

    const totalReceived = data.payments.reduce(
      (sum, p) => sum.plus(new Decimal(p.amount)),
      new Decimal(0)
    );
    if (totalReceived.lessThan(result.total)) {
      return { error: strings.pos.insufficientPayment };
    }
    const change = totalReceived.minus(result.total);

    const now = new Date();
    const bDate = businessDate(now, business.timezone, outlet.dayCutoffTime);

    let orderNumber = "";

    await db.transaction(async (tx) => {
      // Idempotency: kalau order ini sudah pernah disimpan (double-tap),
      // jangan proses ulang -- ambil hasil yang sudah ada.
      const [existing] = await tx
        .select({ number: orders.number })
        .from(orders)
        .where(eq(orders.id, data.orderId));
      if (existing) {
        orderNumber = existing.number;
        return;
      }

      // Nomor struk: {OUTLET}-{YYMMDD}-{DEVICE}-{COUNTER}. Increment
      // device.last_seq atomik di dalam transaction yang sama supaya
      // gagal di tengah jalan tidak menyisakan counter yang sudah maju
      // tapi order-nya tidak pernah tersimpan.
      const updatedDeviceRows = await tx
        .update(devices)
        .set({ lastSeq: sql`${devices.lastSeq} + 1` })
        .where(eq(devices.id, data.deviceId))
        .returning({ lastSeq: devices.lastSeq, serialNumber: devices.serialNumber });
      assertRowsAffected(updatedDeviceRows, "perangkat (nomor struk)");
      const updatedDevice = updatedDeviceRows[0];
      const yymmdd = bDate.slice(2).replaceAll("-", "");
      const counter = String(updatedDevice!.lastSeq).padStart(4, "0");
      orderNumber = `${outlet.code}-${yymmdd}-${updatedDevice!.serialNumber}-${counter}`;

      await tx.insert(orders).values({
        id: data.orderId,
        businessId,
        outletId: data.outletId,
        deviceId: data.deviceId,
        shiftId: activeShift.id,
        cashierId: activeShift.employeeId,
        number: orderNumber,
        status: "paid",
        channel: resolveOrderChannel(priceTier.channel),
        priceTierId: data.priceTierId,
        subtotal: result.subtotal.toFixed(2),
        itemDiscount: result.itemDiscountTotal.toFixed(2),
        orderDiscount: result.orderDiscount.toFixed(2),
        discountTotal: result.discountTotal.toFixed(2),
        netSales: result.netSales.toFixed(2),
        serviceCharge: result.serviceCharge.toFixed(2),
        taxAmount: result.taxAmount.toFixed(2),
        rounding: result.rounding.toFixed(2),
        total: result.total.toFixed(2),
        // cogsTotal/grossProfit: HPP sungguhan belum bisa dihitung (belum
        // ada skema resep/bahan, Fase 2) -- 0 sementara, lihat komentar
        // di atas fungsi ini.
        cogsTotal: "0",
        grossProfit: result.netSales.toFixed(2),
        businessDate: bDate,
        paidAt: now,
      });

      for (const [index, line] of data.lines.entries()) {
        const product = productById.get(line.productId)!;
        const variant = line.variantId ? variantById.get(line.variantId) : undefined;
        const lineResult = resultByLineId.get(line.id)!;

        await tx.insert(orderItems).values({
          id: line.id,
          orderId: data.orderId,
          productId: line.productId,
          variantId: line.variantId,
          // SNAPSHOT -- dibekukan di sini, tidak pernah berubah lagi
          // walau produk aslinya diedit/dihapus setelah ini (CLAUDE.md §3.2).
          productName: product.name,
          variantName: variant?.name ?? null,
          categoryName: product.categoryName,
          qty: line.qty,
          unitPrice: calcLines.find((c) => c.id === line.id)!.unitPrice.toFixed(2),
          modifierTotal: calcLines.find((c) => c.id === line.id)!.modifierTotal.toFixed(2),
          grossAmount: lineResult.grossAmount.toFixed(2),
          discountAmount: lineResult.itemDiscount.toFixed(2),
          allocatedOrderDiscount: lineResult.allocatedOrderDiscount.toFixed(2),
          netAmount: lineResult.netAmount.toFixed(2),
          unitCogs: "0", // lihat catatan cogsTotal di atas
          cogsAmount: "0",
          note: line.note || null,
          sortOrder: index,
        });

        for (const modifierId of line.modifierIds) {
          const modifier = modifierById.get(modifierId)!;
          await tx.insert(orderItemModifiers).values({
            id: generateId(),
            orderItemId: line.id,
            modifierId,
            modifierName: modifier.name, // SNAPSHOT, sama alasannya dengan order_items
            price: modifier.price,
            qty: "1",
            unitCogs: "0",
          });
        }
      }

      for (const [index, payment] of data.payments.entries()) {
        const method = paymentMethodById.get(payment.paymentMethodId)!;
        const isLast = index === data.payments.length - 1;
        await tx.insert(payments).values({
          id: payment.id,
          orderId: data.orderId,
          paymentMethodId: payment.paymentMethodId,
          methodName: method.name, // SNAPSHOT
          amount: payment.amount,
          receivedAmount: payment.amount,
          changeAmount: isLast ? change.toFixed(2) : "0",
          reference: payment.reference.trim() || null,
          status: "success",
          paidAt: now,
        });
      }
    });

    return {
      success: {
        orderId: data.orderId,
        orderNumber,
        total: result.total.toFixed(2),
        change: change.toFixed(2),
      },
    };
  } catch (err) {
    console.error("payOrderWithDb gagal:", err);
    return { error: strings.common.unexpectedError };
  }
}
