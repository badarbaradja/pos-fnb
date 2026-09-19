import { Decimal } from "decimal.js";
import { TrendingUpIcon } from "lucide-react";
import type { SalesSummary } from "@/lib/db/queries/sales-report";
import { formatIDR } from "@/lib/utils/money";
import { cn } from "@/lib/utils";
import { id as strings } from "@/lib/i18n/id";

function KpiCard({
  label,
  value,
  badge,
  primary,
}: {
  label: string;
  value: string;
  badge?: { text: string; positive: boolean } | null;
  primary?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-xl border p-4 shadow-xs",
        primary ? "bg-primary/5 ring-1 ring-primary/15" : "bg-card"
      )}
    >
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {primary ? <TrendingUpIcon className="size-3.5 text-primary" /> : null}
        {label}
      </span>
      <span className={cn("font-heading font-bold tabular-nums", primary ? "text-3xl text-primary" : "text-xl")}>
        {value}
      </span>
      {badge ? (
        <span
          className={`text-xs font-medium ${badge.positive ? "text-success" : "text-destructive"}`}
        >
          {badge.text}
        </span>
      ) : null}
    </div>
  );
}

export function TodayKpiCards({
  today,
  percentChange,
}: {
  today: SalesSummary;
  percentChange: Decimal | null;
}) {
  const badge = percentChange
    ? {
        text: `${percentChange.isPositive() ? "+" : ""}${percentChange.times(100).toDecimalPlaces(1).toString()}% ${strings.dashboardHome.kpiOmzetVsLastWeek}`,
        positive: !percentChange.isNegative(),
      }
    : { text: strings.dashboardHome.kpiNoComparison, positive: true };

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <KpiCard
        label={strings.dashboardHome.kpiOmzet}
        value={formatIDR(new Decimal(today.netSales))}
        badge={badge}
        primary
      />
      <KpiCard
        label={strings.dashboardHome.kpiOrderCount}
        value={String(today.orderCount)}
      />
      <KpiCard
        label={strings.dashboardHome.kpiAverageCheck}
        value={today.averageCheck ? formatIDR(new Decimal(today.averageCheck)) : "-"}
      />
    </div>
  );
}
