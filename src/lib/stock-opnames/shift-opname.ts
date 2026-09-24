/**
 * lib/stock-opnames/shift-opname.ts — Rencana Revisi 24 September 2026, §7
 * poin 4: opname 'buka'/'tutup' terikat ke SATU shift, HANYA untuk bahan
 * `ingredients.hitungTiapShift = true` DAN yang punya baris `stock_levels`
 * di OUTLET shift itu sendiri (daftar pendek per-OUTLET, bukan per-bisnis
 * -- lihat komentar getFlaggedIngredientIds() di bawah untuk bug yang
 * diperbaiki 24 September 2026 sebelum sempat dipakai, dan
 * docs/04-CATATAN-TEKNIS.md §20).
 *
 * File ini TERPISAH dari lib/stock-opnames/manage.ts (opname 'berkala', yang
 * sengaja TIDAK diubah) supaya jelas: apa pun di sini boleh berevolusi
 * bebas tanpa risiko menyentuh alur opname lama. Menulis lewat fungsi yang
 * SAMA (upsertOpnameItemWithDb/upsertOpnameItemsBulkWithDb/submitOpnameWithDb
 * di manage.ts) -- tidak ada duplikasi logika movement/ledger, cuma
 * pembungkus yang tahu soal shift dan daftar bahan terbatas.
 */

import { and, desc, eq, exists, inArray, lt, sql } from "drizzle-orm";
import type { UserDbHandle } from "@/lib/db/client";
import {
  ingredients,
  shifts,
  stockLevels,
  stockMovements,
  stockOpnameItems,
  stockOpnames,
} from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";
import { getOpnameItemsForSession, submitOpnameWithDb, type OpnameItemRow } from "./manage";

type Db = UserDbHandle["db"];

/**
 * Bug ditemukan 24 September 2026, DIPERBAIKI SEBELUM sempat dipakai
 * sungguhan (nol bahan ditandai hari itu) -- dicatat di
 * docs/04-CATATAN-TEKNIS.md §20 alasan lengkapnya.
 *
 * Bahan masuk opname buka/tutup shift DI SATU OUTLET hanya kalau
 * hitungTiapShift=true DAN bahan itu punya baris stock_levels DI OUTLET
 * ITU (exists, bukan cuma businessId) -- bahan yang tidak pernah
 * tercatat stok di outlet tertentu memang tidak relevan dihitung di
 * sana. SEBELUM perbaikan ini, fungsi ini murni business-scoped (tidak
 * menerima outletId sama sekali) -- begitu SATU bahan ditandai untuk
 * outlet F&B, SEMUA outlet lain di bisnis yang sama (termasuk outlet
 * thrifting yang secara struktural tidak pernah punya stock_levels
 * bahan apa pun) ikut diminta opname bahan itu, walau systemQty-nya
 * SELALU nol di sana -- bukan cuma thrifting, outlet F&B mana pun yang
 * kebetulan tidak menyimpan bahan tertentu kena masalah yang sama.
 */
export async function getFlaggedIngredientIds(db: Db, businessId: string, outletId: string): Promise<string[]> {
  const rows = await db
    .select({ id: ingredients.id })
    .from(ingredients)
    .where(
      and(
        eq(ingredients.businessId, businessId),
        eq(ingredients.isActive, true),
        eq(ingredients.hitungTiapShift, true),
        exists(
          db
            .select({ one: sql`1` })
            .from(stockLevels)
            .where(
              and(
                eq(stockLevels.businessId, businessId),
                eq(stockLevels.outletId, outletId),
                eq(stockLevels.ingredientId, ingredients.id)
              )
            )
        )
      )
    );
  return rows.map((r) => r.id);
}

export type OpeningOpnameStatus = "not_required" | "pending" | "done";

/**
 * Status opname BUKA untuk satu shift -- dipakai lib/pos/shift.ts untuk
 * gerbang "kalau ADA bahan berflag, tampilkan layar opname stok awal
 * sebelum kasir bisa transaksi; kalau NOL bahan berflag, lewati sepenuhnya"
 * (Rencana Revisi §7 poin 4).
 *
 * "not_required" -- bisnis ini tidak punya satu pun bahan hitungTiapShift.
 * "pending" -- ada bahan berflag, TAPI belum ada opname 'buka' submitted
 *   untuk shift ini -- shift TIDAK boleh dipakai jualan.
 * "done" -- opname 'buka' shift ini sudah submitted (atau tidak ada bahan
 *   berflag sama sekali, ditangani di atas).
 */
