import { Suspense } from "react";
import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { format, parseISO, subDays } from "date-fns";
import { Decimal } from "decimal.js";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { intersectOutletScope, outletScopeCondition } from "@/lib/auth/outlet-scope";
import { businesses, outlets } from "@/lib/db/schema";
import {
  getSalesByBrand,
  getSalesSummary,
  type SalesReportFilter,
} from "@/lib/db/queries/sales-report";
import { getOpenShiftsForBusiness, getShiftsNeedingReview } from "@/lib/pos/shift";
import { percentChange } from "@/lib/calc/kpi";
import { businessDate } from "@/lib/utils/business-date";
import { TodayKpiCards } from "@/components/dashboard/home/kpi-cards";
import { BrandSummaryCards } from "@/components/dashboard/home/brand-summary-cards";
import { ShiftStatusList } from "@/components/dashboard/home/shift-status";
import { ShiftsNeedingReview } from "@/components/dashboard/home/shifts-needing-review";
import { ProfitPlaceholder } from "@/components/dashboard/home/profit-placeholder";
import { DashboardDeferredSections } from "@/components/dashboard/home/deferred-sections";
import { DashboardSkeleton } from "@/components/dashboard/home/dashboard-skeleton";
import { id as strings } from "@/lib/i18n/id";

