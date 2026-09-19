import { Decimal } from "decimal.js";
import type { SalesByOutletRow } from "@/lib/db/queries/sales-report";
import { formatIDR } from "@/lib/utils/money";
import { id as strings } from "@/lib/i18n/id";

export function OutletComparisonTable({ rows }: { rows: SalesByOutletRow[] }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="font-heading text-sm font-semibold">
        {strings.dashboardHome.outletComparisonTitle}
      </h2>
      <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="p-3 font-medium">{strings.reports.filterOutlet}</th>
              <th className="p-3 text-right font-medium">{strings.reports.colOrderCount}</th>
              <th className="p-3 text-right font-medium">{strings.reports.colValue}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.outletId} className="border-t transition-colors hover:bg-muted/30">
                <td className="p-3 font-medium">{row.outletName}</td>
                <td className="p-3 text-right tabular-nums">{row.orderCount}</td>
                <td className="p-3 text-right font-semibold tabular-nums">{formatIDR(new Decimal(row.netSales))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
