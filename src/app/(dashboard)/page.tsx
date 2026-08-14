import { Suspense } from "react";
import { and, asc, eq } from "drizzle-orm";
import { format, parseISO, subDays } from "date-fns";
import { Decimal } from "decimal.js";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { businesses, outlets } from "@/lib/db/schema";
import { getSalesSummary, type SalesReportFilter } from "@/lib/db/queries/sales-report";
import { getOpenShiftsForBusiness } from "@/lib/pos/shift";
import { percentChange } from "@/lib/calc/kpi";
import { businessDate } from "@/lib/utils/business-date";
import { TodayKpiCards } from "@/components/dashboard/home/kpi-cards";
import { ShiftStatusList } from "@/components/dashboard/home/shift-status";
import { ProfitPlaceholder } from "@/components/dashboard/home/profit-placeholder";
import { DashboardDeferredSections } from "@/components/dashboard/home/deferred-sections";
import { DashboardSkeleton } from "@/components/dashboard/home/dashboard-skeleton";
import { id as strings } from "@/lib/i18n/id";

export default async function DashboardHomePage() {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "report.sales");

  // db dibuka SEKALI di sini dan dipakai untuk query cepat (di bawah) DAN
  // query lambat (dioper ke DashboardDeferredSections lewat Suspense) --
  // getUserDb() adalah koneksi dedicated per panggilan (lib/db/client.ts),
  // jadi tidak boleh dibuka berkali-kali per halaman. closeDb() SENGAJA
  // tidak di try/finally di sini untuk request sukses -- tanggung jawab
  // menutupnya dipindah ke DashboardDeferredSections, konsumen TERAKHIR
  // koneksi ini (dia baru mulai jalan setelah blok try di bawah selesai,
  // tidak ada race). Kalau blok try di bawah gagal, closeDb() tetap
  // dipanggil di catch supaya tidak ada koneksi menggantung.
  let timezone: string;
  let outletRows: { id: string; name: string; dayCutoffTime: string }[];
  let today: string;
  let summary: Awaited<ReturnType<typeof getSalesSummary>>;
  let lastWeekSummary: Awaited<ReturnType<typeof getSalesSummary>>;
  let openShifts: Awaited<ReturnType<typeof getOpenShiftsForBusiness>>;

  try {
    const [business] = await db
      .select({ timezone: businesses.timezone })
      .from(businesses)
      .where(eq(businesses.id, businessId));
    timezone = business?.timezone ?? "Asia/Jakarta";

    outletRows = await db
      .select({ id: outlets.id, name: outlets.name, dayCutoffTime: outlets.dayCutoffTime })
      .from(outlets)
      .where(and(eq(outlets.businessId, businessId), eq(outlets.isActive, true)))
      .orderBy(asc(outlets.createdAt));

    const defaultOutlet = outletRows[0];
    today = defaultOutlet
      ? businessDate(new Date(), timezone, defaultOutlet.dayCutoffTime)
      : businessDate(new Date(), timezone, "04:00:00");

    const lastWeekSameDay = format(subDays(parseISO(today), 7), "yyyy-MM-dd");
    const todayFilter: SalesReportFilter = {
      businessId,
      outletId: null,
      startDate: today,
      endDate: today,
    };
    const lastWeekFilter: SalesReportFilter = {
      businessId,
      outletId: null,
      startDate: lastWeekSameDay,
      endDate: lastWeekSameDay,
    };

    [summary, lastWeekSummary, openShifts] = await Promise.all([
      getSalesSummary(db, todayFilter),
      getSalesSummary(db, lastWeekFilter),
      getOpenShiftsForBusiness(db, businessId),
    ]);
  } catch (err) {
    await closeDb();
    throw err;
  }

  const sevenDaysAgo = format(subDays(parseISO(today), 6), "yyyy-MM-dd");
  const todayFilter: SalesReportFilter = {
    businessId,
    outletId: null,
    startDate: today,
    endDate: today,
  };
  const trendFilter: SalesReportFilter = {
    businessId,
    outletId: null,
    startDate: sevenDaysAgo,
    endDate: today,
  };

  const change = percentChange(new Decimal(summary.netSales), new Decimal(lastWeekSummary.netSales));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">{strings.dashboardHome.title}</h1>
        <p className="text-sm text-muted-foreground">{strings.dashboardHome.subtitle}</p>
      </div>

      <TodayKpiCards today={summary} percentChange={change} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ShiftStatusList
          shifts={openShifts}
          multiOutlet={outletRows.length > 1}
          timezone={timezone}
        />
        <ProfitPlaceholder />
      </div>

      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardDeferredSections
          db={db}
          closeDb={closeDb}
          todayFilter={todayFilter}
          trendFilter={trendFilter}
          showOutletComparison={outletRows.length > 1}
        />
      </Suspense>
    </div>
  );
}
