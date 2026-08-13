"use server";

import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { payOrderWithDb, type PayOrderInput, type PayOrderResult } from "@/lib/pos/pay-order";

export type { PayOrderInput, PayOrderResult };

/**
 * Pembungkus Server Action tipis -- logika sesungguhnya ada di
 * lib/pos/pay-order.ts#payOrderWithDb, dipisah supaya bisa dites langsung
 * tanpa request Next.js (pola sama dengan lib/auth/outlets.ts).
 */
export async function payOrder(input: PayOrderInput): Promise<PayOrderResult> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "pos.create_order"
  );

  try {
    return await payOrderWithDb(db, businessId, input);
  } finally {
    await closeDb();
  }
}
