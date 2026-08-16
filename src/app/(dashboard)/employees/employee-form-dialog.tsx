"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { saveEmployee, type EmployeeFormState } from "./actions";
import { employeeRoleValues } from "@/lib/employees/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { id as strings } from "@/lib/i18n/id";

const roleLabels: Record<(typeof employeeRoleValues)[number], string> = {
  owner: strings.employees.roleOwner,
  manager: strings.employees.roleManager,
  cashier: strings.employees.roleCashier,
  waiter: strings.employees.roleWaiter,
  kitchen: strings.employees.roleKitchen,
  warehouse: strings.employees.roleWarehouse,
  accountant: strings.employees.roleAccountant,
};

export type EmployeeFormValue = {
  id: string;
  code: string;
  fullName: string;
  role: (typeof employeeRoleValues)[number];
  outletId: string | null;
  isActive: boolean;
};

export type OutletOption = { id: string; name: string };

const initialState: EmployeeFormState = {};

export function EmployeeFormDialog({
  employee,
  outlets,
  trigger,
}: {
  employee?: EmployeeFormValue;
  outlets: OutletOption[];
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(saveEmployee, initialState);

  useEffect(() => {
    if (state.error) {
      toast.error(state.error);
    }
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent>
        <form
          action={async (formData) => {
            await formAction(formData);
            setOpen(false);
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {employee ? strings.employees.editTitle : strings.employees.addTitle}
            </DialogTitle>
          </DialogHeader>
          {employee ? <input type="hidden" name="id" value={employee.id} /> : null}
          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="code">{strings.employees.code}</Label>
              <Input
                id="code"
                name="code"
                defaultValue={employee?.code}
                required
                disabled={Boolean(employee)}
              />
              {employee ? (
                <p className="text-xs text-muted-foreground">
                  {strings.employees.codeLockedHint}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="fullName">{strings.employees.fullName}</Label>
              <Input id="fullName" name="fullName" defaultValue={employee?.fullName} required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="role">{strings.employees.role}</Label>
              <select
                id="role"
                name="role"
                defaultValue={employee?.role ?? "cashier"}
                className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
              >
                {employeeRoleValues.map((role) => (
                  <option key={role} value={role}>
                    {roleLabels[role]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="outletId">{strings.employees.outlet}</Label>
              <select
                id="outletId"
                name="outletId"
                defaultValue={employee?.outletId ?? ""}
                className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
              >
                <option value="">{strings.employees.noOutletOption}</option>
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
            {!employee ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="pin">{strings.employees.initialPin}</Label>
                <Input
                  id="pin"
                  name="pin"
                  type="password"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  required
                />
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Checkbox id="isActive" name="isActive" defaultChecked={employee.isActive} />
                <Label htmlFor="isActive" className="text-sm font-normal">
                  {strings.employees.isActive}
                </Label>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? strings.common.saving : strings.common.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
