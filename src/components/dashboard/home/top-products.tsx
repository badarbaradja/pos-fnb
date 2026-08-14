import { Decimal } from "decimal.js";
import type { SalesByProductRow } from "@/lib/db/queries/sales-report";
import { formatIDR } from "@/lib/utils/money";
import { id as strings } from "@/lib/i18n/id";

export function TopProductsList({ rows }: { rows: SalesByProductRow[] }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-muted-foreground">
        {strings.dashboardHome.topProductsTitle}
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{strings.dashboardHome.topProductsEmpty}</p>
      ) : (
        <ol className="flex flex-col gap-2 rounded-lg border p-3">
          {rows.map((row, index) => (
            <li
              key={`${row.productId}-${row.productName}`}
              className="flex items-center justify-between text-sm"
            >
              <span>
                <span className="mr-2 text-xs text-muted-foreground">{index + 1}.</span>
                {row.productName}
                <span className="ml-2 text-xs text-muted-foreground">
                  x{new Decimal(row.qty).toString()}
                </span>
              </span>
              <span className="font-medium">{formatIDR(new Decimal(row.netAmount))}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
