"use server";

import { cookies } from "next/headers";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import {
  pairDeviceWithDb,
  PAIR_COOKIE,
  PAIR_COOKIE_MAX_AGE,
  type PairDeviceResult,
} from "@/lib/pos/device-pairing";

export type { PairDeviceResult };

/**
 * Server Action -- SATU-SATUNYA tempat cookie pairing sungguhan ditulis
 * (cookies().set() cuma sah dipanggil dari Server Action/Route Handler,
 * bukan Server Component render biasa -- lihat catatan di
 * lib/auth/supabase.ts). Digerbang "employee.manage" (owner/manajer,
 * sama seperti /devices) -- lihat lib/pos/device-pairing.ts untuk alasan
 * kenapa pairing bukan tindakan yang boleh dilakukan kasir sendirian.
 */
export async function pairDevice(deviceId: unknown): Promise<PairDeviceResult> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "employee.manage"
  );

  let result: PairDeviceResult;
  try {
    result = await pairDeviceWithDb(db, businessId, deviceId);
  } finally {
    await closeDb();
  }

  if (result.success) {
    const cookieStore = await cookies();
    cookieStore.set(PAIR_COOKIE, result.success.device.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: PAIR_COOKIE_MAX_AGE,
      path: "/",
    });
  }

  return result;
}
