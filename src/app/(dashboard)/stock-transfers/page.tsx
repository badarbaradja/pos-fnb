import Link from "next/link";
import { and, asc, desc, eq } from "drizzle-orm";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { employees, outlets, stockTransfers } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { id as strings } from "@/lib/i18n/id";
import { StockTransferCancelButton } from "./stock-transfer-row-actions";

export default async function StockTransfersPage() {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "stock.transfer");

  let rows;
  let outletRows;
  let employeeRows;
  try {
    rows = await db
      .select()
      .from(stockTransfers)
      .where(eq(stockTransfers.businessId, businessId))
      .orderBy(desc(stockTransfers.receivedAt));

    outletRows = await db
      .select({ id: outlets.id, name: outlets.name })
      .from(outlets)
      .where(eq(outlets.businessId, businessId));

    employeeRows = await db
      .select({ id: employees.id, fullName: employees.fullName })
      .from(employees)
      .where(and(eq(employees.businessId, businessId), eq(employees.isActive, true)))
      .orderBy(asc(employees.fullName));
  } finally {
    await closeDb();
  }

  const outletNameById = new Map(outletRows.map((o) => [o.id, o.name]));
  const employeeNameById = new Map(employeeRows.map((e) => [e.id, e.fullName]));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{strings.stockTransfers.title}</h1>
          <p className="text-sm text-muted-foreground">{strings.stockTransfers.subtitle}</p>
          <p className="text-xs text-muted-foreground">{strings.stockTransfers.noDeleteHint}</p>
        </div>
        <Link href="/stock-transfers/new">
          <Button>{strings.stockTransfers.receiveButton}</Button>
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{strings.stockTransfers.empty}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{strings.stockTransfers.colNumber}</TableHead>
              <TableHead>{strings.stockTransfers.colOutlet}</TableHead>
              <TableHead>{strings.stockTransfers.colReceivedAt}</TableHead>
              <TableHead>{strings.stockTransfers.colReceivedBy}</TableHead>
              <TableHead>{strings.stockTransfers.colStatus}</TableHead>
              <TableHead className="text-right">{strings.stockTransfers.colActions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-mono text-xs">{row.number}</TableCell>
                <TableCell>{outletNameById.get(row.toOutletId) ?? "-"}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {row.receivedAt.toLocaleString("id-ID")}
                </TableCell>
                <TableCell>{(row.receivedBy && employeeNameById.get(row.receivedBy)) ?? "-"}</TableCell>
                <TableCell>
                  <Badge variant={row.status === "received" ? "default" : "secondary"}>
                    {row.status === "received"
                      ? strings.stockTransfers.statusReceived
                      : strings.stockTransfers.statusCancelled}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <StockTransferCancelButton
                    transferId={row.id}
                    status={row.status}
                    employees={employeeRows}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
