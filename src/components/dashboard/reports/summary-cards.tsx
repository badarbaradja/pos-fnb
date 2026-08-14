import { Decimal } from "decimal.js";
import type { SalesSummary } from "@/lib/db/queries/sales-report";
import { formatIDR } from "@/lib/utils/money";
import { id as strings } from "@/lib/i18n/id";

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold">{value}</span>
    </div>
  );
}

export function SalesSummaryCards({ summary }: { summary: SalesSummary }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-muted-foreground">
        {strings.reports.summaryTitle}
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label={strings.reports.summaryGrossSales} value={formatIDR(new Decimal(summary.grossSales))} />
        <SummaryCard label={strings.reports.summaryDiscount} value={formatIDR(new Decimal(summary.discountTotal))} />
        <SummaryCard label={strings.reports.summaryRefund} value={formatIDR(new Decimal(summary.refundTotal))} />
        <SummaryCard label={strings.reports.summaryNetSales} value={formatIDR(new Decimal(summary.netSales))} />
        <SummaryCard label={strings.reports.summaryTax} value={formatIDR(new Decimal(summary.taxAmount))} />
        <SummaryCard
          label={strings.reports.summaryServiceCharge}
          value={formatIDR(new Decimal(summary.serviceCharge))}
        />
        <SummaryCard label={strings.reports.summaryOrderCount} value={String(summary.orderCount)} />
        <SummaryCard
          label={strings.reports.summaryAverageCheck}
          value={summary.averageCheck ? formatIDR(new Decimal(summary.averageCheck)) : "-"}
        />
      </div>
    </div>
  );
}
