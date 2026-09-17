import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
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
import { isOutletAllowed, type OutletScope } from "@/lib/auth/outlet-scope";
import { id as strings } from "@/lib/i18n/id";

/**
 * lib/stock-transfers/manage.ts — T22. Transfer stok dua sisi:
 * requested (outlet) -> approved/rejected (gudang) -> sent (gudang) ->
 * received (outlet), dengan cancelled sebagai jalan keluar dari
 * requested/approved/received (BUKAN dari sent -- lihat komentar
 * schema.ts kenapa). Menggantikan v1 (satu langkah, langsung 'received'
 * saat dibuat) sepenuhnya -- lihat docs/05-RENCANA-FASE-2.md §8.
 *
 * Approve MURNI keputusan ya/tidak -- tidak menetapkan angka apa pun.
 * Angka baru dikunci di SEND (sent_qty, boleh beda dari requested_qty
 * kalau stok gudang terbatas -- send_diff_reason wajib kalau beda) dan
 * di RECEIVE (received_qty, boleh beda dari sent_qty kalau ada yang
 * hilang di jalan -- receive_diff_reason wajib kalau beda).
 *
 * stock_transfer_items.qty/unit_cost (base_unit, dipakai ledger outlet)
 * diisi di tahap RECEIVE dari received_qty -- BUKAN dari sent_qty --
 * karena outlet cuma benar-benar punya apa yang sungguh sampai. Konversi
 * base_unit untuk sisi GUDANG (movement transfer_out saat kirim) dihitung
 * langsung dari sent_qty saat itu juga, ditulis ke stock_movements, TIDAK
 * disimpan balik ke kolom item manapun -- stock_movements sendiri sudah
 * jadi catatan permanennya.
 *
 * transfer_loss (selisih sent_qty vs received_qty) SENGAJA TIDAK mengubah
 * stock_levels siapa pun -- baca docs/04-CATATAN-TEKNIS.md sebelum
 * "memperbaikinya" jadi mengurangi stok lagi.
 */

type Db = UserDbHandle["db"];

const unitChoiceSchema = z.enum(["purchase", "base"]);

/** Konversi satu pasang (unitChoice, qty) ke base_unit -- dipakai di request/send/receive. */
function resolveUnit(
  unitChoice: z.infer<typeof unitChoiceSchema>,
  ingredient: { baseUnit: string; purchaseUnit: string; purchaseFactor: string }
): { unit: string; factor: Decimal } {
  return unitChoice === "purchase"
    ? { unit: ingredient.purchaseUnit, factor: new Decimal(ingredient.purchaseFactor) }
    : { unit: ingredient.baseUnit, factor: new Decimal(1) };
}

async function loadIngredientMap(db: Db, businessId: string, ingredientIds: string[]) {
  const rows = await db
    .select()
    .from(ingredients)
    .where(and(eq(ingredients.businessId, businessId), eq(ingredients.isActive, true)));
  const byId = new Map(rows.filter((i) => ingredientIds.includes(i.id)).map((i) => [i.id, i]));
  return byId;
}

async function getCentralKitchen(db: Db, businessId: string) {
  const [outlet] = await db
    .select({ id: outlets.id })
    .from(outlets)
    .where(and(eq(outlets.businessId, businessId), eq(outlets.isCentralKitchen, true)));
  return outlet ?? null;
}

export type StockTransferActionResult = {
  error?: string;
  success?: { transferId: string };
};

// ---------------------------------------------------------------------
// 1. Request (outlet)
// ---------------------------------------------------------------------

const requestLineSchema = z.object({
  ingredientId: z.string().uuid(),
  unitChoice: unitChoiceSchema,
  qty: z.coerce.number().positive(strings.stockTransfers.qtyMustBePositive),
});

const requestSchema = z.object({
  toOutletId: z.string().uuid(),
  note: z.string().trim().optional(),
  requestedBy: z.string().uuid(),
  lines: z.array(requestLineSchema).min(1, strings.stockTransfers.atLeastOneLine),
});

