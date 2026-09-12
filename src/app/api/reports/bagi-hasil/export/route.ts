import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { buildBagiHasilExport } from "@/lib/pemilik/bagi-hasil-export";
import { id as strings } from "@/lib/i18n/id";

/**
 * app/api/reports/bagi-hasil/export/route.ts — TT11. Route Handler
 * (bukan Server Action) karena ini murni "klik tautan, browser unduh
 * file" -- Server Action tidak dirancang untuk respons biner yang
 * memicu dialog Save As browser. Gerbang izin SAMA PERSIS dengan
 * halaman laporannya sendiri ("report.sales").
 *
 * SEMUA logika (termasuk gerbang SYARAT 3 dan pembangunan workbook) ada
 * di lib/pemilik/bagi-hasil-export.ts, supaya bisa diuji lewat database
 * sungguhan -- di sini cuma menerjemahkan hasilnya ke NextResponse.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const outletId = url.searchParams.get("outletId");
  const startDate = url.searchParams.get("from");
  const endDate = url.searchParams.get("to");

  if (!outletId || !startDate || !endDate) {
    return NextResponse.json({ error: strings.common.unexpectedError }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "report.sales");

  try {
    const result = await buildBagiHasilExport(db, { businessId, outletId, startDate, endDate });

    if (result.status === "not_found") {
      return NextResponse.json({ error: strings.common.unexpectedError }, { status: 404 });
    }
    if (result.status === "locked") {
      return NextResponse.json({ error: result.error }, { status: 423 }); // 423 Locked
    }

    return new NextResponse(new Uint8Array(result.buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${result.filename}"`,
      },
    });
  } finally {
    await closeDb();
  }
}
