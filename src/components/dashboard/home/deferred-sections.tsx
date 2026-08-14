import type { UserDbHandle } from "@/lib/db/client";
import {
  getSalesByDay,
  getSalesByOutlet,
  getSalesByProduct,
  type SalesReportFilter,
} from "@/lib/db/queries/sales-report";
import { SalesTrendChart } from "@/components/dashboard/home/sales-trend-chart";
import { TopProductsList } from "@/components/dashboard/home/top-products";
import { OutletComparisonTable } from "@/components/dashboard/home/outlet-comparison";

/**
 * Konsumen TERAKHIR koneksi `db` yang dibuka page.tsx -- lihat catatan di
 * page.tsx soal kenapa closeDb() dipindah ke sini alih-alih try/finally di
 * page.tsx sendiri (Suspense: komponen ini baru mulai jalan SETELAH page.tsx
 * selesai `await` query cepatnya, jadi tidak ada race pemakaian bersamaan).
 */
export async function DashboardDeferredSections({
  db,
  closeDb,
  todayFilter,
  trendFilter,
  showOutletComparison,
}: {
  db: UserDbHandle["db"];
  closeDb: UserDbHandle["close"];
  todayFilter: SalesReportFilter;
  trendFilter: SalesReportFilter;
  showOutletComparison: boolean;
}) {
  try {
    const [byDay, byProduct, byOutlet] = await Promise.all([
      getSalesByDay(db, trendFilter),
      getSalesByProduct(db, todayFilter),
      showOutletComparison ? getSalesByOutlet(db, todayFilter) : Promise.resolve([]),
    ]);

    return (
      <div className="flex flex-col gap-6">
        <SalesTrendChart rows={byDay} />
        <TopProductsList rows={byProduct.slice(0, 5)} />
        {showOutletComparison ? <OutletComparisonTable rows={byOutlet} /> : null}
      </div>
    );
  } finally {
    await closeDb();
  }
}
