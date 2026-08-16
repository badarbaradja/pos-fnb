import { asc, eq } from "drizzle-orm";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { units } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { id as strings } from "@/lib/i18n/id";
import { UnitFormDialog } from "./unit-form-dialog";
import { UnitDeleteButton } from "./unit-row-actions";

export default async function UnitsPage() {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "product.manage");

  let rows;
  try {
    rows = await db
      .select()
      .from(units)
      .where(eq(units.businessId, businessId))
      .orderBy(asc(units.code));
  } finally {
    await closeDb();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{strings.units.title}</h1>
          <p className="text-sm text-muted-foreground">{strings.units.subtitle}</p>
          <p className="text-xs text-muted-foreground">{strings.units.noDeleteHint}</p>
        </div>
        <UnitFormDialog trigger={<Button>{strings.units.addButton}</Button>} />
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{strings.units.empty}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{strings.units.colCode}</TableHead>
              <TableHead>{strings.units.colName}</TableHead>
              <TableHead>{strings.units.colBaseUnit}</TableHead>
              <TableHead>{strings.units.colFactor}</TableHead>
              <TableHead className="text-right">{strings.units.colActions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-mono text-xs">{row.code}</TableCell>
                <TableCell>{row.name}</TableCell>
                <TableCell>{row.baseUnit}</TableCell>
                <TableCell>{Number(row.factor)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <UnitFormDialog
                      unit={{ ...row, factor: Number(row.factor).toString() }}
                      trigger={
                        <Button variant="ghost" size="sm">
                          {strings.common.edit}
                        </Button>
                      }
                    />
                    <UnitDeleteButton unitId={row.id} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
