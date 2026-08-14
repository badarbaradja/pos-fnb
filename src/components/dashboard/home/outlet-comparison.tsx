import { Decimal } from "decimal.js";
import type { SalesByOutletRow } from "@/lib/db/queries/sales-report";
import { formatIDR } from "@/lib/utils/money";
import { id as strings } from "@/lib/i18n/id";

export function OutletComparisonTable({ rows }: { rows: SalesByOutletRow[] }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-muted-foreground">
        {strings.dashboardHome.outletComparisonTitle}
      </h2>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="p-2 font-medium">{strings.reports.filterOutlet}</th>
              <th className="p-2 text-right font-medium">{strings.reports.colOrderCount}</th>
              <th className="p-2 text-right font-medium">{strings.reports.colValue}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.outletId} className="border-t">
                <td className="p-2">{row.outletName}</td>
                <td className="p-2 text-right">{row.orderCount}</td>
                <td className="p-2 text-right">{formatIDR(new Decimal(row.netSales))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
