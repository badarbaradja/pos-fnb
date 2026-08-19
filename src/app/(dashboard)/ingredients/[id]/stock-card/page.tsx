import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { employees, ingredients, stockMovements } from "@/lib/db/schema";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { id as strings } from "@/lib/i18n/id";

const movementTypeLabels: Record<string, string> = {
  initial: strings.stockCard.movementInitial,
  purchase: strings.stockCard.movementPurchase,
  sale: strings.stockCard.movementSale,
  waste: strings.stockCard.movementWaste,
  opname_adjust: strings.stockCard.movementOpnameAdjust,
  transfer_in: strings.stockCard.movementTransferIn,
  transfer_out: strings.stockCard.movementTransferOut,
  transfer_cancel: strings.stockCard.movementTransferCancel,
  transfer_loss: strings.stockCard.movementTransferLoss,
  production_in: strings.stockCard.movementProductionIn,
  production_out: strings.stockCard.movementProductionOut,
  refund_in: strings.stockCard.movementRefundIn,
  manual_adjust: strings.stockCard.movementManualAdjust,
};

export default async function IngredientStockCardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "product.manage");

  let ingredient;
  let rows;
  try {
    [ingredient] = await db
      .select({ id: ingredients.id, name: ingredients.name, baseUnit: ingredients.baseUnit })
      .from(ingredients)
      .where(and(eq(ingredients.id, id), eq(ingredients.businessId, businessId)));

    if (!ingredient) {
      return null;
    }

    const movementRows = await db
      .select()
      .from(stockMovements)
      .where(and(eq(stockMovements.businessId, businessId), eq(stockMovements.ingredientId, id)))
      .orderBy(desc(stockMovements.createdAt));

    const employeeIds = [...new Set(movementRows.map((m) => m.createdBy).filter((v): v is string => v != null))];
    const employeeRows = employeeIds.length
      ? await db.select({ id: employees.id, fullName: employees.fullName }).from(employees)
      : [];
    const employeeNameById = new Map(employeeRows.map((e) => [e.id, e.fullName]));

    rows = movementRows.map((m) => ({
      ...m,
      createdByName: m.createdBy ? (employeeNameById.get(m.createdBy) ?? "-") : "-",
    }));
  } finally {
    await closeDb();
  }

  if (!ingredient) {
    return null;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/ingredients" className="text-sm text-muted-foreground underline">
          {strings.common.back}
        </Link>
        <h1 className="text-xl font-semibold">{strings.stockCard.title}</h1>
        <p className="text-sm text-muted-foreground">
          {strings.stockCard.subtitle.replace("{ingredient}", ingredient.name)}
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{strings.stockCard.empty}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{strings.stockCard.colDate}</TableHead>
              <TableHead>{strings.stockCard.colType}</TableHead>
              <TableHead>{strings.stockCard.colQty}</TableHead>
              <TableHead>{strings.stockCard.colBalance}</TableHead>
              <TableHead>{strings.stockCard.colUnitCost}</TableHead>
              <TableHead>{strings.stockCard.colCreatedBy}</TableHead>
              <TableHead>{strings.stockCard.colNote}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const isNegative = Number(row.balanceAfter) < 0;
              return (
                <TableRow key={row.id} className={isNegative ? "bg-destructive/10" : undefined}>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {row.createdAt.toLocaleString("id-ID")}
                  </TableCell>
                  <TableCell>
                    {movementTypeLabels[row.movementType] ?? row.movementType}
                    {row.movementType === "transfer_loss" ? (
                      <span title={strings.stockCard.transferLossHint} className="ml-1 cursor-help text-xs">
                        ⓘ
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell
                    className={
                      row.movementType === "transfer_loss"
                        ? "text-muted-foreground italic"
                        : Number(row.qty) < 0
                          ? "text-destructive"
                          : undefined
                    }
                  >
                    {row.qty} {ingredient.baseUnit}
                  </TableCell>
                  <TableCell className={isNegative ? "font-semibold text-destructive" : undefined}>
                    {row.balanceAfter} {ingredient.baseUnit}
                    {isNegative ? (
                      <span
                        title={strings.stockCard.negativeRowHint}
                        className="ml-2 rounded bg-destructive px-1.5 py-0.5 text-xs text-destructive-foreground"
                      >
                        {strings.stockCard.negativeBadge}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>{row.unitCost}</TableCell>
                  <TableCell>{row.createdByName}</TableCell>
                  <TableCell className="max-w-xs text-sm text-muted-foreground">{row.note ?? "-"}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