export default async function DashboardHomePage({
  searchParams,
}: {
  searchParams: Promise<{ brandId?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId, allowedOutletIds } = await requirePermissionDb(supabase, "report.sales");

  // Pembatasan akses per outlet, Tahap 3 (13 September 2026, §24) --
  // array KOSONG (bukan null) berarti anggota ini TIDAK punya akses ke
  // outlet manapun. Pesan eksplisit di sini, BUKAN halaman kosong yang
  // terlihat sama seperti "toko lagi sepi" -- keputusan CEO eksplisit,
  // dua hal itu harus kelihatan beda. Berhenti SEBELUM query lain apa
  // pun dijalankan (semuanya pasti kosong lewat outletScopeCondition
  // juga, tapi tidak ada gunanya menjalankannya).
  if (allowedOutletIds !== null && allowedOutletIds.length === 0) {
    await closeDb();
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-xl font-semibold">{strings.dashboardHome.title}</h1>
        </div>
        <p className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {strings.common.noOutletAccess}
        </p>
      </div>
    );
  }

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
  let byBrand: Awaited<ReturnType<typeof getSalesByBrand>>;
  let openShifts: Awaited<ReturnType<typeof getOpenShiftsForBusiness>>;
  let shiftsNeedingReview: Awaited<ReturnType<typeof getShiftsNeedingReview>>;

  try {
    const [business] = await db
      .select({ timezone: businesses.timezone })
      .from(businesses)
      .where(eq(businesses.id, businessId));
    timezone = business?.timezone ?? "Asia/Jakarta";

    outletRows = await db
      .select({ id: outlets.id, name: outlets.name, dayCutoffTime: outlets.dayCutoffTime })
      .from(outlets)
      .where(
        and(
          eq(outlets.businessId, businessId),
          eq(outlets.isActive, true),
          outletScopeCondition(allowedOutletIds, outlets.id)
        )
      )
      .orderBy(asc(outlets.createdAt));

    const defaultOutlet = outletRows[0];
    today = defaultOutlet
      ? businessDate(new Date(), timezone, defaultOutlet.dayCutoffTime)
      : businessDate(new Date(), timezone, "04:00:00");

    [byBrand, openShifts, shiftsNeedingReview] = await Promise.all([
      getSalesByBrand(db, { businessId, startDate: today, endDate: today, allowedOutletIds }),
      getOpenShiftsForBusiness(db, businessId, allowedOutletIds),
      getShiftsNeedingReview(db, businessId, timezone, allowedOutletIds),
    ]);
  } catch (err) {
    await closeDb();
    throw err;
  }

  // "Omzet Hari Ini" TIDAK BOLEH menggabung Indosteak/Indokopi/Barang
  // Titipan jadi satu angka (instruksi CEO 11 September 2026) -- brandId
  // di URL (link biasa dari BrandSummaryCards, bukan client state)
  // menentukan brand mana yang "dibuka" untuk dirinci ke level outlet.
  // Tanpa brandId dipilih, halaman berhenti di tiga kartu brand -- TIDAK
  // ADA lagi angka gabungan semua brand yang ditampilkan sama sekali.
  const selectedBrandId = params.brandId || null;
  const selectedBrand = selectedBrandId ? (byBrand.find((b) => b.brandId === selectedBrandId) ?? null) : null;
  // byBrand sudah dihitung dari outlets yang lolos allowedOutletIds
  // (getSalesByBrand di atas), jadi selectedBrand.outletIds SUDAH otomatis
  // di dalam cakupan -- tapi tetap di-irisan lagi lewat intersectOutletScope
  // di bawah untuk todayFilter/dst, bukan cuma dipercaya, karena filter itu
  // dipakai LANGSUNG ke getSalesSummary/DashboardDeferredSections (jalur
  // terpisah dari getSalesByBrand) tanpa jaminan keduanya selalu konsisten
  // di masa depan.
  const scopedOutletIds = selectedBrand ? selectedBrand.outletIds : null;
  const scopedOutletRows = selectedBrand
    ? outletRows.filter((o) => selectedBrand.outletIds.includes(o.id))
    : outletRows;
  const effectiveOutletIds = intersectOutletScope(allowedOutletIds, scopedOutletIds);

  const sevenDaysAgo = format(subDays(parseISO(today), 6), "yyyy-MM-dd");
  const lastWeekSameDay = format(subDays(parseISO(today), 7), "yyyy-MM-dd");
  const todayFilter: SalesReportFilter = {
    businessId,
    outletId: effectiveOutletIds,
    startDate: today,
    endDate: today,
  };
  const lastWeekFilter: SalesReportFilter = {
    businessId,
    outletId: effectiveOutletIds,
    startDate: lastWeekSameDay,
    endDate: lastWeekSameDay,
  };
  const trendFilter: SalesReportFilter = {
    businessId,
    outletId: effectiveOutletIds,
    startDate: sevenDaysAgo,
    endDate: today,
  };

  // Ringkasan KPI+tren SATU BRAND cuma dihitung kalau brand itu dipilih
  // -- sebelum itu, halaman berhenti di tiga kartu brand, tidak ada
  // angka gabungan apa pun yang perlu dihitung.
  let brandSummarySection: React.ReactNode = null;
  if (selectedBrand) {
    let summary: Awaited<ReturnType<typeof getSalesSummary>>;
    let lastWeekSummary: Awaited<ReturnType<typeof getSalesSummary>>;
    try {
      [summary, lastWeekSummary] = await Promise.all([
        getSalesSummary(db, todayFilter),
        getSalesSummary(db, lastWeekFilter),
      ]);
    } catch (err) {
      await closeDb();
      throw err;
    }
    const change = percentChange(new Decimal(summary.netSales), new Decimal(lastWeekSummary.netSales));
    brandSummarySection = (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            {strings.dashboardHome.brandDetailTitle.replace("{brand}", selectedBrand.brandName)}
          </h2>
          <Link href="/" className="text-sm text-muted-foreground hover:underline">
            {strings.dashboardHome.brandBackToAll}
          </Link>
        </div>
        <TodayKpiCards today={summary} percentChange={change} />
      </div>
    );
  } else {
    // Tidak ada brand dipilih -- tidak ada query lambat lagi untuk
    // dijalankan (DashboardDeferredSections tidak dirender di cabang
    // ini), jadi koneksi db ditutup di sini, bukan dipindah tanggung
    // jawabnya seperti cabang "brand dipilih" di bawah.
    await closeDb();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">{strings.dashboardHome.title}</h1>
        <p className="text-sm text-muted-foreground">{strings.dashboardHome.subtitle}</p>
      </div>

      <BrandSummaryCards rows={byBrand} selectedBrandId={selectedBrandId} />

      <ShiftsNeedingReview shifts={shiftsNeedingReview} />

      {brandSummarySection}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ShiftStatusList
          shifts={openShifts}
          multiOutlet={outletRows.length > 1}
          timezone={timezone}
        />
        <ProfitPlaceholder />
      </div>

      {selectedBrand ? (
        <Suspense fallback={<DashboardSkeleton />}>
          <DashboardDeferredSections
            db={db}
            closeDb={closeDb}
            todayFilter={todayFilter}
            trendFilter={trendFilter}
            showOutletComparison={scopedOutletRows.length > 1}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
