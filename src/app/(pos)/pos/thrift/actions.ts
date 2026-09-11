"use server";

import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { findSellableBarangByKode, type LookupBarangResult } from "@/lib/barang/lookup";
import { sellBarangWithDb, type SellBarangResult } from "@/lib/pos/sell-barang";
import { addBarangFromShiftWithDb } from "@/lib/pos/pos-add-barang";
import type { BarangActionResult } from "@/lib/barang/manage";

export type { LookupBarangResult, SellBarangResult, BarangActionResult };

/**
 * Pembungkus Server Action tipis, pola sama app/(pos)/pos/actions.ts --
 * logika inti di lib/barang/lookup.ts dan lib/pos/sell-barang.ts.
 * "pos.create_order" dipakai untuk KEDUANYA (lookup adalah bagian dari
 * alur bikin order, bukan kelola master data) -- role yang sama yang
 * sudah boleh jualan F&B (owner/manager/cashier/waiter) juga boleh
 * jualan thrifting, sama gerbang persis /pos F&B.
 */
export async function lookupBarangByKode(kode: string): Promise<LookupBarangResult> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "pos.create_order");
  try {
    return await findSellableBarangByKode(db, businessId, kode);
  } finally {
    await closeDb();
  }
}

export async function sellBarang(input: unknown): Promise<SellBarangResult> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "pos.create_order");
  try {
    return await sellBarangWithDb(db, businessId, input);
  } finally {
    await closeDb();
  }
}

/**
 * "Ita super kasir" (11 September 2026) -- "pos.create_order" di sini
 * cuma memverifikasi sesi Supabase Auth PERANGKAT ini boleh dipakai jualan
 * (gerbang paling luar, sama semua action di file ini). Izin SUNGGUHAN
 * untuk menambah barang diputuskan di dalam addBarangFromShiftWithDb dari
 * role EMPLOYEE pemilik shift (PIN) -- BUKAN dari role membership sesi
 * ini. Lihat komentar lengkap di lib/pos/pos-add-barang.ts kenapa dua
 * identitas ini harus dipisah.
 */
export async function addBarangFromPos(
  shiftId: string,
  input: unknown
): Promise<BarangActionResult> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "pos.create_order");
  try {
    return await addBarangFromShiftWithDb(db, businessId, shiftId, input);
  } finally {
    await closeDb();
  }
}
