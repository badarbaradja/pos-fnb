import { Decimal } from "decimal.js";
import type { SalesByProductRow } from "@/lib/db/queries/sales-report";
import { formatIDR } from "@/lib/utils/money";
import { id as strings } from "@/lib/i18n/id";

export function TopProductsList({ rows }: { rows: SalesByProductRow[] }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="font-heading text-sm font-semibold">
        {strings.dashboardHome.topProductsTitle}
      </h2>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
          {strings.dashboardHome.topProductsEmpty}
        </p>
      ) : (
        <ol className="flex flex-col gap-1 rounded-xl border bg-card p-2 shadow-xs">
          {rows.map((row, index) => (
            <li
              key={`${row.productId}-${row.productName}`}
              className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-muted/50"
            >
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                {index + 1}
              </span>
              <span className="flex-1 truncate">
                {row.productName}
                <span className="ml-2 text-xs text-muted-foreground">
                  x{new Decimal(row.qty).toString()}
                </span>
              </span>
              <span className="font-semibold tabular-nums">{formatIDR(new Decimal(row.netAmount))}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
