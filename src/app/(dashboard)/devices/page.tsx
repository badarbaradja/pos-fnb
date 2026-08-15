import { and, asc, eq } from "drizzle-orm";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { devices, outlets } from "@/lib/db/schema";
import { deviceTypeValues, type DeviceActionResult } from "@/lib/devices/manage";
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
import { DeviceFormDialog, type DeviceFormValue } from "./device-form-dialog";

export type { DeviceActionResult };

const typeLabels: Record<(typeof deviceTypeValues)[number], string> = {
  pos: strings.devices.typePos,
  waiter: strings.devices.typeWaiter,
  kds: strings.devices.typeKds,
  display: strings.devices.typeDisplay,
};

export default async function DevicesPage() {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "employee.manage");

  let deviceRows;
  let outletRows;
  try {
    outletRows = await db
      .select({ id: outlets.id, name: outlets.name })
      .from(outlets)
      .where(and(eq(outlets.businessId, businessId), eq(outlets.isActive, true)))
      .orderBy(asc(outlets.createdAt));

    deviceRows = await db
      .select()
      .from(devices)
      .where(eq(devices.businessId, businessId))
      .orderBy(asc(devices.name));
  } finally {
    await closeDb();
  }

  const outletOptions = outletRows.map((o) => ({ id: o.id, name: o.name }));
  const outletNameById = new Map(outletRows.map((o) => [o.id, o.name]));

  const groups: { key: string; name: string; rows: typeof deviceRows }[] = [
    ...outletRows.map((o) => ({
      key: o.id,
      name: o.name,
      rows: deviceRows.filter((d) => d.outletId === o.id),
    })),
    {
      key: "__none__",
      name: strings.devices.groupNoOutlet,
      rows: deviceRows.filter((d) => !outletNameById.has(d.outletId)),
    },
  ].filter((g) => g.rows.length > 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{strings.devices.title}</h1>
          <p className="text-sm text-muted-foreground">{strings.devices.subtitle}</p>
        </div>
        <DeviceFormDialog
          outlets={outletOptions}
          trigger={<Button disabled={outletOptions.length === 0}>{strings.devices.addButton}</Button>}
        />
      </div>

      {deviceRows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{strings.devices.empty}</p>
      ) : (
        groups.map((group) => (
          <div key={group.key} className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-muted-foreground">{group.name}</h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{strings.devices.colName}</TableHead>
                  <TableHead>{strings.devices.colSerialNumber}</TableHead>
                  <TableHead>{strings.devices.colType}</TableHead>
                  <TableHead>{strings.devices.colLastSeq}</TableHead>
                  <TableHead>{strings.devices.colLastSync}</TableHead>
                  <TableHead>{strings.devices.colStatus}</TableHead>
                  <TableHead className="text-right">{strings.devices.colActions}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.rows.map((row) => {
                  const formValue: DeviceFormValue = {
                    id: row.id,
                    name: row.name,
                    outletId: row.outletId,
                    serialNumber: row.serialNumber,
                    deviceType: row.deviceType as DeviceFormValue["deviceType"],
                    isActive: row.isActive,
                  };
                  // Diformat di server (bukan Client Component) supaya tidak
                  // kena lint purity rule (Date/toLocaleString saat render) --
                  // precedent sama dengan lockedUntilText di employees/page.tsx.
                  const lastSyncText = row.lastSyncAt
                    ? row.lastSyncAt.toLocaleString("id-ID")
                    : strings.devices.neverSynced;
                  return (
                    <TableRow key={row.id}>
                      <TableCell>{row.name}</TableCell>
                      <TableCell className="font-mono text-xs">{row.serialNumber}</TableCell>
                      <TableCell>
                        {typeLabels[row.deviceType as DeviceFormValue["deviceType"]] ?? row.deviceType}
                      </TableCell>
                      <TableCell>{row.lastSeq}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{lastSyncText}</TableCell>
                      <TableCell>
                        <Badge variant={row.isActive ? "default" : "secondary"}>
                          {row.isActive ? strings.common.active : strings.common.inactive}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <DeviceFormDialog
                          device={formValue}
                          outlets={outletOptions}
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
          </div>
        ))
      )}
    </div>
  );
}
