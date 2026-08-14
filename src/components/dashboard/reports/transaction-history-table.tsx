import Link from "next/link";
import { toZonedTime } from "date-fns-tz";
import { format } from "date-fns";
import { Decimal } from "decimal.js";
import type { TransactionHistoryRow } from "@/lib/db/queries/sales-report";
import { formatIDR } from "@/lib/utils/money";
import { getChannelLabel } from "@/lib/pos/channel-labels";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { id as strings } from "@/lib/i18n/id";

function formatTime(date: Date | null, timezone: string): string {
  if (!date) return "-";
  return format(toZonedTime(date, timezone), "dd/MM HH:mm");
}

export function TransactionHistoryTable({
  rows,
  timezone,
  page,
  pageSize,
  totalCount,
  currentSearchParams,
}: {
  rows: TransactionHistoryRow[];
  timezone: string;
  page: number;
  pageSize: number;
  totalCount: number;
  currentSearchParams: Record<string, string | undefined>;
}) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  function hrefForPage(targetPage: number): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(currentSearchParams)) {
      if (value) params.set(key, value);
    }
    params.set("page", String(targetPage));
    return `/reports/sales?${params.toString()}`;
  }

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-muted-foreground">
        {strings.reports.transactionHistoryTitle}
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{strings.reports.empty}</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="p-2 font-medium">{strings.reports.colNumber}</th>
                  <th className="p-2 font-medium">{strings.reports.colTime}</th>
                  <th className="p-2 text-right font-medium">{strings.reports.colTotal}</th>
                  <th className="p-2 font-medium">{strings.receipt.listColPaymentMethod}</th>
                  <th className="p-2 font-medium">{strings.reports.colChannel}</th>
                  <th className="p-2 font-medium">{strings.reports.colAction}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t">
                    <td className="p-2 font-mono text-xs">
                      {row.number}
                      {row.status === "void" ? (
                        <Badge variant="destructive" className="ml-2">
                          {strings.voidRefund.voidBadge}
                        </Badge>
                      ) : null}
                    </td>
                    <td className="p-2">{formatTime(row.paidAt, timezone)}</td>
                    <td className="p-2 text-right">{formatIDR(new Decimal(row.total))}</td>
                    <td className="p-2">{row.paymentMethodNames.join(", ") || "-"}</td>
                    <td className="p-2">{getChannelLabel(row.channel)}</td>
                    <td className="p-2">
                      <Button
                        size="sm"
                        variant="outline"
                        nativeButton={false}
                        render={
                          <Link href={`/pos/receipt/${row.id}`}>
                            {strings.reports.viewReceiptAction}
                          </Link>
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {strings.reports.paginationPageInfo
                .replace("{page}", String(page))
                .replace("{totalPages}", String(totalPages))}
            </span>
            <div className="flex gap-2">
              {/* <a> tidak punya "disabled" native -- render tombol biasa
                  (nonaktif sungguhan) di ujung rentang, bukan Link yang
                  cuma terlihat nonaktif tapi tetap bisa diklik. */}
              {page <= 1 ? (
                <Button size="sm" variant="outline" disabled>
                  {strings.reports.paginationPrev}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  nativeButton={false}
                  render={<Link href={hrefForPage(page - 1)}>{strings.reports.paginationPrev}</Link>}
                />
              )}
              {page >= totalPages ? (
                <Button size="sm" variant="outline" disabled>
                  {strings.reports.paginationNext}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  nativeButton={false}
                  render={<Link href={hrefForPage(page + 1)}>{strings.reports.paginationNext}</Link>}
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