export async function requestStockTransferWithDb(
  db: Db,
  businessId: string,
  allowedOutletIds: OutletScope,
  rawInput: unknown
): Promise<StockTransferActionResult> {
  const parsed = requestSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const data = parsed.data;

  // Pembatasan akses per outlet, Tahap 4 (13 September 2026, §28) --
  // REQUEST digerbang toOutletId (outlet peminta, dari input).
  // fromOutletId (gudang) TIDAK diperiksa di sini -- selalu auto-resolve
  // dari getCentralKitchen() di bawah, tidak pernah dari input, jadi
  // tidak ada yang bisa "dipalsukan" pemanggil untuk sisi itu.
  if (!isOutletAllowed(allowedOutletIds, data.toOutletId)) {
    return { error: strings.common.outletAccessDenied };
  }

  const fromOutlet = await getCentralKitchen(db, businessId);
  if (!fromOutlet) {
    return { error: strings.stockTransfers.noCentralKitchenError };
  }
  const [toOutlet] = await db
    .select({ id: outlets.id })
    .from(outlets)
    .where(and(eq(outlets.id, data.toOutletId), eq(outlets.businessId, businessId)));
  if (!toOutlet) {
    return { error: strings.common.unexpectedError };
  }

  const ingredientIds = [...new Set(data.lines.map((l) => l.ingredientId))];
  const ingredientById = await loadIngredientMap(db, businessId, ingredientIds);
  if (ingredientById.size !== ingredientIds.length) {
    return { error: strings.common.unexpectedError };
  }

  const transferId = generateId();
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx.insert(stockTransfers).values({
      id: transferId,
      businessId,
      fromOutletId: fromOutlet.id,
      toOutletId: toOutlet.id,
      status: "requested",
      note: data.note || null,
      requestedBy: data.requestedBy,
      createdAt: now,
    });

    for (const line of data.lines) {
      const ingredient = ingredientById.get(line.ingredientId)!;
      const { unit } = resolveUnit(line.unitChoice, ingredient);
      await tx.insert(stockTransferItems).values({
        id: generateId(),
        transferId,
        businessId,
        ingredientId: line.ingredientId,
        requestedUnit: unit,
        requestedQty: new Decimal(line.qty).toFixed(4),
        createdBy: data.requestedBy,
        createdAt: now,
      });
    }

    await tx.insert(auditLogs).values({
      id: generateId(),
      businessId,
      outletId: toOutlet.id,
      employeeId: data.requestedBy,
      action: "request_stock_transfer",
      refType: "stock_transfer",
      refId: transferId,
      metadata: { lineCount: data.lines.length },
      createdAt: now,
    });
  });

  return { success: { transferId } };
}

// ---------------------------------------------------------------------
// 2. Approve / Reject (gudang) -- MURNI ya/tidak, tanpa angka
// ---------------------------------------------------------------------

const decisionSchema = z.object({
  transferId: z.string().uuid(),
  actorId: z.string().uuid(),
});

export async function approveStockTransferWithDb(
  db: Db,
  businessId: string,
  allowedOutletIds: OutletScope,
  rawInput: unknown
): Promise<StockTransferActionResult> {
  const parsed = decisionSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const data = parsed.data;

  // Pembatasan akses per outlet, Tahap 4 -- APPROVE digerbang
  // fromOutletId (gudang, keputusan gudang bukan outlet peminta) --
  // baris diambil ulang dulu SEBELUM update, dicek SEBELUM apa pun
  // ditulis.
  const [current] = await db
    .select({ fromOutletId: stockTransfers.fromOutletId })
    .from(stockTransfers)
    .where(and(eq(stockTransfers.id, data.transferId), eq(stockTransfers.businessId, businessId)));
  if (!current) {
    return { error: strings.stockTransfers.notPendingApproval };
  }
  if (!isOutletAllowed(allowedOutletIds, current.fromOutletId)) {
    return { error: strings.common.outletAccessDenied };
  }

  const now = new Date();

  const updated = await db
    .update(stockTransfers)
    .set({ status: "approved", approvedBy: data.actorId, approvedAt: now })
    .where(
      and(
        eq(stockTransfers.id, data.transferId),
        eq(stockTransfers.businessId, businessId),
        eq(stockTransfers.status, "requested")
      )
    )
    .returning({ id: stockTransfers.id, toOutletId: stockTransfers.toOutletId });
  if (updated.length === 0) {
    return { error: strings.stockTransfers.notPendingApproval };
  }

  await db.insert(auditLogs).values({
    id: generateId(),
    businessId,
    outletId: updated[0]!.toOutletId,
    employeeId: data.actorId,
    action: "approve_stock_transfer",
    refType: "stock_transfer",
    refId: data.transferId,
    createdAt: now,
  });

  return { success: { transferId: data.transferId } };
}

