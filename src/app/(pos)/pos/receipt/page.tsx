import Link from "next/link";
import { toZonedTime } from "date-fns-tz";
import { format } from "date-fns";
import { Decimal } from "decimal.js";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import {
  getBusinessTimezone,
  listTodaysOrders,
  searchOrdersByNumber,
  type OrderListRow,
} from "./list-orders";
import { formatIDR } from "@/lib/utils/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getChannelLabel } from "@/lib/pos/channel-labels";
import { id as strings } from "@/lib/i18n/id";

function formatTime(date: Date | null, timezone: string): string {
  if (!date) return "-";
  return format(toZonedTime(date, timezone), "HH:mm");
}

function OrdersTable({ rows, timezone }: { rows: OrderListRow[]; timezone: string }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{strings.receipt.listEmpty}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th className="p-2 font-medium">{strings.receipt.listColNumber}</th>
            <th className="p-2 font-medium">{strings.receipt.listColTime}</th>
            <th className="p-2 text-right font-medium">{strings.receipt.listColTotal}</th>
            <th className="p-2 font-medium">{strings.receipt.listColPaymentMethod}</th>
            <th className="p-2 font-medium">{strings.receipt.listColChannel}</th>
            <th className="p-2 font-medium">{strings.receipt.listColAction}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t">
              <td className="p-2 font-mono text-xs">{row.number}</td>
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
                      {strings.receipt.listPrintAction}
                    </Link>
                  }
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function ReceiptListPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = q?.trim() ?? "";

  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "pos.reprint_receipt"
  );

  let rows: OrderListRow[];
  let timezone: string;
  try {
    rows = query
      ? await searchOrdersByNumber(db, businessId, query)
      : await listTodaysOrders(db, businessId);
    timezone = await getBusinessTimezone(db, businessId);
  } finally {
    await closeDb();
  }

  return (
    <div className="flex min-h-dvh flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">
          {query ? strings.receipt.listSearchResultTitle : strings.receipt.listTitle}
        </h1>
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link href="/pos">{strings.receipt.listBackToPos}</Link>}
        />
      </div>

      <form action="/pos/receipt" className="flex items-end gap-2">
        <div className="flex flex-1 flex-col gap-1">
          <Label className="text-xs" htmlFor="q">
            {strings.receipt.listSearchLabel}
          </Label>
          <Input
            id="q"
            name="q"
            defaultValue={query}
            placeholder={strings.receipt.listSearchPlaceholder}
          />
        </div>
        <Button type="submit" variant="secondary">
          {strings.receipt.listSearchButton}
        </Button>
        {query ? (
          <Button
            variant="ghost"
            nativeButton={false}
            render={<Link href="/pos/receipt">{strings.receipt.listSearchClear}</Link>}
          />
        ) : null}
      </form>

      {query && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{strings.receipt.listSearchEmpty}</p>
      ) : (
        <OrdersTable rows={rows} timezone={timezone} />
      )}
    </div>
  );
}