export async function getOpeningOpnameStatus(
  db: Db,
  params: { businessId: string; outletId: string; shiftId: string }
): Promise<OpeningOpnameStatus> {
  const flagged = await getFlaggedIngredientIds(db, params.businessId, params.outletId);
  if (flagged.length === 0) return "not_required";

  const [existing] = await db
    .select({ status: stockOpnames.status })
    .from(stockOpnames)
    .where(
      and(
        eq(stockOpnames.shiftId, params.shiftId),
        eq(stockOpnames.jenis, "buka")
      )
    );
  return existing?.status === "submitted" ? "done" : "pending";
}

/**
 * Ambil sesi opname 'buka'/'tutup' untuk shift ini kalau sudah ada
 * (draft ATAU submitted), atau buat baru (draft) kalau belum ada.
 * Idempoten -- boleh dipanggil berkali-kali (mis. kasir membuka layar
 * opname lebih dari sekali sebelum submit) berkat
 * `stock_opnames_shift_jenis_unique` (shiftId, jenis).
 */
export async function getOrCreateShiftOpnameWithDb(
  db: Db,
  params: {
    businessId: string;
    outletId: string;
    shiftId: string;
    jenis: "buka" | "tutup";
    businessDate: string; // 'YYYY-MM-DD'
  }
): Promise<{ id: string; status: "draft" | "submitted" }> {
  const [existing] = await db
    .select({ id: stockOpnames.id, status: stockOpnames.status })
    .from(stockOpnames)
    .where(and(eq(stockOpnames.shiftId, params.shiftId), eq(stockOpnames.jenis, params.jenis)));
  if (existing) return existing;

  const [row] = await db
    .insert(stockOpnames)
    .values({
      id: generateId(),
      businessId: params.businessId,
      outletId: params.outletId,
      shiftId: params.shiftId,
      jenis: params.jenis,
      businessDate: params.businessDate,
    })
    .returning({ id: stockOpnames.id, status: stockOpnames.status });
  if (!row) throw new Error("getOrCreateShiftOpnameWithDb: insert tidak menghasilkan baris");
  return row;
}

export type ShiftOpnameItemRow = OpnameItemRow & {
  varianceReason: string | null;
  /**
   * HANYA untuk jenis 'buka'. Saldo akhir shift sebelumnya di outlet yang
   * sama, dibaca dari stock_movements.balanceAfter (bukan systemQty --
   * lihat komentar validasiAlasanSelisihWajib di manage.ts kenapa dua-duanya
   * sengaja dipisah). `null` = tidak ada pembanding (bahan ini belum pernah
   * punya movement sebelum shift ini dibuka).
   */
  previousClosingBalance: string | null;
};

/**
 * Bahan berflag (hitungTiapShift) untuk SATU sesi opname shift-linked,
 * lengkap dengan systemQty/physicalQty/unitCost/varianceReason yang sudah
 * tersimpan (kalau ada), plus -- untuk 'buka' -- saldo akhir shift
 * sebelumnya untuk ditampilkan berdampingan (Rencana Revisi §7 poin 4:
 * "Stok awal ditampilkan BERDAMPINGAN dengan stok akhir shift sebelumnya").
 *
 * TIDAK memakai getOpnameItemsForSession (manage.ts) apa adanya -- itu
 * mengambil SEMUA bahan aktif bisnis, di sini cuma bahan berflag.
 */
