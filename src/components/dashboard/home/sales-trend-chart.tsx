"use client";

import { Decimal } from "decimal.js";
import { format, parseISO } from "date-fns";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SalesByDayRow } from "@/lib/db/queries/sales-report";
import { formatIDR } from "@/lib/utils/money";
import { id as strings } from "@/lib/i18n/id";

type ChartPoint = { businessDate: string; label: string; netSales: number };

function TrendTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: ChartPoint }[];
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]!.payload;
  return (
    <div className="rounded-md border bg-background px-2.5 py-1.5 text-xs shadow-sm">
      <div className="text-muted-foreground">{point.label}</div>
      <div className="font-medium">{formatIDR(new Decimal(point.netSales))}</div>
    </div>
  );
}

export function SalesTrendChart({ rows }: { rows: SalesByDayRow[] }) {
  const data: ChartPoint[] = rows.map((r) => ({
    businessDate: r.businessDate,
    label: format(parseISO(r.businessDate), "dd/MM"),
    netSales: new Decimal(r.netSales).toNumber(),
  }));

  return (
    <div className="flex flex-col gap-2">
      <h2 className="font-heading text-sm font-semibold">
        {strings.dashboardHome.trendTitle}
      </h2>
      <div className="h-56 rounded-xl border bg-card p-3 shadow-xs">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            />
            <YAxis hide />
            <Tooltip content={<TrendTooltip />} cursor={{ fill: "var(--muted)" }} />
            <Bar dataKey="netSales" fill="var(--primary)" radius={[4, 4, 0, 0]} maxBarSize={40} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
