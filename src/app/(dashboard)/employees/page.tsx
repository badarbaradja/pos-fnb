import { and, asc, eq } from "drizzle-orm";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { employees, outlets } from "@/lib/db/schema";
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
import { EmployeeFormDialog, type EmployeeFormValue } from "./employee-form-dialog";
import { EmployeeRowActions } from "./employee-row-actions";

const roleLabels: Record<string, string> = {
  owner: strings.employees.roleOwner,
  manager: strings.employees.roleManager,
  cashier: strings.employees.roleCashier,
  waiter: strings.employees.roleWaiter,
  kitchen: strings.employees.roleKitchen,
  warehouse: strings.employees.roleWarehouse,
  accountant: strings.employees.roleAccountant,
};

export default async function EmployeesPage() {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "employee.manage");

  let employeeRows;
  let outletRows;
  try {
    outletRows = await db
      .select({ id: outlets.id, name: outlets.name })
      .from(outlets)
      .where(and(eq(outlets.businessId, businessId), eq(outlets.isActive, true)))
      .orderBy(asc(outlets.createdAt));

    employeeRows = await db
      .select()
      .from(employees)
      .where(eq(employees.businessId, businessId))
      .orderBy(asc(employees.code));
  } finally {
    await closeDb();
  }

  const outletOptions = outletRows.map((o) => ({ id: o.id, name: o.name }));
  const outletNameById = new Map(outletRows.map((o) => [o.id, o.name]));

  const groups: { key: string; name: string; rows: typeof employeeRows }[] = [
    ...outletRows.map((o) => ({
      key: o.id,
      name: o.name,
      rows: employeeRows.filter((e) => e.outletId === o.id),
    })),
    {
      key: "__none__",
      name: strings.employees.groupNoOutlet,
      rows: employeeRows.filter(
        (e) => e.outletId === null || !outletNameById.has(e.outletId)
      ),
    },
  ].filter((g) => g.rows.length > 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{strings.employees.title}</h1>
          <p className="text-sm text-muted-foreground">{strings.employees.subtitle}</p>
          <p className="text-xs text-muted-foreground">{strings.employees.noDeleteHint}</p>
        </div>
        <EmployeeFormDialog
          outlets={outletOptions}
          trigger={<Button>{strings.employees.addButton}</Button>}
        />
      </div>

      {employeeRows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{strings.employees.empty}</p>
      ) : (
        groups.map((group) => (
          <div key={group.key} className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-muted-foreground">{group.name}</h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{strings.employees.colCode}</TableHead>
                  <TableHead>{strings.employees.colName}</TableHead>
                  <TableHead>{strings.employees.colRole}</TableHead>
                  <TableHead>{strings.employees.colStatus}</TableHead>
                  <TableHead className="text-right">{strings.employees.colActions}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.rows.map((row) => {
                  const formValue: EmployeeFormValue = {
                    id: row.id,
                    code: row.code,
                    fullName: row.fullName,
                    role: row.role as EmployeeFormValue["role"],
                    outletId: row.outletId,
                    isActive: row.isActive,
                  };
                  const isLocked = row.lockedUntil !== null && row.lockedUntil.getTime() > Date.now();
                  const lockedUntilText = isLocked
                    ? row.lockedUntil!.toLocaleTimeString("id-ID")
                    : null;
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono text-xs">{row.code}</TableCell>
                      <TableCell>{row.fullName}</TableCell>
                      <TableCell>{roleLabels[row.role] ?? row.role}</TableCell>
                      <TableCell>
                        <Badge variant={row.isActive ? "default" : "secondary"}>
                          {row.isActive ? strings.common.active : strings.common.inactive}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <EmployeeFormDialog
                            employee={formValue}
                            outlets={outletOptions}
                            trigger={
                              <Button variant="ghost" size="sm">
                                {strings.common.edit}
                              </Button>
                            }
                          />
                          <EmployeeRowActions
                            employeeId={row.id}
                            isLocked={isLocked}
                            lockedUntilText={lockedUntilText}
                          />
                        </div>
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
