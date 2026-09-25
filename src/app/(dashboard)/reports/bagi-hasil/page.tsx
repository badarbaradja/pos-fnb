import { and, asc, eq } from "drizzle-orm";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { outletScopeCondition } from "@/lib/auth/outlet-scope";
import { businesses, outlets } from "@/lib/db/schema";
import { getBagiHasilLaporan } from "@/lib/db/queries/bagi-hasil-report";
import { businessDate, formatTimezoneAbbreviation } from "@/lib/utils/business-date";
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
  const { db, closeDb, businessId, allowedOutletIds } = await requirePermissionDb(supabase, "report.sales");

  // Pembatasan akses per outlet, Tahap 3 (13 September 2026, §26) --
  // dicek SEBELUM query outletRows, sama pola Laporan Stok: pesannya
  // harus beda jelas dari "noThriftOutlet" ("bisnis ini tidak punya
  // outlet thrifting sama sekali").
  if (allowedOutletIds !== null && allowedOutletIds.length === 0) {
    await closeDb();
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">{strings.bagiHasil.title}</h1>
        <p className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {strings.common.noOutletAccess}
        </p>
      </div>
    );
  }

  try {
    const [business] = await db
      .select({ timezone: businesses.timezone })
      .from(businesses)
      .where(eq(businesses.id, businessId));
    // businessTimezone -- BUKAN "outletTimezone" (outlet tidak punya kolom
    // zona waktu sendiri di skema ini). Batas periode laporan ditentukan
    // DUA nilai bersama: dayCutoffTime outlet DAN businessTimezone ini --
    // keduanya harus tampil bersama supaya konfirmasi manusia berarti
    // sesuatu (TT11, koreksi CEO 12 September 2026).
    const businessTimezone = business?.timezone ?? "Asia/Jakarta";
    const timezoneLabel = formatTimezoneAbbreviation(businessTimezone);

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
          eq(outlets.isActive, true),
          outletScopeCondition(allowedOutletIds, outlets.id)
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

    const today = businessDate(new Date(), businessTimezone, selectedOutlet.dayCutoffTime);
    const startDate = params.from || `${today.slice(0, 7)}-01`;
    const endDate = params.to || today;

    const rows = await getBagiHasilLaporan(db, {
      businessId,
      outletId: selectedOutlet.id,
      businessTimezone,
      startDate,
      endDate,
    });

    return (
      <BagiHasilView
        outlets={outletRows}
        selectedOutletId={selectedOutlet.id}
        dayCutoffTime={selectedOutlet.dayCutoffTime}
        dayCutoffConfirmed={selectedOutlet.dayCutoffConfirmed}
        timezoneLabel={timezoneLabel}
        startDate={startDate}
        endDate={endDate}
        defaultTanggalBayar={today}
        rows={rows}
      />
    );
  } finally {
    await closeDb();
  }
}
