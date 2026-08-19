import Link from "next/link";
import { asc, eq, inArray } from "drizzle-orm";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { ingredients, stockMovements, units } from "@/lib/db/schema";
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
import { IngredientFormDialog, type IngredientFormValue } from "./ingredient-form-dialog";
import {
  IngredientDeleteButton,
  IngredientToggleActiveButton,
} from "./ingredient-row-actions";

function formatFactor(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n.toFixed(8).replace(/\.?0+$/, "");
}

export default async function IngredientsPage() {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "product.manage");

  let rows;
  let unitRows;
  let lockedIds: Set<string>;
  try {
    unitRows = await db
      .select({ code: units.code, name: units.name })
      .from(units)
      .where(eq(units.businessId, businessId))
      .orderBy(asc(units.code));

    rows = await db
      .select()
      .from(ingredients)
      .where(eq(ingredients.businessId, businessId))
      .orderBy(asc(ingredients.name));

    const ingredientIds = rows.map((r) => r.id);
    const movementRows =
      ingredientIds.length > 0
        ? await db
            .selectDistinct({ ingredientId: stockMovements.ingredientId })
            .from(stockMovements)
            .where(inArray(stockMovements.ingredientId, ingredientIds))
        : [];
    lockedIds = new Set(movementRows.map((r) => r.ingredientId));
  } finally {
    await closeDb();
  }

  const unitOptions = unitRows.map((u) => ({ code: u.code, name: u.name }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{strings.ingredients.title}</h1>
          <p className="text-sm text-muted-foreground">{strings.ingredients.subtitle}</p>
          <p className="text-xs text-muted-foreground">{strings.ingredients.noDeleteHint}</p>
        </div>
        <IngredientFormDialog
          unitOptions={unitOptions}
          trigger={
            <Button disabled={unitOptions.length === 0}>{strings.ingredients.addButton}</Button>
          }
        />
      </div>

      {unitOptions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {strings.ingredients.noUnitsWarning}{" "}
          <Link href="/units" className="underline">
            {strings.ingredients.goToUnits}
          </Link>
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{strings.ingredients.empty}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{strings.ingredients.colCode}</TableHead>
              <TableHead>{strings.ingredients.colName}</TableHead>
              <TableHead>{strings.ingredients.colCategory}</TableHead>
              <TableHead>{strings.ingredients.colBaseUnit}</TableHead>
              <TableHead>{strings.ingredients.colConversion}</TableHead>
              <TableHead>{strings.ingredients.colStatus}</TableHead>
              <TableHead className="text-right">{strings.ingredients.colActions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const formValue: IngredientFormValue = {
                id: row.id,
                code: row.code,
                name: row.name,
                category: row.category,
                baseUnit: row.baseUnit,
                purchaseUnit: row.purchaseUnit,
                purchaseFactor: row.purchaseFactor,
                yieldPercent: row.yieldPercent,
                isSemiFinished: row.isSemiFinished,
                shelfLifeDays: row.shelfLifeDays,
              };
              return (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs">{row.code ?? "-"}</TableCell>
                  <TableCell>{row.name}</TableCell>
                  <TableCell>{row.category ?? "-"}</TableCell>
                  <TableCell>{row.baseUnit}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    1 {row.purchaseUnit} = {formatFactor(row.purchaseFactor)} {row.baseUnit}
                  </TableCell>
                  <TableCell>
                    <Badge variant={row.isActive ? "default" : "secondary"}>
                      {row.isActive ? strings.common.active : strings.common.inactive}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Link href={`/ingredients/${row.id}/stock-card`}>
                        <Button variant="ghost" size="sm">
                          {strings.stockCard.viewLink}
                        </Button>
                      </Link>
                      <IngredientFormDialog
                        ingredient={formValue}
                        unitOptions={unitOptions}
                        baseUnitLocked={lockedIds.has(row.id)}
                        trigger={
                          <Button variant="ghost" size="sm">
                            {strings.common.edit}
                          </Button>
                        }
                      />
                      <IngredientToggleActiveButton
                        ingredientId={row.id}
                        isActive={row.isActive}
                      />
                      <IngredientDeleteButton ingredientId={row.id} />
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