const rejectSchema = decisionSchema.extend({
  reason: z.string().trim().min(1, strings.stockTransfers.rejectReasonRequired),
});

export async function rejectStockTransferWithDb(
  db: Db,
  businessId: string,
  allowedOutletIds: OutletScope,
  rawInput: unknown
): Promise<StockTransferActionResult> {
  const parsed = rejectSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const data = parsed.data;

  // Pembatasan akses per outlet, Tahap 4 -- pola sama approveStockTransferWithDb.
  const [current] = await db
    .select({ fromOutletId: stockTransfers.fromOutletId })
    .from(stockTransfers)
    .where(and(eq(stockTransfers.id, data.transferId), eq(stockTransfers.businessId, businessId)));
  if (!current) {
    return { error: strings.stockTransfers.notPendingApproval };
  }
  if (!isOutletAllowed(allowedOutletIds, current.fromOutletId)) {
    return { error: strings.common.outletAccessDenied };
  }

  const now = new Date();

  const updated = await db
    .update(stockTransfers)
    .set({ status: "rejected", rejectedBy: data.actorId, rejectedAt: now, rejectedReason: data.reason })
    .where(
      and(
        eq(stockTransfers.id, data.transferId),
        eq(stockTransfers.businessId, businessId),
        eq(stockTransfers.status, "requested")
      )
    )
    .returning({ id: stockTransfers.id, toOutletId: stockTransfers.toOutletId });
  if (updated.length === 0) {
    return { error: strings.stockTransfers.notPendingApproval };
  }

  await db.insert(auditLogs).values({
    id: generateId(),
    businessId,
    outletId: updated[0]!.toOutletId,
    employeeId: data.actorId,
    action: "reject_stock_transfer",
    refType: "stock_transfer",
    refId: data.transferId,
    reason: data.reason,
    createdAt: now,
  });

  return { success: { transferId: data.transferId } };
}

// ---------------------------------------------------------------------
// 3. Send (gudang) -- angka pertama dikunci, movement transfer_out ke gudang
// ---------------------------------------------------------------------

const sendLineSchema = z.object({
  itemId: z.string().uuid(),
  unitChoice: unitChoiceSchema,
  qty: z.coerce.number().positive(strings.stockTransfers.qtyMustBePositive),
  unitCost: z.coerce.number().nonnegative(strings.stockTransfers.costMustBeNonNegative),
  diffReason: z.string().trim().optional(),
});

// Langkah D (17 September 2026) -- WAJIB tepat satu dari photoPath
// (upload berhasil) atau photoMissingReason (kamera gagal dibuka, diisi
// OTOMATIS oleh UI, bukan diketik manual) -- refine (bukan union
// z.undefined(), yang rapuh terhadap key yang sama sekali tidak ada di
// objek) menolak keduanya kosong ATAU keduanya terisi di level Zod,
// sebelum sampai ke trigger check_stock_transfer_transition yang
// menegakkan hal sama di server independen dari kode ini.
const transferPhotoSchema = z
  .object({
    photoPath: z.string().min(1).optional(),
    photoMissingReason: z.string().min(1).optional(),
  })
  .refine((val) => Boolean(val.photoPath) !== Boolean(val.photoMissingReason), {
    message: strings.stockTransfers.photoRequiredError,
  });

const sendSchema = z.object({
  transferId: z.string().uuid(),
  sentBy: z.string().uuid(),
  number: z.string().trim().optional(),
  lines: z.array(sendLineSchema).min(1, strings.stockTransfers.atLeastOneLine),
  photo: transferPhotoSchema,
});

