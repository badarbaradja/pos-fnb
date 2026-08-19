import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { Decimal } from "decimal.js";
import type { UserDbHandle } from "@/lib/db/client";
import {
  auditLogs,
  businesses,
  ingredients,
  outlets,
  stockLevels,
  stockMovements,
  stockTransferItems,
  stockTransfers,
} from "@/lib/db/schema";
import { assertRowsAffected } from "@/lib/db/errors";
import { calculateNewAvgCost } from "@/lib/calc/cogs";
import { businessDate } from "@/lib/utils/business-date";
import { generateId } from "@/lib/utils/id";
import { id as strings } from "@/lib/i18n/id";

/**
 * lib/stock-transfers/manage.ts — T22. Penerimaan barang dari gudang pusat.
 *
 * SENGAJA melewati alur draft->sent->received BLUEPRINT: outlet penerima
 * langsung mencatat apa yang benar-benar datang, status langsung
 * 'received' (lihat komentar schema.ts/BLUEPRINT §3.3 untuk alasan penuh).
 *
 * entered_* (satuan/qty/cost MENTAH yang diketik staf) disimpan terpisah
 * dari qty/unit_cost (hasil konversi ke base_unit yang ditulis ke ledger)
 * -- supaya bisa ditelusuri "apa yang sebenarnya diketik" berbulan-bulan
 * kemudian, bukan cuma angka base-unit yang sudah tercampur konversi.
 *
 * Pembatalan (cancelStockTransferWithDb) TIDAK menghapus/mengubah qty
 * penerimaan asli -- menulis movement pembalik baru (transfer_cancel)
 * dengan qty PENUH (bukan disesuaikan dengan sisa stok) dan unit_cost dari
 * penerimaan ASLI (bukan avg_cost saat ini). Kalau sebagian bahan sudah
 * terpakai, saldo boleh jadi minus (kebijakan stok minus tidak diblokir)
 * -- baris pemanggil wajib mengembalikan peringatan eksplisit, bukan
 * diam-diam menuliskannya.
 */

type Db = UserDbHandle["db"];

const unitChoiceSchema = z.enum(["purchase", "base"]);

const lineSchema = z.object({
  ingredientId: z.string().uuid(),
  enteredUnitChoice: unitChoiceSchema,
  enteredQty: z.coerce.number().positive(strings.stockTransfers.qtyMustBePositive),
  enteredUnitCost: z.coerce.number().nonnegative(strings.stockTransfers.costMustBeNonNegative),
});

const receiveSchema = z.object({
  toOutletId: z.string().uuid(),
  number: z.string().trim().min(1, strings.common.requiredField),
  note: z.string().trim().optional(),
  receivedBy: z.string().uuid(),
  lines: z.array(lineSchema).min(1, strings.stockTransfers.atLeastOneLine),
});

export type ReceiveLineResolved = {
  ingredientId: string;
  enteredUnit: string;
  enteredQty: string;
  enteredUnitCost: string;
  qty: Decimal;
  unitCost: Decimal;
};

export type StockTransferActionResult = {
  error?: string;
  success?: { transferId: string };
};

/**
 * Konversi satu baris entri ke base_unit. enteredUnitChoice HARUS salah
 * satu dari purchase_unit ATAU base_unit ingredient ini -- tidak ada
 * satuan bebas lain (mitigasi murah untuk kasus multi-kemasan yang belum
 * diselesaikan penuh, lihat docs/05-RENCANA-FASE-2.md §6.4).
 */
function resolveLine(
  line: z.infer<typeof lineSchema>,
  ingredient: { baseUnit: string; purchaseUnit: string; purchaseFactor: string }
): { error: string } | { resolved: ReceiveLineResolved } {
  const enteredUnit =
    line.enteredUnitChoice === "purchase" ? ingredient.purchaseUnit : ingredient.baseUnit;
  const factor =
    line.enteredUnitChoice === "purchase" ? new Decimal(ingredient.purchaseFactor) : new Decimal(1);

  const enteredQty = new Decimal(line.enteredQty);
  const enteredUnitCost = new Decimal(line.enteredUnitCost);

  return {
    resolved: {
      ingredientId: line.ingredientId,
      enteredUnit,
      enteredQty: enteredQty.toFixed(4),
      enteredUnitCost: enteredUnitCost.toFixed(8),
      qty: enteredQty.times(factor),
      unitCost: enteredUnitCost.dividedBy(factor),
    },
  };
}

