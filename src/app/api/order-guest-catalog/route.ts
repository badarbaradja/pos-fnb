// api/order-guest-catalog/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getGuestCatalog, resolveOutletToken } from "@/lib/order-guest";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Token diperlukan" }, { status: 400 });
  }

  const supabaseUrl = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  if (!supabaseUrl) {
    return NextResponse.json({ error: "Konfigurasi server tidak lengkap" }, { status: 500 });
  }

  const resolved = await resolveOutletToken(token);
  if (!resolved) {
    return NextResponse.json(
      { error: "Token tidak valid atau outlet tidak aktif" },
      { status: 404 }
    );
  }

  const catalog = await getGuestCatalog(
    resolved.businessId,
    resolved.outletId,
    resolved.outlet,
    supabaseUrl
  );

  return NextResponse.json(catalog, {
    headers: {
      // Cache 30 detik -- menu tidak berubah setiap detik, tapi kita
      // tidak mau customer lihat menu stale terlalu lama setelah update
      "Cache-Control": "public, max-age=30, stale-while-revalidate=60",
    },
  });
}