export async function getShiftOpnameItemsForSession(
  db: Db,
  params: {
    businessId: string;
    outletId: string;
    opnameId: string;
    jenis: "buka" | "tutup";
    shiftId: string;
  }
): Promise<{ items: ShiftOpnameItemRow[]; isFirstShiftAtOutlet: boolean }> {
  const { businessId, outletId, opnameId, jenis, shiftId } = params;

  const flaggedIds = await getFlaggedIngredientIds(db, businessId, outletId);

  const [shift] = await db
    .select({ openedAt: shifts.openedAt })
    .from(shifts)
    .where(eq(shifts.id, shiftId));
  if (!shift) throw new Error("getShiftOpnameItemsForSession: shift tidak ditemukan");

  let isFirstShiftAtOutlet = false;
  if (jenis === "buka") {
    const [shiftSebelumnya] = await db
      .select({ id: shifts.id })
      .from(shifts)
      .where(
        and(
          eq(shifts.outletId, outletId),
          lt(shifts.openedAt, shift.openedAt),
          inArray(shifts.status, ["closed", "reconciled"])
        )
      )
      .limit(1);
    isFirstShiftAtOutlet = !shiftSebelumnya;
  }

  if (flaggedIds.length === 0) {
    return { items: [], isFirstShiftAtOutlet };
  }

  const semuaItem = await getOpnameItemsForSession(db, { businessId, outletId, opnameId });
  const flaggedSet = new Set(flaggedIds);
  const itemBerflag = semuaItem.filter((i) => flaggedSet.has(i.ingredientId));

  // varianceReason tidak ada di OpnameItemRow (manage.ts tidak
  // membutuhkannya untuk 'berkala') -- ambil terpisah, sekali per sesi.
  const existingReasons = await db
    .select({ ingredientId: stockOpnameItems.ingredientId, varianceReason: stockOpnameItems.varianceReason })
    .from(stockOpnameItems)
    .where(eq(stockOpnameItems.opnameId, opnameId));
  const reasonMap = new Map(existingReasons.map((r) => [r.ingredientId, r.varianceReason]));

  const baselineMap = new Map<string, string | null>();
  if (jenis === "buka" && !isFirstShiftAtOutlet) {
    for (const item of itemBerflag) {
      const [movementTerakhir] = await db
        .select({ balanceAfter: stockMovements.balanceAfter })
        .from(stockMovements)
        .where(
          and(
            eq(stockMovements.businessId, businessId),
            eq(stockMovements.outletId, outletId),
            eq(stockMovements.ingredientId, item.ingredientId),
            lt(stockMovements.createdAt, shift.openedAt)
          )
        )
        .orderBy(desc(stockMovements.createdAt))
        .limit(1);
      baselineMap.set(item.ingredientId, movementTerakhir?.balanceAfter ?? null);
    }
  }

  const items: ShiftOpnameItemRow[] = itemBerflag.map((i) => ({
    ...i,
    varianceReason: reasonMap.get(i.ingredientId) ?? null,
    previousClosingBalance: jenis === "buka" ? (baselineMap.get(i.ingredientId) ?? null) : null,
  }));

  return { items, isFirstShiftAtOutlet };
}

/**
 * Dipanggil oleh lib/pos/shift.ts di TITIK PASTI shift akan menjadi
 * closed/reconciled (Rencana Revisi 24 September 2026 §7 poin 4: "Tutup
 * shift: opname stok akhir, digabung ke alur tutup yang sudah ada, jangan
 * bikin langkah terpisah"). Dipanggil SEBELUM shift itu sendiri ditulis
 * `closed` -- kalau ini throw (alasan selisih wajib belum diisi), shift
 * TETAP 'open' dan pemanggil mengembalikan error itu ke kasir, bukan
 * menutup shift dulu baru gagal di step kedua.
 *
 * "Kalau NOL bahan berflag, lewati sepenuhnya" -- no-op langsung, TIDAK
 * membuat baris stock_opnames apa pun untuk bisnis yang belum menandai
 * bahan apa pun (semua bisnis pos-fnb hari ini, sampai Ita mengisi
 * checkbox-nya).
 *
 * Sesi 'tutup' untuk shift ini didapat dari yang SUDAH diisi kasir di layar
 * tutup shift (get-or-create -- idempoten kalau dipanggil dua kali, mis.
 * closeAndReopenShiftWithDb yang gagal di step lain lalu diulang). Kalau
 * belum ada sesi sama sekali (kasir belum pernah membuka/mengisi layar
 * hitung stok), sesi kosong dibuat lalu langsung disubmit -- SEMUA
 * item-nya "skipped" (physicalQty null), sama seperti opname biasa yang
 * sebagian bahan tidak dihitung (PARSIAL AMAN, lihat manage.ts) -- bukan
 * kegagalan, cuma tercatat jujur bahwa tidak ada yang dihitung hari itu.
 */
export async function finalizeShiftClosingOpnameIfAny(
  db: Db,
  params: {
    businessId: string;
    outletId: string;
    shiftId: string;
    businessDate: string; // 'YYYY-MM-DD'
    submittedByEmployeeId?: string;
  }
): Promise<void> {
  const flagged = await getFlaggedIngredientIds(db, params.businessId, params.outletId);
  if (flagged.length === 0) return;

  const opname = await getOrCreateShiftOpnameWithDb(db, {
    businessId: params.businessId,
    outletId: params.outletId,
    shiftId: params.shiftId,
    jenis: "tutup",
    businessDate: params.businessDate,
  });
  if (opname.status === "submitted") return; // sudah selesai (mis. dipanggil ulang setelah race/retry)

  await submitOpnameWithDb(db, {
    businessId: params.businessId,
    outletId: params.outletId,
    opnameId: opname.id,
    submittedByEmployeeId: params.submittedByEmployeeId,
    businessDate: params.businessDate,
  });
}