export async function receiveStockTransferWithDb(
  db: Db,
  businessId: string,
  rawInput: unknown
): Promise<StockTransferActionResult> {
  const parsed = receiveSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const data = parsed.data;

  const [business] = await db
    .select({ timezone: businesses.timezone })
    .from(businesses)
    .where(eq(businesses.id, businessId));
  if (!business) {
    return { error: strings.common.unexpectedError };
  }

  const [fromOutlet] = await db
    .select({ id: outlets.id })
    .from(outlets)
    .where(and(eq(outlets.businessId, businessId), eq(outlets.isCentralKitchen, true)));
  if (!fromOutlet) {
    return { error: strings.stockTransfers.noCentralKitchenError };
  }

  const [toOutlet] = await db
    .select({ id: outlets.id, dayCutoffTime: outlets.dayCutoffTime })
    .from(outlets)
    .where(and(eq(outlets.id, data.toOutletId), eq(outlets.businessId, businessId)));
  if (!toOutlet) {
    return { error: strings.common.unexpectedError };
  }

  const ingredientIds = [...new Set(data.lines.map((l) => l.ingredientId))];
  const ingredientRows = await db
    .select()
    .from(ingredients)
    .where(and(eq(ingredients.businessId, businessId), eq(ingredients.isActive, true)));
  const ingredientById = new Map(
    ingredientRows.filter((i) => ingredientIds.includes(i.id)).map((i) => [i.id, i])
  );
  if (ingredientById.size !== ingredientIds.length) {
    return { error: strings.common.unexpectedError };
  }

  const resolvedLines: ReceiveLineResolved[] = [];
  for (const line of data.lines) {
    const ingredient = ingredientById.get(line.ingredientId)!;
    const result = resolveLine(line, ingredient);
    if ("error" in result) {
      return { error: result.error };
    }
    resolvedLines.push(result.resolved);
  }

  const now = new Date();
  const bDate = businessDate(now, business.timezone, toOutlet.dayCutoffTime);
  const transferId = generateId();

  await db.transaction(async (tx) => {
    await tx.insert(stockTransfers).values({
      id: transferId,
      businessId,
      fromOutletId: fromOutlet.id,
      toOutletId: toOutlet.id,
      number: data.number,
      status: "received",
      receivedAt: now,
      note: data.note || null,
      receivedBy: data.receivedBy,
    });

    for (const line of resolvedLines) {
      const [level] = await tx
        .select()
        .from(stockLevels)
        .where(and(eq(stockLevels.ingredientId, line.ingredientId), eq(stockLevels.outletId, toOutlet.id)))
        .for("update");

      const qtyLama = level ? new Decimal(level.qtyOnHand) : new Decimal(0);
      const avgCostLama = level ? new Decimal(level.avgCost) : new Decimal(0);
      const newAvgCost = calculateNewAvgCost(qtyLama, avgCostLama, line.qty, line.unitCost);
      const balanceAfter = qtyLama.plus(line.qty);
      const totalCost = line.qty.times(line.unitCost);

      await tx.insert(stockTransferItems).values({
        id: generateId(),
        transferId,
        businessId,
        ingredientId: line.ingredientId,
        enteredUnit: line.enteredUnit,
        enteredQty: line.enteredQty,
        enteredUnitCost: line.enteredUnitCost,
        qty: line.qty.toFixed(4),
        unitCost: line.unitCost.toFixed(8),
        createdBy: data.receivedBy,
      });

      await tx.insert(stockMovements).values({
        businessId,
        outletId: toOutlet.id,
        ingredientId: line.ingredientId,
        movementType: "transfer_in",
        qty: line.qty.toFixed(4),
        unitCost: line.unitCost.toFixed(8),
        totalCost: totalCost.toFixed(2),
        balanceAfter: balanceAfter.toFixed(4),
        avgCostAfter: newAvgCost.toFixed(8),
        refType: "stock_transfer",
        refId: transferId,
        businessDate: bDate,
        createdBy: data.receivedBy,
      });

      if (level) {
        await tx
          .update(stockLevels)
          .set({ qtyOnHand: balanceAfter.toFixed(4), avgCost: newAvgCost.toFixed(8) })
          .where(and(eq(stockLevels.ingredientId, line.ingredientId), eq(stockLevels.outletId, toOutlet.id)));
      } else {
        await tx.insert(stockLevels).values({
          businessId,
          ingredientId: line.ingredientId,
          outletId: toOutlet.id,
          qtyOnHand: balanceAfter.toFixed(4),
          avgCost: newAvgCost.toFixed(8),
        });
      }
    }

    await tx.insert(auditLogs).values({
      id: generateId(),
      businessId,
      outletId: toOutlet.id,
      employeeId: data.receivedBy,
      action: "receive_stock_transfer",
      refType: "stock_transfer",
      refId: transferId,
      metadata: { number: data.number, lineCount: resolvedLines.length },
      createdAt: now,
    });
  });

  return { success: { transferId } };
}

const cancelSchema = z.object({
  transferId: z.string().uuid(),
  reason: z.string().trim().min(1, strings.stockTransfers.cancelReasonRequired),
  cancelledBy: z.string().uuid(),
});

export type CancelWarning = { ingredientId: string; ingredientName: string; resultingQty: string; baseUnit: string };

export type CancelStockTransferResult = {
  error?: string;
  success?: { cancelledAt: string };
  warnings?: CancelWarning[];
};

