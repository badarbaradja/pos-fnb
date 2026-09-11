import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { z } from "zod";
import type { UserDbHandle } from "@/lib/db/client";
import { devices, outlets } from "@/lib/db/schema";
import { assertRowsAffected } from "@/lib/db/errors";
import { getOpenShiftForDevice } from "./shift";
import { id as strings } from "@/lib/i18n/id";

/**
 * lib/pos/device-pairing.ts — T22e. Sebelum ini, get-pos-catalog.ts DAN 4
 * halaman lain (shift/open, shift/close, receipt/page, receipt/list-orders)
 * masing-masing menebak sendiri "outlet aktif pertama business ini" --
 * benar secara kebetulan selama cuma ada satu outlet aktif per business,
 * salah total begitu Indosteak dapat outlet kedua (docs/05-RENCANA-FASE-2.md
 * §8, T22e). Modul ini SATU-SATUNYA sumber kebenaran "device fisik mana yang
 * sedang mengakses /pos", dipakai oleh kelima tempat itu.
 *
 * Cookie httpOnly, BUKAN localStorage -- localStorage cuma dipakai di
 * client (components/pos/setup-form.tsx) sebagai PETUNJUK pemulihan kalau
 * cookie hilang (browser dibersihkan, tablet di-reset, mode incognito),
 * TIDAK PERNAH sebagai sumber kebenaran. Server selalu validasi ulang
 * cookie terhadap tabel devices (businessId cocok, is_active) setiap kali
 * -- device yang dinonaktifkan/dihapus dari daftar otomatis dianggap
 * belum ter-pairing lagi.
 */

export const PAIR_COOKIE = "pos_device_id";
export const PAIR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 tahun -- tablet kasir jarang direstart

type Db = UserDbHandle["db"];

export type PairedOutlet = {
  id: string;
  name: string;
  code: string;
  taxPercent: string;
  taxInclusive: boolean;
  serviceChargePercent: string;
  serviceChargeInTaxBase: boolean;
  roundingTo: number;
  cashEnabled: boolean;
  cashVarianceTolerance: string;
  dayCutoffTime: string;
  // TT06 (10 September 2026) -- satu-satunya pembeda routing /pos (grid
  // produk F&B) vs /pos/thrift (barcode-first barang titipan). Lihat
  // komentar posModeEnum di schema.ts.
  posMode: "fnb" | "thrifting";
};

export type PairedDevice = { id: string; name: string };

/**
 * Dipanggil dari Server Component mana pun di app/(pos)/pos/* yang butuh
 * tahu outlet+device -- baca cookie httpOnly (read-only, aman dari Server
 * Component, TIDAK bisa set cookie dari sini, cuma dari Server Action).
 * Return null kalau belum ter-pairing ATAU device di cookie sudah tidak
 * valid lagi (dihapus/dinonaktifkan/pindah bisnis) -- pemanggil redirect
 * ke /pos/setup, TIDAK PERNAH menebak.
 */
export async function getPairedDevice(
  db: Db,
  businessId: string
): Promise<{ outlet: PairedOutlet; device: PairedDevice } | null> {
  const cookieStore = await cookies();
  const deviceId = cookieStore.get(PAIR_COOKIE)?.value;
  if (!deviceId || !z.string().uuid().safeParse(deviceId).success) {
    return null;
  }

  const [row] = await db
    .select({ device: devices, outlet: outlets })
    .from(devices)
    .innerJoin(outlets, eq(devices.outletId, outlets.id))
    .where(
      and(
        eq(devices.id, deviceId),
        eq(devices.businessId, businessId),
        eq(devices.isActive, true),
        eq(outlets.isActive, true)
      )
    );
  if (!row) {
    return null;
  }

  return {
    outlet: {
      id: row.outlet.id,
      name: row.outlet.name,
      code: row.outlet.code,
      taxPercent: row.outlet.taxPercent,
      taxInclusive: row.outlet.taxInclusive,
      serviceChargePercent: row.outlet.serviceChargePercent,
      serviceChargeInTaxBase: row.outlet.serviceChargeInTaxBase,
      roundingTo: row.outlet.roundingTo,
      cashEnabled: row.outlet.cashEnabled,
      cashVarianceTolerance: row.outlet.cashVarianceTolerance,
      dayCutoffTime: row.outlet.dayCutoffTime,
      posMode: row.outlet.posMode,
    },
    device: { id: row.device.id, name: row.device.name },
  };
}

export type PairDeviceResult = {
  error?: string;
  success?: { outlet: PairedOutlet; device: PairedDevice; warning?: string };
};

/**
 * Logika murni pairing (dipanggil dari Server Action
 * app/(pos)/pos/setup/actions.ts, yang baru bisa set cookie sungguhan --
 * pola thin-wrapper sama modul lib/ lain). TIDAK memblokir kalau device
 * kelihatan sedang dipakai di tempat lain (shift terbuka) -- cuma
 * mengembalikan `warning` supaya manajer sadar, sesuai keputusan Anda.
 */
export async function pairDeviceWithDb(
  db: Db,
  businessId: string,
  rawDeviceId: unknown
): Promise<PairDeviceResult> {
  const parsed = z.string().uuid().safeParse(rawDeviceId);
  if (!parsed.success) {
    return { error: strings.pos.setupDeviceNotFound };
  }
  const deviceId = parsed.data;

  const [row] = await db
    .select({ device: devices, outlet: outlets })
    .from(devices)
    .innerJoin(outlets, eq(devices.outletId, outlets.id))
    .where(
      and(
        eq(devices.id, deviceId),
        eq(devices.businessId, businessId),
        eq(devices.isActive, true)
      )
    );
  if (!row) {
    return { error: strings.pos.setupDeviceNotFound };
  }

  // Peringatan tabrakan (§ catatan Anda no. 2): device yang sama SEDANG
  // punya shift terbuka berarti kemungkinan besar ada tablet LAIN yang
  // masih aktif memakainya -- last_seq (nomor struk) dan stok yang
  // berpindah lewat device ini akan bentrok kalau dua tablet sungguhan
  // dipakai bersamaan. Cek open-shift dipilih dibanding ambang waktu
  // mentah dari last_paired_at -- lebih presisi, tidak salah menuduh
  // pemulihan cookie yang hilang di jam sepi (tidak ada shift terbuka)
  // sebagai tabrakan.
  const openShift = await getOpenShiftForDevice(db, businessId, deviceId);
  const warning = openShift
    ? strings.pos.setupPairWarningOpenShift.replace("{employee}", openShift.employeeName)
    : undefined;

  const updated = await db
    .update(devices)
    .set({ lastPairedAt: new Date() })
    .where(eq(devices.id, deviceId))
    .returning({ id: devices.id });
  assertRowsAffected(updated, "perangkat");

  return {
    success: {
      outlet: {
        id: row.outlet.id,
        name: row.outlet.name,
        code: row.outlet.code,
        taxPercent: row.outlet.taxPercent,
        taxInclusive: row.outlet.taxInclusive,
        serviceChargePercent: row.outlet.serviceChargePercent,
        serviceChargeInTaxBase: row.outlet.serviceChargeInTaxBase,
        roundingTo: row.outlet.roundingTo,
        cashEnabled: row.outlet.cashEnabled,
        cashVarianceTolerance: row.outlet.cashVarianceTolerance,
        dayCutoffTime: row.outlet.dayCutoffTime,
        posMode: row.outlet.posMode,
      },
      device: { id: row.device.id, name: row.device.name },
      warning,
    },
  };
}