export async function sendStockTransferWithDb(
  db: Db,
  businessId: string,
  allowedOutletIds: OutletScope,
  rawInput: unknown
): Promise<StockTransferActionResult> {
  const parsed = sendSchema.safeParse(rawInput);
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
        eq(stockTransfers.status, "approved")
      )
    );
  if (!transfer) {
    return { error: strings.stockTransfers.notApprovedYet };
  }
  // Pembatasan akses per outlet, Tahap 4 (13 September 2026, §28) --
  // SEND ada di sisi gudang (fromOutletId), bukan outlet peminta.
  if (!isOutletAllowed(allowedOutletIds, transfer.fromOutletId)) {
    return { error: strings.common.outletAccessDenied };
  }

  const items = await db
    .select()
    .from(stockTransferItems)
    .where(eq(stockTransferItems.transferId, data.transferId));
  const itemById = new Map(items.map((i) => [i.id, i]));
  if (data.lines.some((l) => !itemById.has(l.itemId))) {
    return { error: strings.common.unexpectedError };
  }

  const ingredientIds = [...new Set(items.map((i) => i.ingredientId))];
  const ingredientById = await loadIngredientMap(db, businessId, ingredientIds);
  if (ingredientById.size !== ingredientIds.length) {
    return { error: strings.common.unexpectedError };
  }

  // send_diff_reason wajib server-side kalau sent_qty != requested_qty --
  // ditegakkan di sini, BUKAN hanya di form (CLAUDE.md §3.4).
  for (const line of data.lines) {
    const item = itemById.get(line.itemId)!;
    const requestedQty = new Decimal(item.requestedQty);
    if (!requestedQty.equals(line.qty) && !line.diffReason) {
      return { error: strings.stockTransfers.sendDiffReasonRequired };
    }
  }

  const [business] = await db
    .select({ timezone: businesses.timezone })
    .from(businesses)
    .where(eq(businesses.id, businessId));
  const [fromOutlet] = await db
    .select({ dayCutoffTime: outlets.dayCutoffTime })
    .from(outlets)
    .where(eq(outlets.id, transfer.fromOutletId));
  if (!business || !fromOutlet) {
    return { error: strings.common.unexpectedError };
  }
  const now = new Date();
  const bDate = businessDate(now, business.timezone, fromOutlet.dayCutoffTime);

  await db.transaction(async (tx) => {
    for (const line of data.lines) {
      const item = itemById.get(line.itemId)!;
      const ingredient = ingredientById.get(item.ingredientId)!;
      const { unit, factor } = resolveUnit(line.unitChoice, ingredient);
      const enteredQty = new Decimal(line.qty);
      const enteredUnitCost = new Decimal(line.unitCost);
      const qtyBase = enteredQty.times(factor);
      const unitCostBase = enteredUnitCost.dividedBy(factor);

      const [level] = await tx
        .select()
        .from(stockLevels)
        .where(and(eq(stockLevels.ingredientId, item.ingredientId), eq(stockLevels.outletId, transfer.fromOutletId)))
        .for("update");
      const qtyLama = level ? new Decimal(level.qtyOnHand) : new Decimal(0);
      const avgCostLama = level ? new Decimal(level.avgCost) : new Decimal(0);
      const qtyMasuk = qtyBase.negated(); // keluar dari gudang
      const newAvgCost = calculateNewAvgCost(qtyLama, avgCostLama, qtyMasuk, unitCostBase);
      const balanceAfter = qtyLama.plus(qtyMasuk);
      const totalCost = qtyMasuk.times(unitCostBase);

      await tx.insert(stockMovements).values({
        businessId,
        outletId: transfer.fromOutletId,
        ingredientId: item.ingredientId,
        movementType: "transfer_out",
        qty: qtyMasuk.toFixed(4),
        unitCost: unitCostBase.toFixed(8),
        totalCost: totalCost.toFixed(2),
        balanceAfter: balanceAfter.toFixed(4),
        avgCostAfter: newAvgCost.toFixed(8),
        refType: "stock_transfer",
        refId: data.transferId,
        businessDate: bDate,
        createdBy: data.sentBy,
      });

      if (level) {
        await tx
          .update(stockLevels)
          .set({ qtyOnHand: balanceAfter.toFixed(4), avgCost: newAvgCost.toFixed(8) })
          .where(and(eq(stockLevels.ingredientId, item.ingredientId), eq(stockLevels.outletId, transfer.fromOutletId)));
      } else {
        await tx.insert(stockLevels).values({
          businessId,
          ingredientId: item.ingredientId,
          outletId: transfer.fromOutletId,
          qtyOnHand: balanceAfter.toFixed(4),
          avgCost: newAvgCost.toFixed(8),
        });
      }

      await tx
        .update(stockTransferItems)
        .set({
          sentUnit: unit,
          sentQty: enteredQty.toFixed(4),
          sentUnitCost: enteredUnitCost.toFixed(8),
          sendDiffReason: line.diffReason || null,
        })
        .where(and(eq(stockTransferItems.id, line.itemId), eq(stockTransferItems.businessId, businessId)));
    }

    const updated = await tx
      .update(stockTransfers)
      .set({
        status: "sent",
        sentBy: data.sentBy,
        sentAt: now,
        number: data.number || null,
        sentPhotoPath: data.photo.photoPath ?? null,
        sentPhotoMissingReason: data.photo.photoMissingReason ?? null,
      })
      .where(
        and(
          eq(stockTransfers.id, data.transferId),
          eq(stockTransfers.businessId, businessId),
          eq(stockTransfers.status, "approved")
        )
      )
      .returning({ id: stockTransfers.id });
    assertRowsAffected(updated, "pengiriman transfer stok");

    await tx.insert(auditLogs).values({
      id: generateId(),
      businessId,
      outletId: transfer.fromOutletId,
      employeeId: data.sentBy,
      action: "send_stock_transfer",
      refType: "stock_transfer",
      refId: data.transferId,
      metadata: { lineCount: data.lines.length },
      createdAt: now,
    });
  });

  return { success: { transferId: data.transferId } };
}