export async function cancelStockTransferWithDb(
  db: Db,
  businessId: string,
  rawInput: unknown
): Promise<CancelStockTransferResult> {
  const parsed = cancelSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const data = parsed.data;

  const [transfer] = await db
    .select()
    .from(stockTransfers)
    .where(
      and(
        eq(stockTransfers.id, data.transferId),
        eq(stockTransfers.businessId, businessId),
        eq(stockTransfers.status, "received")
      )
    );
  if (!transfer) {
    return { error: strings.stockTransfers.alreadyCancelledOrNotFound };
  }

  const items = await db
    .select()
    .from(stockTransferItems)
    .where(eq(stockTransferItems.transferId, data.transferId));

  const ingredientRows = await db
    .select({ id: ingredients.id, name: ingredients.name, baseUnit: ingredients.baseUnit })
    .from(ingredients)
    .where(eq(ingredients.businessId, businessId));
  const ingredientById = new Map(ingredientRows.map((i) => [i.id, i]));

  const now = new Date();
  const [business] = await db
    .select({ timezone: businesses.timezone })
    .from(businesses)
    .where(eq(businesses.id, businessId));
  const [toOutlet] = await db
    .select({ dayCutoffTime: outlets.dayCutoffTime })
    .from(outlets)
    .where(eq(outlets.id, transfer.toOutletId));
  if (!business || !toOutlet) {
    return { error: strings.common.unexpectedError };
  }
  const bDate = businessDate(now, business.timezone, toOutlet.dayCutoffTime);

  const warnings: CancelWarning[] = [];

  await db.transaction(async (tx) => {
    for (const item of items) {
      const [level] = await tx
        .select()
        .from(stockLevels)
        .where(and(eq(stockLevels.ingredientId, item.ingredientId), eq(stockLevels.outletId, transfer.toOutletId)))
        .for("update");

      const qtyLama = level ? new Decimal(level.qtyOnHand) : new Decimal(0);
      const avgCostLama = level ? new Decimal(level.avgCost) : new Decimal(0);
      const qtyMasuk = new Decimal(item.qty).negated(); // qty PENUH, tidak disesuaikan -- ledger mencerminkan kejadian sesungguhnya
      const costMasuk = new Decimal(item.unitCost); // unit_cost PENERIMAAN ASLI, bukan avg_cost saat ini
      const newAvgCost = calculateNewAvgCost(qtyLama, avgCostLama, qtyMasuk, costMasuk);
      const balanceAfter = qtyLama.plus(qtyMasuk);
      const totalCost = qtyMasuk.times(costMasuk);

      await tx.insert(stockMovements).values({
        businessId,
        outletId: transfer.toOutletId,
        ingredientId: item.ingredientId,
        movementType: "transfer_cancel",
        qty: qtyMasuk.toFixed(4),
        unitCost: costMasuk.toFixed(8),
        totalCost: totalCost.toFixed(2),
        balanceAfter: balanceAfter.toFixed(4),
        avgCostAfter: newAvgCost.toFixed(8),
        refType: "stock_transfer",
        refId: transfer.id,
        businessDate: bDate,
        note: `Pembatalan penerimaan ${transfer.number}: ${data.reason}`,
        createdBy: data.cancelledBy,
      });

      if (level) {
        await tx
          .update(stockLevels)
          .set({ qtyOnHand: balanceAfter.toFixed(4), avgCost: newAvgCost.toFixed(8) })
          .where(and(eq(stockLevels.ingredientId, item.ingredientId), eq(stockLevels.outletId, transfer.toOutletId)));
      } else {
        await tx.insert(stockLevels).values({
          businessId,
          ingredientId: item.ingredientId,
          outletId: transfer.toOutletId,
          qtyOnHand: balanceAfter.toFixed(4),
          avgCost: newAvgCost.toFixed(8),
        });
      }

      if (balanceAfter.isNegative()) {
        const ingredient = ingredientById.get(item.ingredientId);
        warnings.push({
          ingredientId: item.ingredientId,
          ingredientName: ingredient?.name ?? item.ingredientId,
          resultingQty: balanceAfter.toFixed(4),
          baseUnit: ingredient?.baseUnit ?? "",
        });
      }
    }

    const updated = await tx
      .update(stockTransfers)
      .set({
        status: "cancelled",
        cancelReason: data.reason,
        cancelledAt: now,
        cancelledBy: data.cancelledBy,
      })
      .where(and(eq(stockTransfers.id, data.transferId), eq(stockTransfers.businessId, businessId)))
      .returning({ id: stockTransfers.id });
    assertRowsAffected(updated, "pembatalan penerimaan");

    await tx.insert(auditLogs).values({
      id: generateId(),
      businessId,
      outletId: transfer.toOutletId,
      employeeId: data.cancelledBy,
      action: "cancel_stock_transfer",
      refType: "stock_transfer",
      refId: transfer.id,
      reason: data.reason,
      metadata: { number: transfer.number, warnings },
      createdAt: now,
    });
  });

  return { success: { cancelledAt: now.toISOString() }, warnings: warnings.length > 0 ? warnings : undefined };
}
