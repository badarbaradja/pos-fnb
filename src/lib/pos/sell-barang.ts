import { z } from "zod";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Decimal } from "decimal.js";
import type { UserDbHandle } from "@/lib/db/client";
import {
  barang,
  businesses,
  devices,
  orderItems,
  orders,
  outlets,
  paymentMethods,
  payments,
  pemilik,
} from "@/lib/db/schema";
import { calculateOrder, type CalcLine, type CalcSettings } from "@/lib/calc/order-calculator";
import { consignmentSplit } from "@/lib/calc/consignment-split";
import { assertRowsAffected } from "@/lib/db/errors";
import { businessDate } from "@/lib/utils/business-date";
import { checkShiftSellability, getOpenShiftForDevice, getShiftSellabilityErrorMessage } from "@/lib/pos/shift";
import { id as strings } from "@/lib/i18n/id";

/**
 * lib/pos/sell-barang.ts — TT06. Padanan lib/pos/pay-order.ts tapi untuk
 * barang titipan thrifting: fungsi TERPISAH (bukan cabang di dalam
 * payOrderWithDb) karena sumber baris ('barang', bukan 'products'+varian+
 * modifier) dan aturan bisnisnya (qty SELALU 1, tidak pernah digabung,
 * bagi hasil per baris) berbeda total dari F&B -- RENCANA-PEMBANGUNAN-
 * KASIR-THRIFTING.md §4 TT06. Yang DIPAKAI ULANG apa adanya: calculateOrder(),
 * bentuk insert orders/order_items/payments, idempotency lewat client-
 * generated id, shift aktif -- persis pola pay-order.ts.
 *
 * TIGA LAPIS pertahanan anti-jual-dobel (jawaban syarat CEO "pesan
 * penolakannya jelas untuk kasir, bukan galat mentah"):
 *   1. Fetch ulang status barang DI SINI (bukan percaya keranjang klien)
 *      SEBELUM masuk transaction -- kasus paling umum (barang laku ke
 *      orang lain SELAGI ada di keranjang kasir ini) ditolak dengan pesan
 *      jelas tanpa pernah menyentuh trigger sama sekali.
 *   2. Trigger claim_barang_for_sale() (TT02, migration 0025) di dalam
 *      transaction -- jaring pengaman untuk race betul-betul bersamaan
 *      (dua kasir insert order_items untuk barang yang sama di milidetik
 *      yang sama, lolos dari cek #1 karena keduanya membaca status lama
 *      sebelum salah satu commit). Exception dari trigger ini DITANGKAP
 *      di catch() bawah, diterjemahkan ke pesan yang sama seperti #1 --
 *      kasir tidak pernah melihat pesan Postgres mentah.
 *   3. UNIQUE constraint tidak diperlukan terpisah -- kombinasi #1+#2
 *      sudah menutup seluruh celah (dijelaskan di titik berhenti #1,
 *      RENCANA-PEMBANGUNAN §6.5).
 */

const lineSchema = z.object({ barangId: z.string().uuid() });

const paymentInputSchema = z.object({
  id: z.string().uuid(),
  paymentMethodId: z.string().uuid(),
  amount: z.string(),
  reference: z.string(),
});

export const sellBarangSchema = z.object({
  orderId: z.string().uuid(),
  outletId: z.string().uuid(),
  deviceId: z.string().uuid(),
  lines: z.array(lineSchema).min(1),
  payments: z.array(paymentInputSchema).min(1),
});

export type SellBarangInput = z.infer<typeof sellBarangSchema>;

export type SellBarangResult = {
  error?: string;
  success?: {
    orderId: string;
    orderNumber: string;
    total: string;
    change: string;
  };
};

/**
 * Pesan RAISE EXCEPTION persis dari trigger claim_barang_for_sale()
 * (migration 0025) -- dicocokkan lewat substring, bukan SQLSTATE saja
 * (P0001 dipakai RAISE EXCEPTION generik lain juga), supaya salah tangkap
 * exception yang tidak berhubungan tidak pernah diterjemahkan jadi pesan
 * yang salah konteks.
 */
function isBarangAlreadyClaimedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : "";
  return (
    message.includes("sudah terjual atau belum siap dijual") ||
    cause.includes("sudah terjual atau belum siap dijual")
  );
}

export async function sellBarangWithDb(
  db: UserDbHandle["db"],
  businessId: string,
  rawInput: unknown
): Promise<SellBarangResult> {
  const parsed = sellBarangSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: strings.common.unexpectedError };
  }
  const data = parsed.data;

  // Barang fisik unik -- dua baris untuk barangId yang sama di satu
  // keranjang tidak masuk akal sama sekali (beda dari F&B yang boleh
  // qty>1). Ditolak di sini, bukan cuma dicegah di UI.
  const barangIds = data.lines.map((l) => l.barangId);
  if (new Set(barangIds).size !== barangIds.length) {
    return { error: strings.pos.barangDuplikatDiKeranjangError };
  }

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
    if (!business || !outlet || !device) {
      return { error: strings.common.unexpectedError };
    }

    const rawActiveShift = await getOpenShiftForDevice(db, businessId, data.deviceId);
    const sellabilityIssue = checkShiftSellability(rawActiveShift, business.timezone, outlet.dayCutoffTime);
    if (sellabilityIssue !== null) {
      return { error: getShiftSellabilityErrorMessage(sellabilityIssue) };
    }
    // sellabilityIssue === null berarti rawActiveShift PASTI bukan null
    // (lihat checkShiftSellability) -- checkShiftSellability bukan type
    // guard (perlu mengembalikan ALASAN, bukan cuma boolean), jadi TS
    // tidak bisa menyempitkan sendiri.
    const activeShift = rawActiveShift!;

    // --- Fetch ulang barang dari DB (bukan dari klien) -- lapis #1 anti-
    // jual-dobel, lihat komentar besar di atas file. ---
    const barangRows = await db
      .select()
      .from(barang)
      .where(and(inArray(barang.id, barangIds), eq(barang.businessId, businessId)));
    const barangById = new Map(barangRows.map((b) => [b.id, b]));

    for (const line of data.lines) {
      const item = barangById.get(line.barangId);
      if (!item) {
        return { error: strings.common.unexpectedError };
      }
      if (item.status !== "siap_jual") {
        return {
          error: strings.pos.barangTidakSiapJualError.replace("{kode}", item.kode),
        };
      }
    }

    const pemilikIds = [
      ...new Set(barangRows.map((b) => b.pemilikId).filter((id): id is string => id !== null)),
    ];
    const pemilikRows = pemilikIds.length
      ? await db.select().from(pemilik).where(inArray(pemilik.id, pemilikIds))
      : [];
    const pemilikById = new Map(pemilikRows.map((p) => [p.id, p]));

    const paymentMethodIds = [...new Set(data.payments.map((p) => p.paymentMethodId))];
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
    for (const payment of data.payments) {
      if (!paymentMethodById.has(payment.paymentMethodId)) {
        return { error: strings.common.unexpectedError };
      }
      // Outlet cashless: metode isCashDrawer=true ditolak di server juga --
      // pertahanan berlapis, bukan cuma disembunyikan dari dialog bayar
      // (sama prinsip getPosCatalog()/addCashMovementWithDb).
      if (!outlet.cashEnabled && paymentMethodById.get(payment.paymentMethodId)!.isCashDrawer) {
        return { error: strings.shift.cashDisabledError };
      }
    }

    // --- calculateOrder() -- qty SELALU 1, tanpa modifier, tanpa diskon
    // (thrifting belum punya UI diskon, RENCANA-PEMBANGUNAN §4 TT06). ---
    const calcLines: CalcLine[] = data.lines.map((line) => {
      const item = barangById.get(line.barangId)!;
      return {
        id: line.barangId,
        qty: new Decimal(1),
        unitPrice: new Decimal(item.hargaJual),
        modifierTotal: new Decimal(0),
        itemDiscount: new Decimal(0),
        isTaxable: true,
      };
    });

    const calcSettings: CalcSettings = {
      discountType: "none",
      orderDiscountPercent: new Decimal(0),
      orderDiscountAmount: new Decimal(0),
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
      const [existing] = await tx
        .select({ number: orders.number })
        .from(orders)
        .where(eq(orders.id, data.orderId));
      if (existing) {
        orderNumber = existing.number;
        return;
      }

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
        channel: "retail",
        subtotal: result.subtotal.toFixed(2),
        itemDiscount: result.itemDiscountTotal.toFixed(2),
        orderDiscount: result.orderDiscount.toFixed(2),
        discountTotal: result.discountTotal.toFixed(2),
        netSales: result.netSales.toFixed(2),
        serviceCharge: result.serviceCharge.toFixed(2),
        taxAmount: result.taxAmount.toFixed(2),
        rounding: result.rounding.toFixed(2),
        total: result.total.toFixed(2),
        cogsTotal: "0",
        grossProfit: result.netSales.toFixed(2),
        businessDate: bDate,
        paidAt: now,
      });

      for (const [index, line] of data.lines.entries()) {
        const item = barangById.get(line.barangId)!;
        const lineResult = resultByLineId.get(line.barangId)!;
        const owner = item.pemilikId ? pemilikById.get(item.pemilikId) : undefined;

        // Bagi hasil DIPOTRET saat ini juga (CLAUDE.md §3.2 + jawaban CEO
        // §7 SPESIFIKASI-THRIFTING.md) -- kalau owner.persenBagi diubah
        // BULAN DEPAN, baris transaksi ini tidak ikut berubah. Barang
        // milik toko sendiri (pemilikId null): seluruh netAmount jadi
        // bagian toko, TIDAK memanggil consignmentSplit() sama sekali
        // (lihat komentar di lib/calc/consignment-split.ts).
        const split = owner
          ? consignmentSplit(lineResult.netAmount, new Decimal(owner.persenBagi).dividedBy(100))
          : { pemilikShareAmount: null, tokoShareAmount: lineResult.netAmount };

        await tx.insert(orderItems).values({
          id: line.barangId, // barang fisik unik -- id barang dipakai langsung sebagai id order_item, sama prinsip client-generated id CLAUDE.md §3.4 (di sini server-generated karena berasal dari barang yang sudah ada, bukan keranjang baru)
          orderId: data.orderId,
          barangId: item.id,
          pemilikId: item.pemilikId,
          // SNAPSHOT -- termasuk ukuran/warna di nama supaya struk & laporan
          // tetap informatif walau baris `barang` aslinya diubah/ditandai
          // rusak setelah ini (CLAUDE.md §3.2).
          productName: [item.nama, item.ukuran, item.warna].filter(Boolean).join(" · "),
          categoryName: null,
          qty: "1",
          unitPrice: item.hargaJual,
          modifierTotal: "0",
          grossAmount: lineResult.grossAmount.toFixed(2),
          discountAmount: lineResult.itemDiscount.toFixed(2),
          allocatedOrderDiscount: lineResult.allocatedOrderDiscount.toFixed(2),
          netAmount: lineResult.netAmount.toFixed(2),
          unitCogs: item.hargaModal,
          cogsAmount: item.hargaModal,
          pemilikBagiPercentAtSale: owner ? owner.persenBagi : null,
          pemilikShareAmount: split.pemilikShareAmount ? split.pemilikShareAmount.toFixed(2) : null,
          tokoShareAmount: split.tokoShareAmount.toFixed(2),
          note: null,
          sortOrder: index,
        });
      }

      for (const [index, payment] of data.payments.entries()) {
        const method = paymentMethodById.get(payment.paymentMethodId)!;
        const isLast = index === data.payments.length - 1;
        await tx.insert(payments).values({
          id: payment.id,
          orderId: data.orderId,
          paymentMethodId: payment.paymentMethodId,
          methodName: method.name,
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
    if (isBarangAlreadyClaimedError(err)) {
      // Lapis #2 -- race betul-betul bersamaan, lolos dari cek status di
      // atas. Pesan yang sama seperti cek #1, kasir tidak pernah tahu ini
      // datang dari trigger Postgres, bukan validasi aplikasi biasa.
      return { error: strings.pos.barangSudahTerjualSaatBayarError };
    }
    console.error("sellBarangWithDb gagal:", err);
    return { error: strings.common.unexpectedError };
  }
}
