import { and, asc, eq } from "drizzle-orm";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { intersectOutletScope, outletScopeCondition } from "@/lib/auth/outlet-scope";
import { businesses, outlets } from "@/lib/db/schema";
import {
  getSalesByCashier,
  getSalesByCategory,
  getSalesByChannel,
  getSalesByHour,
  getSalesByPaymentMethod,
  getSalesByProduct,
  getSalesSummary,
  getTransactionHistory,
  type SalesReportFilter,
} from "@/lib/db/queries/sales-report";
import { businessDate } from "@/lib/utils/business-date";
import { SalesSummaryCards } from "@/components/dashboard/reports/summary-cards";
import {
  SalesByCashierTable,
  SalesByCategoryTable,
  SalesByChannelTable,
  SalesByHourTable,
  SalesByPaymentMethodTable,
  SalesByProductTable,
} from "@/components/dashboard/reports/report-tables";
import { TransactionHistoryTable } from "@/components/dashboard/reports/transaction-history-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { id as strings } from "@/lib/i18n/id";

const PAGE_SIZE = 25;

export default async function SalesReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; outletId?: string; q?: string; page?: string }>;
}) {
  const params = await searchParams;

  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId, allowedOutletIds } = await requirePermissionDb(supabase, "report.sales");

  // Pembatasan akses per outlet, Tahap 3 (13 September 2026, §24) --
  // array KOSONG berarti tidak ada akses ke outlet manapun. Pesan
  // eksplisit, bukan halaman kosong yang terlihat sama dengan "belum
  // ada transaksi" -- keputusan CEO, sama pola Dashboard.
  if (allowedOutletIds !== null && allowedOutletIds.length === 0) {
    await closeDb();
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-xl font-semibold">{strings.reports.title}</h1>
        </div>
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
    const timezone = business?.timezone ?? "Asia/Jakarta";

    // outletRows dipakai membangun dropdown filter di bawah -- SUDAH
    // disaring allowedOutletIds di sini, supaya dropdown TIDAK PERNAH
    // menampilkan outlet yang nanti ditolak server (keputusan CEO:
    // dropdown yang menampilkan outlet terlarang lalu ditolak itu
    // membingungkan, lebih baik tidak muncul sama sekali).
    const outletRows = await db
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

    // Default rentang tanggal = business_date "hari ini", dihitung dari
    // outlet aktif pertama (pola resolusi outlet yang sama dipakai
    // get-pos-catalog.ts) -- cuma NILAI AWAL form, user tetap bebas ganti.
    const defaultOutlet = outletRows[0];
    const today = defaultOutlet
      ? businessDate(new Date(), timezone, defaultOutlet.dayCutoffTime)
      : businessDate(new Date(), timezone, "04:00:00");

    const startDate = params.from || today;
    const endDate = params.to || today;
    const outletId = params.outletId || null;
    const search = params.q?.trim() ?? "";
    const page = Math.max(1, Number(params.page) || 1);

    // Filter dropdown milik halaman ini (satu outlet atau "semua") DAN
    // allowedOutletIds membership WAJIB berlaku sekaligus -- outletId
    // yang diketik langsung di URL untuk outlet di luar cakupan
    // (bukan cuma dipilih dari dropdown) otomatis diirisan jadi array
    // kosong di sini, bukan diam-diam diloloskan.
    const effectiveOutletIds = intersectOutletScope(allowedOutletIds, outletId ? [outletId] : null);
    const filter: SalesReportFilter = { businessId, outletId: effectiveOutletIds, startDate, endDate };

    const [
      summary,
      byProduct,
      byCategory,
      byCashier,
      byPaymentMethod,
      byChannel,
      byHour,
      history,
    ] = await Promise.all([
      getSalesSummary(db, filter),
      getSalesByProduct(db, filter),
      getSalesByCategory(db, filter),
      getSalesByCashier(db, filter),
      getSalesByPaymentMethod(db, filter),
      getSalesByChannel(db, filter),
      getSalesByHour(db, filter),
      getTransactionHistory(db, filter, { search, page, pageSize: PAGE_SIZE }),
    ]);

    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-xl font-semibold">{strings.reports.title}</h1>
          <p className="text-sm text-muted-foreground">{strings.reports.subtitle}</p>
        </div>

        <form
          action="/reports/sales"
          className="flex flex-wrap items-end gap-3 rounded-lg border p-3"
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="from" className="text-xs">
              {strings.reports.filterFrom}
            </Label>
            <Input id="from" name="from" type="date" defaultValue={startDate} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="to" className="text-xs">
              {strings.reports.filterTo}
            </Label>
            <Input id="to" name="to" type="date" defaultValue={endDate} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="outletId" className="text-xs">
              {strings.reports.filterOutlet}
            </Label>
            {/* <select> native, bukan komponen Select base-ui -- form ini GET
                murni tanpa JS, native select paling sederhana & pasti benar
                untuk itu (base-ui Select butuh hidrasi klien). */}
            <select
              id="outletId"
              name="outletId"
              defaultValue={outletId ?? ""}
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
            >
              <option value="">{strings.reports.filterAllOutlets}</option>
              {outletRows.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="q" className="text-xs">
              {strings.reports.filterSearch}
            </Label>
            <Input
              id="q"
              name="q"
              defaultValue={search}
              placeholder={strings.reports.filterSearchPlaceholder}
            />
          </div>
          <Button type="submit">{strings.reports.filterSubmit}</Button>
        </form>

        <SalesSummaryCards summary={summary} />
        <SalesByProductTable rows={byProduct} />
        <SalesByCategoryTable rows={byCategory} />
        <SalesByCashierTable rows={byCashier} />
        <SalesByPaymentMethodTable rows={byPaymentMethod} />
        <SalesByChannelTable rows={byChannel} />
        <SalesByHourTable rows={byHour} />
        <TransactionHistoryTable
          rows={history.rows}
          timezone={timezone}
          page={page}
          pageSize={PAGE_SIZE}
          totalCount={history.totalCount}
          currentSearchParams={{ from: startDate, to: endDate, outletId: outletId ?? undefined, q: search }}
        />
      </div>
    );
  } finally {
    await closeDb();
  }
}
