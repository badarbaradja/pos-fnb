import { Decimal } from "decimal.js";
import type { SalesSummary } from "@/lib/db/queries/sales-report";
import { formatIDR } from "@/lib/utils/money";
import { id as strings } from "@/lib/i18n/id";

function KpiCard({
  label,
  value,
  badge,
}: {
  label: string;
  value: string;
  badge?: { text: string; positive: boolean } | null;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border p-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold">{value}</span>
      {badge ? (
        <span
          className={`text-xs font-medium ${badge.positive ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
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
