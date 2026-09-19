import Link from "next/link";
import { Decimal } from "decimal.js";
import type { SalesByBrandRow } from "@/lib/db/queries/sales-report";
import { formatIDR } from "@/lib/utils/money";
import { cn } from "@/lib/utils";
import { id as strings } from "@/lib/i18n/id";

/**
 * components/dashboard/home/brand-summary-cards.tsx — instruksi CEO 11
 * September 2026: "Omzet Hari Ini" tidak boleh menggabung Indosteak/
 * Indokopi/Barang Titipan jadi satu angka. Satu kartu per BRAND (bukan
 * per outlet -- Indosteak & Indokopi masing-masing dua outlet, dijumlah
 * dulu ke level brand), klik untuk turun ke rincian outlet
 * (`?brandId=...`, ditangani page.tsx lewat searchParams -- link
 * biasa, bukan client state, supaya kerja tanpa JS sama seperti filter
 * /reports/sales yang sudah ada).
 *
 * Brand tanpa penjualan hari ini TETAP tampil (Rp0) -- lihat komentar
 * getSalesByBrand kenapa ini penting, bukan diam-diam hilang dari daftar.
 */
export function BrandSummaryCards({
  rows,
  selectedBrandId,
}: {
  rows: SalesByBrandRow[];
  selectedBrandId: string | null;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="font-heading text-sm font-semibold">
        {strings.dashboardHome.brandSummaryTitle}
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {rows.map((row) => {
          const selected = row.brandId === selectedBrandId;
          return (
            <Link
              key={row.brandId}
              href={selected ? "/" : `/?brandId=${row.brandId}`}
              className={cn(
                "flex flex-col gap-1 rounded-xl border bg-card p-4 shadow-xs transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-md",
                selected && "border-primary bg-primary/5 ring-1 ring-primary/15"
              )}
            >
              <span className="text-xs font-medium text-muted-foreground">
                {row.brandName} ·{" "}
                {strings.dashboardHome.brandOutletCount.replace("{count}", String(row.outletIds.length))}
              </span>
              <span className="font-heading text-2xl font-bold tabular-nums">{formatIDR(new Decimal(row.netSales))}</span>
              <span className="text-xs text-muted-foreground">
                {row.orderCount} {strings.dashboardHome.kpiOrderCount.toLowerCase()}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
