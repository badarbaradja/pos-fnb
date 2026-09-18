/**
 * lib/stock-opnames/manage.ts — Langkah C: Stock Opname
 *
 * Seluruh logika opname fisik gudang:
 *   - Buat sesi (createOpnameWithDb)
 *   - Upsert item per bahan, satu-satu atau sekaligus (upsertOpnameItemWithDb /
 *     upsertOpnameItemsBulkWithDb)
 *   - Submit sesi + tulis adjustment ke stock_movements (submitOpnameWithDb)
 *
 * Desain kunci:
 *   - WRITE-ONCE: setelah submitted, tidak ada yang bisa diubah.
 *     Koreksi = sesi opname baru (pola countedCash di shifts).
 *   - PARSIAL AMAN: bahan yang tidak masuk daftar items DILEWATI,
 *     stoknya TIDAK berubah (bukan dianggap nol).
 *   - HARGA: unit_cost diisi otomatis dari avg_cost yang sudah ada,
 *     atau dari nilai default yang disediakan pemanggil (opname pertama
 *     dari material.csv). Bisa dioverride pengguna sebelum submit.
 *   - ALASAN SELISIH: TIDAK ADA lagi (dihapus 18 September 2026, instruksi
 *     eksplisit CEO) -- untuk opname, alasan tidak menambah apa pun, selisih
 *     sudah tercatat lengkap di stock_movements dan bisa ditelusuri lewat
 *     kartu stok. Kolom `outlets.varianceAlertValue`/`varianceAlertPercent`
 *     TETAP ada di skema (tidak dihapus), cuma tidak dibaca di sini lagi.
 */

import { and, eq, inArray } from "drizzle-orm";
import Decimal from "decimal.js";
import { getAdminDb, type UserDbHandle } from "@/lib/db/client";
import {
  ingredients,
  stockLevels,
  stockMovements,
  stockOpnameItems,
  stockOpnames,
} from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";

// ---------------------------------------------------------------------------
// Tipe publik
// ---------------------------------------------------------------------------

export type OpnameSummary = {
  id: string;
  outletId: string;
  status: "draft" | "submitted";
  businessDate: string;
  label: string | null;
  note: string | null;
  submittedAt: Date | null;
  createdAt: Date;
  itemCount: number;
  countedCount: number; // item yang physicalQty sudah diisi
};

export type OpnameItemRow = {
  id: string;
  ingredientId: string;
  ingredientName: string;
  baseUnit: string;
  systemQty: string; // Decimal string
  physicalQty: string | null; // null = belum dihitung
  unitCost: string; // Decimal string (20,8)
  variance: string | null; // null sebelum submit
};

/** Payload untuk upsert satu baris item sebelum submit */
export type UpsertOpnameItemPayload = {
  ingredientId: string;
  physicalQty: string; // Decimal string, dalam base_unit
  unitCost: string; // Decimal string per base_unit
};

/** Hasil submit: ringkasan movement yang dibuat */
export type SubmitOpnameResult = {
  opnameId: string;
  movementsCreated: number;
  itemsSkipped: number; // physicalQty masih null
  itemsZeroVariance: number; // physicalQty == systemQty, tidak dibuat movement
};

// ---------------------------------------------------------------------------
// Buat sesi opname baru (status draft)
// ---------------------------------------------------------------------------

/**
 * Buat sesi opname baru untuk outlet. Satu outlet boleh punya banyak sesi
 * draft — tidak ada pembatasan "hanya satu draft aktif" karena user mungkin
 * membuka beberapa sesi sebelum memutuskan mana yang akan disubmit.
 *
 * @param db  getUserDb() — koneksi RLS user sungguhan (dashboard, bukan kasir PIN)
 */
export async function createOpnameWithDb(
  db: UserDbHandle["db"],
  params: {
    businessId: string;
    outletId: string;
    businessDate: string; // 'YYYY-MM-DD'
    label?: string;
    createdByEmployeeId?: string;
  }
): Promise<string> {
  const [row] = await db
    .insert(stockOpnames)
    .values({
      id: generateId(),
      businessId: params.businessId,
      outletId: params.outletId,
      businessDate: params.businessDate,
      label: params.label ?? null,
      createdBy: params.createdByEmployeeId ?? null,
    })
    .returning({ id: stockOpnames.id });
  if (!row) throw new Error("createOpnameWithDb: insert tidak menghasilkan baris");
  return row.id;
}