// ---------------------------------------------------------------------
// 4. Receive (outlet) -- ledger outlet pakai received_qty, bukan sent_qty
// ---------------------------------------------------------------------

const receiveLineSchema = z.object({
  itemId: z.string().uuid(),
  receivedQty: z.coerce.number().nonnegative(strings.stockTransfers.qtyMustBeNonNegative),
  diffReason: z.string().trim().optional(),
});

const receiveSchema = z.object({
  transferId: z.string().uuid(),
  receivedBy: z.string().uuid(),
  lines: z.array(receiveLineSchema).min(1, strings.stockTransfers.atLeastOneLine),
  photo: transferPhotoSchema,
});

export type ReceiveDiscrepancy = {
  ingredientId: string;
  ingredientName: string;
  sentQty: string;
  receivedQty: string;
  unit: string;
  lossValue: string;
};

export type ReceiveStockTransferResult = StockTransferActionResult & {
  discrepancies?: ReceiveDiscrepancy[];
};

export async function receiveStockTransferWithDb(
  db: Db,
  businessId: string,
  allowedOutletIds: OutletScope,
  rawInput: unknown
): Promise<ReceiveStockTransferResult> {
  const parsed = receiveSchema.safeParse(rawInput);
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
        eq(stockTransfers.status, "sent")
      )
    );
  if (!transfer) {
    return { error: strings.stockTransfers.notSentYet };
  }
  // Pembatasan akses per outlet, Tahap 4 (13 September 2026, §28) --
  // RECEIVE ada di sisi outlet peminta (toOutletId), bukan gudang.
  if (!isOutletAllowed(allowedOutletIds, transfer.toOutletId)) {
    return { error: strings.common.outletAccessDenied };
  }

  const items = await db
    .select()
    .from(stockTransferItems)
    .where(eq(stockTransferItems.transferId, data.transferId));
  const itemById = new Map(items.map((i) => [i.id, i]));
  if (data.lines.some((l) => !itemById.has(l.itemId))) {
    return { error: strings.common.unexpectedError };
  }

  const ingredientIds = [...new Set(items.map((i) => i.ingredientId))];
  const ingredientRows = await db
    .select({
      id: ingredients.id,
      name: ingredients.name,
      baseUnit: ingredients.baseUnit,
      purchaseUnit: ingredients.purchaseUnit,
      purchaseFactor: ingredients.purchaseFactor,
    })
    .from(ingredients)
    .where(eq(ingredients.businessId, businessId));
  const ingredientById = new Map(ingredientRows.filter((i) => ingredientIds.includes(i.id)).map((i) => [i.id, i]));

  // receive_diff_reason wajib server-side kalau received_qty != sent_qty.
  for (const line of data.lines) {
    const item = itemById.get(line.itemId)!;
    const sentQty = new Decimal(item.sentQty ?? "0");
    if (!sentQty.equals(line.receivedQty) && !line.diffReason) {
      return { error: strings.stockTransfers.receiveDiffReasonRequired };
    }
  }

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
  const now = new Date();
  const bDate = businessDate(now, business.timezone, toOutlet.dayCutoffTime);
  const discrepancies: ReceiveDiscrepancy[] = [];

  await db.transaction(async (tx) => {
    for (const line of data.lines) {
      const item = itemById.get(line.itemId)!;
      const ingredient = ingredientById.get(item.ingredientId)!;
      // received_qty SATUAN SAMA dengan sent_unit -- outlet cuma konfirmasi
      // angka, tidak pilih satuan lagi (mengurangi friksi tepat di langkah
      // paling sensitif waktu). Faktor konversi diambil dari
      // ingredient.purchaseFactor kalau sent_unit = purchase_unit,
      // 1 kalau sent_unit sudah base_unit.
      const factor =
        item.sentUnit === ingredient.baseUnit ? new Decimal(1) : new Decimal(ingredient.purchaseFactor);

      const receivedQty = new Decimal(line.receivedQty);
      const sentQty = new Decimal(item.sentQty ?? "0");
      const sentUnitCost = new Decimal(item.sentUnitCost ?? "0");
      const receivedQtyBase = receivedQty.times(factor);
      const unitCostBase = sentUnitCost.dividedBy(factor);

      const [level] = await tx
        .select()
        .from(stockLevels)
        .where(and(eq(stockLevels.ingredientId, item.ingredientId), eq(stockLevels.outletId, transfer.toOutletId)))
        .for("update");
      const qtyLama = level ? new Decimal(level.qtyOnHand) : new Decimal(0);
      const avgCostLama = level ? new Decimal(level.avgCost) : new Decimal(0);
      const newAvgCost = calculateNewAvgCost(qtyLama, avgCostLama, receivedQtyBase, unitCostBase);
      const balanceAfter = qtyLama.plus(receivedQtyBase);
      const totalCost = receivedQtyBase.times(unitCostBase);

      await tx.insert(stockMovements).values({
        businessId,
        outletId: transfer.toOutletId,
        ingredientId: item.ingredientId,
        movementType: "transfer_in",
        qty: receivedQtyBase.toFixed(4),
        unitCost: unitCostBase.toFixed(8),
        totalCost: totalCost.toFixed(2),
        balanceAfter: balanceAfter.toFixed(4),
        avgCostAfter: newAvgCost.toFixed(8),
        refType: "stock_transfer",
        refId: data.transferId,
        businessDate: bDate,
        createdBy: data.receivedBy,
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

      if (!sentQty.equals(receivedQty)) {
        // transfer_loss -- CATATAN NILAI, TIDAK mengubah stock_levels.
        // transfer_in di atas SUDAH mencatat saldo outlet dengan tepat
        // (sebesar received_qty) -- movement ini cuma untuk laporan
        // "selisih pengiriman", balance_after/avg_cost_after DIBAWA
        // TERUS dari transfer_in di atas, BUKAN dihitung ulang. Baca
        // docs/04-CATATAN-TEKNIS.md sebelum "memperbaiki" ini jadi
        // mengurangi stok lagi.
        const lossQtyBase = sentQty.minus(receivedQty).times(factor);
        const lossValue = lossQtyBase.times(unitCostBase);
        await tx.insert(stockMovements).values({
          businessId,
          outletId: transfer.toOutletId,
          ingredientId: item.ingredientId,
          movementType: "transfer_loss",
          qty: lossQtyBase.negated().toFixed(4),
          unitCost: unitCostBase.toFixed(8),
          totalCost: lossValue.negated().toFixed(2),
          balanceAfter: balanceAfter.toFixed(4), // TIDAK dikurangi lagi -- lihat komentar di atas
          avgCostAfter: newAvgCost.toFixed(8),
          refType: "stock_transfer",
          refId: data.transferId,
          businessDate: bDate,
          note: line.diffReason || null,
          createdBy: data.receivedBy,
        });

        discrepancies.push({
          ingredientId: item.ingredientId,
          ingredientName: ingredient.name,
          sentQty: sentQty.toFixed(4),
          receivedQty: receivedQty.toFixed(4),
          unit: item.sentUnit ?? "",
          lossValue: lossValue.toFixed(2),
        });
      }

      await tx
        .update(stockTransferItems)
        .set({
          receivedQty: receivedQty.toFixed(4),
          receiveDiffReason: line.diffReason || null,
          qty: receivedQtyBase.toFixed(4),
          unitCost: unitCostBase.toFixed(8),
        })
        .where(and(eq(stockTransferItems.id, line.itemId), eq(stockTransferItems.businessId, businessId)));
    }

    const updated = await tx
      .update(stockTransfers)
      .set({
        status: "received",
        receivedBy: data.receivedBy,
        receivedAt: now,
        receivedPhotoPath: data.photo.photoPath ?? null,
        receivedPhotoMissingReason: data.photo.photoMissingReason ?? null,
      })
      .where(
        and(
          eq(stockTransfers.id, data.transferId),
          eq(stockTransfers.businessId, businessId),
          eq(stockTransfers.status, "sent")
        )
      )
      .returning({ id: stockTransfers.id });
    assertRowsAffected(updated, "penerimaan transfer stok");

    await tx.insert(auditLogs).values({
      id: generateId(),
      businessId,
      outletId: transfer.toOutletId,
      employeeId: data.receivedBy,
      action: "receive_stock_transfer",
      refType: "stock_transfer",
      refId: data.transferId,
      metadata: { lineCount: data.lines.length, discrepancies },
      createdAt: now,
    });
  });

  return { success: { transferId: data.transferId }, discrepancies: discrepancies.length > 0 ? discrepancies : undefined };
}

// ---------------------------------------------------------------------
// 5. Cancel -- dari requested/approved (murni status, tidak ada stok
//    yang tersentuh) atau received (reversal penuh, mekanisme v1).
//    SENGAJA TIDAK dari 'sent' -- lihat komentar schema.ts.
// ---------------------------------------------------------------------

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
  allowedOutletIds: OutletScope,
  rawInput: unknown
): Promise<CancelStockTransferResult> {
  const parsed = cancelSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const data = parsed.data;

  const [transfer] = await db.select().from(stockTransfers).where(
    and(eq(stockTransfers.id, data.transferId), eq(stockTransfers.businessId, businessId))
  );
  if (!transfer || !["requested", "approved", "received"].includes(transfer.status)) {
    return { error: strings.stockTransfers.cannotCancelStatus };
  }
  // Pembatasan akses per outlet, Tahap 4 (13 September 2026, §28) --
  // requested/approved: belum ada stok bergerak, murni keputusan outlet
  // peminta -> toOutletId saja. received: reversal ini menyentuh stok
  // outlet peminta TANPA membalik pengiriman gudang (keputusan akuntansi
  // v1 yang sengaja, lihat komentar di bawah) -- tapi justru karena
  // sepihak begitu, PERTANYAAN AKSES-nya baru: gudang juga berkepentingan
  // (pengiriman yang sudah tercatat dibatalkan sepihak oleh outlet), jadi
  // KEDUA outlet (fromOutletId DAN toOutletId) harus di dalam cakupan.
  // Ini bukan mengubah aturan akuntansi cancel-dari-received, cuma
  // mengetatkan siapa yang boleh memicunya.
  const outletAccessOk =
    transfer.status === "received"
      ? isOutletAllowed(allowedOutletIds, transfer.fromOutletId) && isOutletAllowed(allowedOutletIds, transfer.toOutletId)
      : isOutletAllowed(allowedOutletIds, transfer.toOutletId);
  if (!outletAccessOk) {
    return { error: strings.common.outletAccessDenied };
  }

  const now = new Date();

  // requested/approved: belum ada stok yang tersentuh sama sekali --
  // murni ganti status, tidak ada reversal untuk ditulis.
  if (transfer.status === "requested" || transfer.status === "approved") {
    await db.transaction(async (tx) => {
      const updated = await tx
        .update(stockTransfers)
        .set({ status: "cancelled", cancelReason: data.reason, cancelledAt: now, cancelledBy: data.cancelledBy })
        .where(and(eq(stockTransfers.id, data.transferId), eq(stockTransfers.businessId, businessId)))
        .returning({ id: stockTransfers.id });
      assertRowsAffected(updated, "pembatalan transfer stok");

      await tx.insert(auditLogs).values({
        id: generateId(),
        businessId,
        outletId: transfer.toOutletId,
        employeeId: data.cancelledBy,
        action: "cancel_stock_transfer",
        refType: "stock_transfer",
        refId: transfer.id,
        reason: data.reason,
        createdAt: now,
      });
    });
    return { success: { cancelledAt: now.toISOString() } };
  }

  // received: reversal penuh di sisi OUTLET saja (mekanisme v1
  // dipertahankan) -- pakai item.qty/item.unit_cost (nilai base_unit
  // FINAL dari received_qty), bukan sent_qty. Stok GUDANG (transfer_out
  // saat kirim) TIDAK direversal -- barang memang sudah fisik
  // meninggalkan gudang terlepas dari koreksi catatan penerimaan outlet.
  const items = await db
    .select()
    .from(stockTransferItems)
    .where(eq(stockTransferItems.transferId, data.transferId));
  const ingredientRows = await db
    .select({ id: ingredients.id, name: ingredients.name, baseUnit: ingredients.baseUnit })
    .from(ingredients)
    .where(eq(ingredients.businessId, businessId));
  const ingredientById = new Map(ingredientRows.map((i) => [i.id, i]));

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
      if (!item.qty || !item.unitCost) continue; // seharusnya selalu terisi untuk transfer 'received'

      const [level] = await tx
        .select()
        .from(stockLevels)
        .where(and(eq(stockLevels.ingredientId, item.ingredientId), eq(stockLevels.outletId, transfer.toOutletId)))
        .for("update");
      const qtyLama = level ? new Decimal(level.qtyOnHand) : new Decimal(0);
      const avgCostLama = level ? new Decimal(level.avgCost) : new Decimal(0);
      const qtyMasuk = new Decimal(item.qty).negated();
      const costMasuk = new Decimal(item.unitCost);
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
        note: `Pembatalan penerimaan: ${data.reason}`,
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
      .set({ status: "cancelled", cancelReason: data.reason, cancelledAt: now, cancelledBy: data.cancelledBy })
      .where(and(eq(stockTransfers.id, data.transferId), eq(stockTransfers.businessId, businessId)))
      .returning({ id: stockTransfers.id });
    assertRowsAffected(updated, "pembatalan transfer stok");

    await tx.insert(auditLogs).values({
      id: generateId(),
      businessId,
      outletId: transfer.toOutletId,
      employeeId: data.cancelledBy,
      action: "cancel_stock_transfer",
      refType: "stock_transfer",
      refId: transfer.id,
      reason: data.reason,
      metadata: { warnings },
      createdAt: now,
    });
  });

  return { success: { cancelledAt: now.toISOString() }, warnings: warnings.length > 0 ? warnings : undefined };
}

