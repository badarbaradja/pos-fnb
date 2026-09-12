import { asc, eq } from "drizzle-orm";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { hasPermission, requirePermissionDb } from "@/lib/auth/permissions";
import { brands, orders, outlets } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { id as strings } from "@/lib/i18n/id";
import { OutletFormDialog, type OutletFormValue } from "./outlet-form-dialog";
import { DayCutoffConfirmButton } from "./day-cutoff-confirm-button";

export default async function OutletsPage() {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId, role } = await requirePermissionDb(
    supabase,
    "outlet.manage"
  );

  // Membuat outlet baru digerbang TERPISAH (owner-only) dari mengubah yang
  // sudah ada (owner+manajer) -- keputusan pemilik soal outlet baru
  // (konsekuensi biaya/struktur), lihat permissions.ts.
  const canCreate = hasPermission(role, "settings.business");

  let outletRows;
  let brandRows;
  let outletIdsWithTransactions: Set<string>;
  try {
    outletRows = await db
      .select()
      .from(outlets)
      .where(eq(outlets.businessId, businessId))
      .orderBy(asc(outlets.createdAt));

    brandRows = await db
      .select({ id: brands.id, name: brands.name })
      .from(brands)
      .where(eq(brands.businessId, businessId))
      .orderBy(asc(brands.name));

    const txRows = await db
      .selectDistinct({ outletId: orders.outletId })
      .from(orders)
      .where(eq(orders.businessId, businessId));
    outletIdsWithTransactions = new Set(txRows.map((r) => r.outletId));
  } finally {
    await closeDb();
  }

  const brandNameById = new Map(brandRows.map((b) => [b.id, b.name]));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{strings.outlets.title}</h1>
          <p className="text-sm text-muted-foreground">{strings.outlets.subtitle}</p>
          <p className="text-xs text-muted-foreground">{strings.outlets.noDeleteHint}</p>
        </div>
        {canCreate ? (
          <OutletFormDialog
            brands={brandRows}
            canManageBrands={canCreate}
            trigger={<Button>{strings.outlets.addButton}</Button>}
          />
        ) : (
          <p className="max-w-xs text-right text-xs text-muted-foreground">
            {strings.outlets.addOwnerOnlyHint}
          </p>
        )}
      </div>

      {outletRows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{strings.outlets.empty}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{strings.outlets.colCode}</TableHead>
              <TableHead>{strings.outlets.colName}</TableHead>
              <TableHead>{strings.outlets.brand}</TableHead>
              <TableHead>{strings.outlets.colType}</TableHead>
              <TableHead>{strings.outlets.colCutoff}</TableHead>
              <TableHead>{strings.outlets.colStatus}</TableHead>
              <TableHead className="text-right">{strings.outlets.colActions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {outletRows.map((row) => {
              const formValue: OutletFormValue = {
                id: row.id,
                code: row.code,
                brandId: row.brandId,
                name: row.name,
                address: row.address,
                phone: row.phone,
                dayCutoffTime: row.dayCutoffTime,
                isCentralKitchen: row.isCentralKitchen,
                taxPercent: row.taxPercent,
                taxInclusive: row.taxInclusive,
                serviceChargePercent: row.serviceChargePercent,
                serviceChargeInTaxBase: row.serviceChargeInTaxBase,
                roundingTo: row.roundingTo,
                cashVarianceTolerance: row.cashVarianceTolerance,
                cashEnabled: row.cashEnabled,
                varianceAlertPercent: row.varianceAlertPercent,
                varianceAlertValue: row.varianceAlertValue,
                isActive: row.isActive,
              };
              return (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs">{row.code}</TableCell>
                  <TableCell>{row.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {brandNameById.get(row.brandId) ?? "-"}
                  </TableCell>
                  <TableCell>
                    {row.isCentralKitchen ? (
                      <Badge variant="secondary">{strings.outlets.typeCentralKitchen}</Badge>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        {strings.outlets.typeRetail}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <span className="font-mono text-xs">{row.dayCutoffTime}</span>
                      {row.dayCutoffConfirmed ? (
                        <Badge variant="default">{strings.outlets.cutoffConfirmed}</Badge>
                      ) : (
                        <>
                          <Badge variant="destructive">{strings.outlets.cutoffNotConfirmed}</Badge>
                          <DayCutoffConfirmButton outletId={row.id} />
                        </>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={row.isActive ? "default" : "secondary"}>
                      {row.isActive ? strings.common.active : strings.common.inactive}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <OutletFormDialog
                      outlet={formValue}
                      brands={brandRows}
                      canManageBrands={canCreate}
                      hasTransactions={outletIdsWithTransactions.has(row.id)}
                      trigger={
                        <Button variant="ghost" size="sm">
                          {strings.common.edit}
                        </Button>
                      }
                    />
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
