"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { saveOutlet, type OutletFormState } from "./actions";
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

export type BrandOption = { id: string; name: string };

const NEW_BRAND_VALUE = "__new__";

export type OutletFormValue = {
  id: string;
  code: string;
  brandId: string;
  name: string;
  address: string | null;
  phone: string | null;
  dayCutoffTime: string;
  isCentralKitchen: boolean;
  taxPercent: string;
  taxInclusive: boolean;
  serviceChargePercent: string;
  serviceChargeInTaxBase: boolean;
  roundingTo: number;
  cashVarianceTolerance: string;
  cashEnabled: boolean;
  varianceAlertPercent: string;
  varianceAlertValue: string;
  isActive: boolean;
};

const initialState: OutletFormState = {};

export function OutletFormDialog({
  outlet,
  brands,
  canManageBrands,
  hasTransactions,
  trigger,
}: {
  outlet?: OutletFormValue;
  brands: BrandOption[];
  canManageBrands: boolean;
  hasTransactions?: boolean;
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(saveOutlet, initialState);
  const [brandSelection, setBrandSelection] = useState(outlet?.brandId ?? brands[0]?.id ?? "");
  const isAddingNewBrand = brandSelection === NEW_BRAND_VALUE;

  useEffect(() => {
    if (state.error) {
      toast.error(state.error);
    }
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form
          action={async (formData) => {
            await formAction(formData);
            setOpen(false);
          }}
        >
          <DialogHeader>
            <DialogTitle>{outlet ? strings.outlets.editTitle : strings.outlets.addTitle}</DialogTitle>
          </DialogHeader>
          {outlet ? <input type="hidden" name="id" value={outlet.id} /> : null}
          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="code">{strings.outlets.code}</Label>
              <Input
                id="code"
                name="code"
                placeholder={strings.outlets.codePlaceholder}
                defaultValue={outlet?.code}
                required
                disabled={Boolean(outlet)}
              />
              {outlet ? (
                <p className="text-xs text-muted-foreground">{strings.outlets.codeLockedHint}</p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">{strings.outlets.name}</Label>
              <Input id="name" name="name" defaultValue={outlet?.name} required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="brandId">{strings.outlets.brand}</Label>
              <select
                id="brandId"
                name="brandId"
                value={brandSelection}
                onChange={(e) => setBrandSelection(e.target.value)}
                className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
              >
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
                {canManageBrands ? (
                  <option value={NEW_BRAND_VALUE}>{strings.outlets.brandAddNew}</option>
                ) : null}
              </select>
              <p className="text-xs text-muted-foreground">{strings.outlets.brandHint}</p>
              {isAddingNewBrand ? (
                <div className="flex flex-col gap-2 rounded-lg border border-input p-2">
                  <Label htmlFor="newBrandName">{strings.outlets.brandNewNameLabel}</Label>
                  <Input id="newBrandName" name="newBrandName" required />
                </div>
              ) : null}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="address">{strings.outlets.address}</Label>
              <Input id="address" name="address" defaultValue={outlet?.address ?? ""} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="phone">{strings.outlets.phone}</Label>
              <Input id="phone" name="phone" defaultValue={outlet?.phone ?? ""} />
            </div>

            <div className="flex flex-col gap-2 rounded-lg border border-input p-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="isCentralKitchen"
                  name="isCentralKitchen"
                  defaultChecked={outlet?.isCentralKitchen ?? false}
                />
                <Label htmlFor="isCentralKitchen" className="text-sm font-normal">
                  {strings.outlets.isCentralKitchen}
                </Label>
              </div>
              <p className="text-xs text-muted-foreground">{strings.outlets.isCentralKitchenHint}</p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="dayCutoffTime">{strings.outlets.dayCutoffTime}</Label>
              <Input
                id="dayCutoffTime"
                name="dayCutoffTime"
                type="time"
                step={1}
                defaultValue={outlet?.dayCutoffTime ?? "04:00:00"}
                required
              />
              <p className="text-xs text-muted-foreground">{strings.outlets.dayCutoffTimeHint}</p>
              {outlet && hasTransactions ? (
                <p className="rounded-lg border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
                  {strings.outlets.dayCutoffTimeChangeWarning}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-3">
              <div>
                <p className="text-sm font-semibold text-destructive">
                  {strings.outlets.fiscalWarningTitle}
                </p>
                <p className="text-xs text-destructive">{strings.outlets.fiscalWarning}</p>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="taxPercent">{strings.outlets.taxPercent}</Label>
                <Input
                  id="taxPercent"
                  name="taxPercent"
                  type="number"
                  step="0.0001"
                  min="0"
                  defaultValue={outlet?.taxPercent ?? "10"}
                  required
                />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="taxInclusive"
                  name="taxInclusive"
                  defaultChecked={outlet?.taxInclusive ?? false}
                />
                <Label htmlFor="taxInclusive" className="text-sm font-normal">
                  {strings.outlets.taxInclusive}
                </Label>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="serviceChargePercent">{strings.outlets.serviceChargePercent}</Label>
                <Input
                  id="serviceChargePercent"
                  name="serviceChargePercent"
                  type="number"
                  step="0.0001"
                  min="0"
                  defaultValue={outlet?.serviceChargePercent ?? "0"}
                  required
                />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="serviceChargeInTaxBase"
                  name="serviceChargeInTaxBase"
                  defaultChecked={outlet?.serviceChargeInTaxBase ?? true}
                />
                <Label htmlFor="serviceChargeInTaxBase" className="text-sm font-normal">
                  {strings.outlets.serviceChargeInTaxBase}
                </Label>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="roundingTo">{strings.outlets.roundingTo}</Label>
              <Input
                id="roundingTo"
                name="roundingTo"
                type="number"
                step="1"
                min="1"
                defaultValue={outlet?.roundingTo ?? 100}
                required
              />
              <p className="text-xs text-muted-foreground">{strings.outlets.roundingToHint}</p>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="cashEnabled"
                  name="cashEnabled"
                  defaultChecked={outlet?.cashEnabled ?? true}
                />
                <Label htmlFor="cashEnabled" className="text-sm font-normal">
                  {strings.outlets.cashEnabled}
                </Label>
              </div>
              <Label htmlFor="cashVarianceTolerance">{strings.outlets.cashVarianceTolerance}</Label>
              <Input
                id="cashVarianceTolerance"
                name="cashVarianceTolerance"
                type="number"
                step="1"
                min="0"
                defaultValue={outlet?.cashVarianceTolerance ?? "20000"}
                required
              />
              <p className="text-xs text-muted-foreground">
                {strings.outlets.cashVarianceToleranceHint}
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="varianceAlertPercent">{strings.outlets.varianceAlertPercent}</Label>
              <Input
                id="varianceAlertPercent"
                name="varianceAlertPercent"
                type="number"
                step="0.0001"
                min="0"
                defaultValue={outlet?.varianceAlertPercent ?? "3"}
                required
              />
              <Label htmlFor="varianceAlertValue">{strings.outlets.varianceAlertValue}</Label>
              <Input
                id="varianceAlertValue"
                name="varianceAlertValue"
                type="number"
                step="1"
                min="0"
                defaultValue={outlet?.varianceAlertValue ?? "100000"}
                required
              />
              <p className="text-xs text-muted-foreground">{strings.outlets.varianceAlertHint}</p>
            </div>

            {outlet ? (
              <div className="flex items-center gap-2">
                <Checkbox id="isActive" name="isActive" defaultChecked={outlet.isActive} />
                <Label htmlFor="isActive" className="text-sm font-normal">
                  {strings.outlets.isActive}
                </Label>
              </div>
            ) : null}
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
