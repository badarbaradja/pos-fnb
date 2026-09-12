import { and, asc, eq } from "drizzle-orm";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { businesses, outlets } from "@/lib/db/schema";
import { getBagiHasilLaporan } from "@/lib/db/queries/bagi-hasil-report";
import { businessDate } from "@/lib/utils/business-date";
import { BagiHasilView } from "@/components/dashboard/reports/bagi-hasil-view";
import { id as strings } from "@/lib/i18n/id";

/**
 * app/(dashboard)/reports/bagi-hasil/page.tsx — TT11. Pola sama
 * /reports/sales dan /reports/stock: requirePermissionDb dulu (viewing
 * lebih longgar dari MENCATAT pembayaran -- lihat actions.ts), ambil
 * outlet thrifting, jalankan query, render presentasi murni.
 *
 * Default rentang tanggal = BULAN INI (business_date, bukan kalender
 * UTC) -- SPESIFIKASI-THRIFTING.md §7: bagi hasil dibayarkan BULANAN.
 */
export default async function BagiHasilReportPage({
  searchParams,
}: {
  searchParams: Promise<{ outletId?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "report.sales");

  try {
    const [business] = await db
      .select({ timezone: businesses.timezone })
      .from(businesses)
      .where(eq(businesses.id, businessId));
    const timezone = business?.timezone ?? "Asia/Jakarta";

    const outletRows = await db
      .select({
        id: outlets.id,
        name: outlets.name,
        dayCutoffTime: outlets.dayCutoffTime,
        dayCutoffConfirmed: outlets.dayCutoffConfirmed,
      })
      .from(outlets)
      .where(
        and(
          eq(outlets.businessId, businessId),
          eq(outlets.posMode, "thrifting"),
          eq(outlets.isActive, true)
        )
      )
      .orderBy(asc(outlets.createdAt));

    if (outletRows.length === 0) {
      return (
        <div className="flex flex-col gap-2">
          <h1 className="text-xl font-semibold">{strings.bagiHasil.title}</h1>
          <p className="text-sm text-muted-foreground">{strings.stockReport.noThriftOutlet}</p>
        </div>
      );
    }

    const selectedOutletId = params.outletId || outletRows[0]!.id;
    const selectedOutlet = outletRows.find((o) => o.id === selectedOutletId) ?? outletRows[0]!;

    const today = businessDate(new Date(), timezone, selectedOutlet.dayCutoffTime);
    const startDate = params.from || `${today.slice(0, 7)}-01`;
    const endDate = params.to || today;

    const rows = await getBagiHasilLaporan(db, {
      businessId,
      outletId: selectedOutlet.id,
      outletTimezone: timezone,
      startDate,
      endDate,
    });

    return (
      <BagiHasilView
        outlets={outletRows}
        selectedOutletId={selectedOutlet.id}
        dayCutoffTime={selectedOutlet.dayCutoffTime}
        dayCutoffConfirmed={selectedOutlet.dayCutoffConfirmed}
        startDate={startDate}
        endDate={endDate}
        rows={rows}
      />
    );
  } finally {
    await closeDb();
  }
}
