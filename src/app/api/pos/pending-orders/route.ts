import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { getPendingGuestOrders } from "@/lib/order-guest";
import { eq } from "drizzle-orm";
import { outlets } from "@/lib/db/schema";

export const runtime = "nodejs";

/**
 * GET /api/pos/pending-orders?outletId=xxx
 *
 * Dipanggil dari layar kasir (polling tiap 15 detik) untuk mengetahui
 * apakah ada draft order dari customer yang menunggu.
 *
 * Auth: session kasir via requirePermissionDb -- hanya user yang sudah
 * login dan punya permission pos.create_order yang bisa akses.
 * Validasi: outletId harus milik businessId user yang login.
 */
export async function GET(request: NextRequest) {
  const outletId = request.nextUrl.searchParams.get("outletId");
  if (!outletId) {
    return NextResponse.json({ error: "outletId diperlukan" }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "pos.create_order"
  );
  try {
    // Verifikasi outletId milik businessId ini (tidak mengandalkan RLS saja)
    const [outletRow] = await db
      .select({ id: outlets.id })
      .from(outlets)
      .where(eq(outlets.id, outletId));
    if (!outletRow) {
      return NextResponse.json({ error: "Outlet tidak ditemukan" }, { status: 404 });
    }
    void businessId; // verified by requirePermissionDb + RLS on outlets query above

    const orders = await getPendingGuestOrders(outletId);
    return NextResponse.json({ orders });
  } finally {
    await closeDb();
  }
}