// ---------------------------------------------------------------------------
// Daftar bahan untuk UI opname
// ---------------------------------------------------------------------------

/**
 * Ambil daftar semua bahan aktif untuk outlet + snapshot stok sistem +
 * item opname yang sudah ada di sesi ini.
 *
 * Pengguna melihat SEMUA bahan, bukan cuma yang sudah diisi — supaya
 * tidak ada yang terlewat secara tidak sengaja.
 *
 * hargaDefault: peta ingredientId → harga (untuk opname pertama di mana
 *   avg_cost masih 0, diisi dari material.csv oleh pemanggil).
 *   Kosong = pakai avg_cost dari stock_levels saja.
 */
export async function getOpnameItemsForSession(
  db: UserDbHandle["db"],
  params: {
    businessId: string;
    outletId: string;
    opnameId: string;
    hargaDefault?: Map<string, string>; // ingredientId → unit_cost string
  }
): Promise<OpnameItemRow[]> {
  const { businessId, outletId, opnameId, hargaDefault } = params;

  // Ambil semua bahan aktif bisnis ini
  const allIngredients = await db
    .select({
      id: ingredients.id,
      name: ingredients.name,
      baseUnit: ingredients.baseUnit,
    })
    .from(ingredients)
    .where(and(eq(ingredients.businessId, businessId), eq(ingredients.isActive, true)));

  // Ambil stock_levels untuk outlet ini (untuk systemQty dan avg_cost)
  const levels = await db
    .select({
      ingredientId: stockLevels.ingredientId,
      qtyOnHand: stockLevels.qtyOnHand,
      avgCost: stockLevels.avgCost,
    })
    .from(stockLevels)
    .where(and(eq(stockLevels.businessId, businessId), eq(stockLevels.outletId, outletId)));

  const levelMap = new Map(
    levels.map((l) => [l.ingredientId, { qty: l.qtyOnHand, avgCost: l.avgCost }])
  );

  // Ambil item yang sudah diisi di sesi ini
  const existingItems = await db
    .select({
      ingredientId: stockOpnameItems.ingredientId,
      physicalQty: stockOpnameItems.physicalQty,
      unitCost: stockOpnameItems.unitCost,
      variance: stockOpnameItems.variance,
      id: stockOpnameItems.id,
    })
    .from(stockOpnameItems)
    .where(eq(stockOpnameItems.opnameId, opnameId));

  const existingMap = new Map(existingItems.map((i) => [i.ingredientId, i]));

  return allIngredients.map((ing) => {
    const level = levelMap.get(ing.id);
    const existing = existingMap.get(ing.id);
    const systemQty = level?.qty ?? "0";
    const avgCost = level?.avgCost ?? "0";

    // Tentukan unit_cost: existing item > avg_cost (kalau > 0) > hargaDefault
    let unitCost: string;
    if (existing) {
      unitCost = existing.unitCost;
    } else if (new Decimal(avgCost).gt(0)) {
      unitCost = avgCost;
    } else if (hargaDefault?.has(ing.id)) {
      unitCost = hargaDefault.get(ing.id)!;
    } else {
      unitCost = "0";
    }

    return {
      id: existing?.id ?? "",
      ingredientId: ing.id,
      ingredientName: ing.name,
      baseUnit: ing.baseUnit,
      systemQty,
      physicalQty: existing?.physicalQty ?? null,
      unitCost,
      variance: existing?.variance ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Upsert satu item (sebelum submit)
// ---------------------------------------------------------------------------

/**
 * Simpan / perbarui satu baris item opname sebelum submit.
 *
 * DITOLAK kalau sesi sudah submitted (write-once).
 *
 * Menggunakan INSERT ... ON CONFLICT DO UPDATE untuk idempoten — user
 * bisa mengedit physicalQty berkali-kali sebelum submit.
 *
 * systemQty di-snapshot saat pertama kali item dibuat di sesi ini.
 * Kalau row sudah ada, systemQty TIDAK diubah (snapshot lama tetap).
 */
export async function upsertOpnameItemWithDb(
  db: UserDbHandle["db"],
  params: {
    businessId: string;
    outletId: string;
    opnameId: string;
    item: UpsertOpnameItemPayload;
  }
): Promise<void> {
  const { businessId, outletId, opnameId, item } = params;

  // Guard: cek status sesi
  const [opname] = await db
    .select({ status: stockOpnames.status })
    .from(stockOpnames)
    .where(and(eq(stockOpnames.id, opnameId), eq(stockOpnames.businessId, businessId)));

  if (!opname) throw new Error("Sesi opname tidak ditemukan");
  if (opname.status === "submitted") {
    throw new Error("Sesi opname sudah disubmit dan tidak bisa diubah. Buat sesi baru untuk koreksi.");
  }

  // Ambil systemQty (snapshot kalau belum ada baris)
  const [existing] = await db
    .select({ id: stockOpnameItems.id, systemQty: stockOpnameItems.systemQty })
    .from(stockOpnameItems)
    .where(
      and(
        eq(stockOpnameItems.opnameId, opnameId),
        eq(stockOpnameItems.ingredientId, item.ingredientId)
      )
    );

  if (existing) {
    // Update: physicalQty, unitCost. systemQty TETAP.
    await db
      .update(stockOpnameItems)
      .set({
        physicalQty: item.physicalQty,
        unitCost: item.unitCost,
        updatedAt: new Date(),
      })
      .where(eq(stockOpnameItems.id, existing.id));
  } else {
    // Insert baru — ambil systemQty dari stock_levels
    const [level] = await db
      .select({ qtyOnHand: stockLevels.qtyOnHand })
      .from(stockLevels)
      .where(
        and(
          eq(stockLevels.businessId, businessId),
          eq(stockLevels.outletId, outletId),
          eq(stockLevels.ingredientId, item.ingredientId)
        )
      );

    const systemQty = level?.qtyOnHand ?? "0";

    await db.insert(stockOpnameItems).values({
      id: generateId(),
      opnameId,
      businessId,
      ingredientId: item.ingredientId,
      systemQty,
      physicalQty: item.physicalQty,
      unitCost: item.unitCost,
    });
  }
}

// ---------------------------------------------------------------------------
// Upsert BANYAK item sekaligus (18 September 2026 -- instruksi eksplisit
// CEO: 225 baris x satu klik Simpan per baris tidak bisa dipakai)
// ---------------------------------------------------------------------------

/**
 * Simpan / perbarui BANYAK baris item opname sekaligus -- dipakai tombol
 * "Simpan Semua" dan auto-save berkala dari UI. Sama aturan dengan
 * upsertOpnameItemWithDb (write-once, systemQty snapshot tidak berubah),
 * cuma status sesi + systemQty bahan baru diambil SEKALI (bukan per baris)
 * supaya tidak perlu 225 kali bolak-balik ke database.
 *
 * Baris dengan physicalQty kosong TIDAK BOLEH masuk ke `items` -- pemanggil
 * (workspace UI) yang menyaringnya SEBELUM memanggil ini, konsisten dengan
 * aturan "belum diisi = dilewati, bukan dianggap nol" (lihat komentar
 * kepala berkas).
 */
export async function upsertOpnameItemsBulkWithDb(
  db: UserDbHandle["db"],
  params: {
    businessId: string;
    outletId: string;
    opnameId: string;
    items: UpsertOpnameItemPayload[];
  }
): Promise<{ saved: number }> {
  const { businessId, outletId, opnameId, items } = params;
  if (items.length === 0) return { saved: 0 };

  // Guard: cek status sesi SEKALI, bukan per baris.
  const [opname] = await db
    .select({ status: stockOpnames.status })
    .from(stockOpnames)
    .where(and(eq(stockOpnames.id, opnameId), eq(stockOpnames.businessId, businessId)));

  if (!opname) throw new Error("Sesi opname tidak ditemukan");
  if (opname.status === "submitted") {
    throw new Error("Sesi opname sudah disubmit dan tidak bisa diubah. Buat sesi baru untuk koreksi.");
  }

  const ingredientIds = items.map((i) => i.ingredientId);

  // Baris yang SUDAH ada di sesi ini -- systemQty snapshot-nya TIDAK berubah.
  const existingRows = await db
    .select({ id: stockOpnameItems.id, ingredientId: stockOpnameItems.ingredientId })
    .from(stockOpnameItems)
    .where(
      and(eq(stockOpnameItems.opnameId, opnameId), inArray(stockOpnameItems.ingredientId, ingredientIds))
    );
  const existingMap = new Map(existingRows.map((r) => [r.ingredientId, r.id]));

  // Bahan yang BELUM ada baris di sesi ini -- perlu systemQty dari stock_levels,
  // diambil SEKALIGUS (bukan satu query per bahan baru).
  const newIngredientIds = ingredientIds.filter((id) => !existingMap.has(id));
  const levelRows =
    newIngredientIds.length > 0
      ? await db
          .select({ ingredientId: stockLevels.ingredientId, qtyOnHand: stockLevels.qtyOnHand })
          .from(stockLevels)
          .where(
            and(
              eq(stockLevels.businessId, businessId),
              eq(stockLevels.outletId, outletId),
              inArray(stockLevels.ingredientId, newIngredientIds)
            )
          )
      : [];
  const levelMap = new Map(levelRows.map((l) => [l.ingredientId, l.qtyOnHand]));

  let saved = 0;
  for (const item of items) {
    const existingId = existingMap.get(item.ingredientId);
    if (existingId) {
      await db
        .update(stockOpnameItems)
        .set({ physicalQty: item.physicalQty, unitCost: item.unitCost, updatedAt: new Date() })
        .where(eq(stockOpnameItems.id, existingId));
    } else {
      await db.insert(stockOpnameItems).values({
        id: generateId(),
        opnameId,
        businessId,
        ingredientId: item.ingredientId,
        systemQty: levelMap.get(item.ingredientId) ?? "0",
        physicalQty: item.physicalQty,
        unitCost: item.unitCost,
      });
    }
    saved++;
  }
  return { saved };
}

// ---------------------------------------------------------------------------
// Submit opname: validasi, hitung variance, tulis stock_movements
// ---------------------------------------------------------------------------

/**
 * Submit sesi opname. Setelah ini sesi terkunci (write-once).
 *
 * Alur:
 * 1. Validasi: sesi harus draft.
 * 2. Untuk setiap item yang physicalQty != null:
 *    a. Hitung variance = physicalQty - systemQty
 *    b. Tulis stock_movement (opname_adjust), update stock_levels.
 * 3. Update opname.status = submitted, isi submitted_by, submitted_at,
 *    variance per item.
 *
 * CATATAN (18 September 2026, instruksi eksplisit CEO): alasan selisih
 * TIDAK LAGI wajib atau memblokir submit -- untuk opname, selisihnya
 * sendiri sudah tercatat di ledger (stock_movements) dan bisa ditelusuri
 * lewat kartu stok, alasan tertulis tidak menambah apa pun. Kolom
 * `outlets.varianceAlertValue`/`varianceAlertPercent` SENGAJA TIDAK
 * dihapus dari skema (mungkin dipakai lagi untuk keperluan lain nanti),
 * cuma tidak lagi dibaca/dipakai memblokir apa pun di sini.
 *
 * Menggunakan getAdminDb() karena:
 *   a. stock_movements hanya punya INSERT policy (bukan UPDATE) -- update
 *      stock_levels butuh UPDATE policy yang ada, tapi lewat transaksi
 *      yang sama memudahkan atomisitas.
 *   b. Transisi status opname (draft→submitted) tidak punya UPDATE policy
 *      di RLS -- sengaja, supaya user tidak bisa men-submit sendiri tanpa
 *      melalui validasi ini.
 *
 * @param businessDate tanggal bisnis transaksi (dari outlet.dayCutoffTime)
 */
export async function submitOpnameWithDb(
  userDb: UserDbHandle["db"],
  params: {
    businessId: string;
    outletId: string;
    opnameId: string;
    submittedByEmployeeId?: string;
    businessDate: string; // 'YYYY-MM-DD'
    note?: string;
  }
): Promise<SubmitOpnameResult> {
  const { businessId, outletId, opnameId, submittedByEmployeeId, businessDate, note } = params;

  // Ambil sesi
  const [opname] = await userDb
    .select({
      id: stockOpnames.id,
      status: stockOpnames.status,
      businessId: stockOpnames.businessId,
      outletId: stockOpnames.outletId,
    })
    .from(stockOpnames)
    .where(and(eq(stockOpnames.id, opnameId), eq(stockOpnames.businessId, businessId)));

  if (!opname) throw new Error("Sesi opname tidak ditemukan");
  if (opname.status === "submitted") {
    throw new Error("Sesi opname sudah disubmit. Tidak bisa disubmit ulang.");
  }

  // Ambil semua item sesi
  const items = await userDb
    .select({
      id: stockOpnameItems.id,
      ingredientId: stockOpnameItems.ingredientId,
      systemQty: stockOpnameItems.systemQty,
      physicalQty: stockOpnameItems.physicalQty,
      unitCost: stockOpnameItems.unitCost,
    })
    .from(stockOpnameItems)
    .where(eq(stockOpnameItems.opnameId, opnameId));

  // Pisahkan item yang sudah dihitung vs dilewati
  const counted = items.filter((i) => i.physicalQty !== null);
  const skipped = items.filter((i) => i.physicalQty === null);

  // Pakai adminDb untuk atomisitas + update tabel yang tidak punya UPDATE
  // RLS policy (stock_levels, stock_opnames)
  const adminDb = getAdminDb(); // sistem: submit opname adalah operasi transaksional multi-tabel (CLAUDE.md §3.4)

  let movementsCreated = 0;
  let zeroVariance = 0;

  await adminDb.transaction(async (tx) => {
    for (const item of counted) {
      const system = new Decimal(item.systemQty);
      const physical = new Decimal(item.physicalQty!);
      const variance = physical.minus(system);
      const cost = new Decimal(item.unitCost);
      const totalCost = variance.times(cost).toFixed(2);

      // Ambil stock_level saat ini untuk balanceAfter dan avgCostAfter
      const [level] = await tx
        .select({
          qtyOnHand: stockLevels.qtyOnHand,
          avgCost: stockLevels.avgCost,
        })
        .from(stockLevels)
        .where(
          and(
            eq(stockLevels.ingredientId, item.ingredientId),
            eq(stockLevels.outletId, outletId)
          )
        );

      const currentQty = new Decimal(level?.qtyOnHand ?? "0");
      const currentAvgCost = new Decimal(level?.avgCost ?? "0");
      const balanceAfter = currentQty.plus(variance);

      // WAC baru setelah opname pertama / adjustment positif
      // Kalau variance negatif (kurang fisik), avg_cost TIDAK berubah
      // (kita tidak "menjual" stok, kita mencatat hilang).
      // Kalau variance positif (lebih fisik), avg_cost di-blend dengan
      // unit_cost yang diberikan (termasuk untuk opname pertama dari material.csv).
      let avgCostAfter: Decimal;
      if (variance.gt(0)) {
        // Blend: (currentQty * currentAvgCost + variance * cost) / balanceAfter
        if (balanceAfter.isZero()) {
          avgCostAfter = cost; // Kasus edge: semua baru, pakai cost baru
        } else {
          const totalCurrentValue = currentQty.times(currentAvgCost);
          const addedValue = variance.times(cost);
          avgCostAfter = totalCurrentValue.plus(addedValue).div(balanceAfter);
        }
      } else if (variance.lt(0) && balanceAfter.isZero()) {
        // Stok jadi nol, reset avg_cost ke 0
        avgCostAfter = new Decimal(0);
      } else {
        avgCostAfter = currentAvgCost; // Variance negatif atau nol, avg_cost tetap
      }

      if (variance.isZero()) {
        zeroVariance++;
        // Update variance di item tapi tidak buat movement
        await tx
          .update(stockOpnameItems)
          .set({ variance: "0" })
          .where(eq(stockOpnameItems.id, item.id));
        continue;
      }

      // Tulis stock_movement
      await tx.insert(stockMovements).values({
        id: generateId(),
        businessId,
        outletId,
        ingredientId: item.ingredientId,
        movementType: "opname_adjust",
        qty: variance.toFixed(4),
        unitCost: cost.toFixed(8),
        totalCost,
        balanceAfter: balanceAfter.toFixed(4),
        avgCostAfter: avgCostAfter.toDecimalPlaces(8).toFixed(8),
        refType: "opname",
        refId: opnameId,
        businessDate,
        // Alasan selisih TIDAK LAGI dikumpulkan (18 September 2026) --
        // selisihnya sendiri sudah tercatat lengkap di baris movement ini
        // (qty/totalCost/refType='opname'), bisa ditelusuri lewat kartu
        // stok tanpa perlu catatan tambahan.
        note: null,
        createdBy: submittedByEmployeeId ?? null,
      });
      movementsCreated++;

      // Update atau upsert stock_levels
      if (level) {
        await tx
          .update(stockLevels)
          .set({
            qtyOnHand: balanceAfter.toFixed(4),
            avgCost: avgCostAfter.toDecimalPlaces(8).toFixed(8),
            lastCountedAt: new Date(),
          })
          .where(
            and(
              eq(stockLevels.ingredientId, item.ingredientId),
              eq(stockLevels.outletId, outletId)
            )
          );
      } else {
        // Belum ada baris stock_levels untuk bahan ini di outlet ini
        // (bahan baru, opname pertama)
        await tx.insert(stockLevels).values({
          businessId,
          ingredientId: item.ingredientId,
          outletId,
          qtyOnHand: balanceAfter.toFixed(4),
          avgCost: avgCostAfter.toDecimalPlaces(8).toFixed(8),
          lastCountedAt: new Date(),
        });
      }

      // Update variance di item
      await tx
        .update(stockOpnameItems)
        .set({ variance: variance.toFixed(4) })
        .where(eq(stockOpnameItems.id, item.id));
    }

    // Tandai sesi sebagai submitted -- guard `status='draft'` di WHERE
    // (bukan cuma cek SELECT di atas) supaya dua submit bersamaan
    // (double-tap/race) tidak bisa dua-duanya lolos, pola atomik sama
    // persis submitCountedCashWithDb (lib/pos/shift.ts). Kalau 0 baris
    // ter-update, sesi ini sudah disubmit proses lain SETELAH SELECT di
    // atas tapi SEBELUM titik ini -- lempar error supaya seluruh
    // transaksi (termasuk stock_movements/stock_levels yang baru
    // ditulis) di-ROLLBACK, bukan diam-diam menyisakan movement ganda.
    const submitted = await tx
      .update(stockOpnames)
      .set({
        status: "submitted",
        submittedBy: submittedByEmployeeId ?? null,
        submittedAt: new Date(),
        note: note ?? null,
      })
      .where(and(eq(stockOpnames.id, opnameId), eq(stockOpnames.status, "draft")))
      .returning({ id: stockOpnames.id });
    if (submitted.length === 0) {
      throw new Error("Sesi opname sudah disubmit. Tidak bisa disubmit ulang.");
    }
  });

  return {
    opnameId,
    movementsCreated,
    itemsSkipped: skipped.length,
    itemsZeroVariance: zeroVariance,
  };
}

// ---------------------------------------------------------------------------
// Helper: cek apakah ada sesi draft yang belum disubmit
// ---------------------------------------------------------------------------

export async function getActiveOpnameDrafts(
  db: UserDbHandle["db"],
  params: { businessId: string; outletId: string }
): Promise<{ id: string; businessDate: string; label: string | null; createdAt: Date }[]> {
  return db
    .select({
      id: stockOpnames.id,
      businessDate: stockOpnames.businessDate,
      label: stockOpnames.label,
      createdAt: stockOpnames.createdAt,
    })
    .from(stockOpnames)
    .where(
      and(
        eq(stockOpnames.businessId, params.businessId),
        eq(stockOpnames.outletId, params.outletId),
        eq(stockOpnames.status, "draft")
      )
    );
}