// ---------------------------------------------------------------------
// "Ulangi permintaan terakhir" -- baca saja, bukan mutasi.
// ---------------------------------------------------------------------

export type LastRequestLine = { ingredientId: string; ingredientName: string; unit: string; qty: string };

export async function getLastRequestForOutlet(
  db: Db,
  businessId: string,
  allowedOutletIds: OutletScope,
  toOutletId: string
): Promise<LastRequestLine[]> {
  // Pembatasan akses per outlet, Tahap 4 (13 September 2026, §28) --
  // gerbang sendiri, TIDAK mengandalkan pemanggil sudah menyaring
  // toOutletId (pemanggil saat ini memang sudah menyaring lewat
  // outletScopeCondition di dropdown, tapi fungsi ini dipakai langsung
  // dengan toOutletId sebagai parameter -- kalau suatu hari dipanggil
  // dari tempat lain tanpa penyaringan itu, lubangnya harus tetap
  // tertutup di sini). Di luar cakupan = dianggap "tidak ada riwayat",
  // konsisten dengan tipe kembalian array kosong yang sudah ada.
  if (!isOutletAllowed(allowedOutletIds, toOutletId)) {
    return [];
  }

  const [last] = await db
    .select({ id: stockTransfers.id })
    .from(stockTransfers)
    .where(and(eq(stockTransfers.businessId, businessId), eq(stockTransfers.toOutletId, toOutletId)))
    .orderBy(desc(stockTransfers.createdAt))
    .limit(1);
  if (!last) return [];

  const items = await db
    .select({
      ingredientId: stockTransferItems.ingredientId,
      unit: stockTransferItems.requestedUnit,
      qty: stockTransferItems.requestedQty,
      ingredientName: ingredients.name,
    })
    .from(stockTransferItems)
    .innerJoin(ingredients, eq(stockTransferItems.ingredientId, ingredients.id))
    .where(eq(stockTransferItems.transferId, last.id));

  return items;
}
