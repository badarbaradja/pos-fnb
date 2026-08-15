import { asc, eq } from "drizzle-orm";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { priceTiers } from "@/lib/db/schema";
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
import { PriceTierFormDialog } from "./price-tier-form-dialog";
import { PriceTierToggleActiveButton } from "./price-tier-row-actions";

export default async function PriceTiersPage() {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "price.manage"
  );

  let rows;
  try {
    rows = await db
      .select()
      .from(priceTiers)
      .where(eq(priceTiers.businessId, businessId))
      .orderBy(asc(priceTiers.code));
  } finally {
    await closeDb();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{strings.priceTiers.title}</h1>
          <p className="text-sm text-muted-foreground">
            {strings.priceTiers.subtitle}
          </p>
        </div>
        <PriceTierFormDialog
          trigger={<Button>{strings.priceTiers.addButton}</Button>}
        />
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {strings.priceTiers.empty}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{strings.priceTiers.code}</TableHead>
              <TableHead>{strings.priceTiers.name}</TableHead>
              <TableHead>{strings.priceTiers.channel}</TableHead>
              <TableHead>{strings.priceTiers.markupPercent}</TableHead>
              <TableHead>{strings.priceTiers.colStatus}</TableHead>
              <TableHead className="text-right">
                {strings.common.actions}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="flex items-center gap-2">
                  {row.code}
                  {row.isDefault ? (
                    <Badge variant="secondary">{strings.priceTiers.isDefault}</Badge>
                  ) : null}
                </TableCell>
                <TableCell>{row.name}</TableCell>
                <TableCell>{row.channel ?? "-"}</TableCell>
                <TableCell>{row.markupPercent ?? "0"}%</TableCell>
                <TableCell>
                  <Badge variant={row.isActive ? "default" : "secondary"}>
                    {row.isActive ? strings.common.active : strings.common.inactive}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <PriceTierFormDialog
                      priceTier={row}
                      trigger={
                        <Button variant="ghost" size="sm">
                          {strings.common.edit}
                        </Button>
                      }
                    />
                    <PriceTierToggleActiveButton
                      priceTierId={row.id}
                      isActive={row.isActive}
                    />
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
