"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { savePaymentMethod, type PaymentMethodFormState } from "./actions";
import { paymentMethodTypeValues } from "@/lib/payment-methods/manage";
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

const typeLabels: Record<(typeof paymentMethodTypeValues)[number], string> = {
  cash: strings.paymentMethods.typeCash,
  card: strings.paymentMethods.typeCard,
  ewallet: strings.paymentMethods.typeEwallet,
  qris: strings.paymentMethods.typeQris,
  transfer: strings.paymentMethods.typeTransfer,
  voucher: strings.paymentMethods.typeVoucher,
  credit: strings.paymentMethods.typeCredit,
};

export type PaymentMethodFormValue = {
  id: string;
  code: string;
  name: string;
  type: string;
  mdrPercent: string | null;
  isCashDrawer: boolean;
  requiresRef: boolean;
  sortOrder: number;
};

const initialState: PaymentMethodFormState = {};

export function PaymentMethodFormDialog({
  paymentMethod,
  trigger,
}: {
  paymentMethod?: PaymentMethodFormValue;
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(
    savePaymentMethod,
    initialState
  );

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
              {paymentMethod
                ? strings.paymentMethods.editTitle
                : strings.paymentMethods.addTitle}
            </DialogTitle>
          </DialogHeader>
          {paymentMethod ? (
            <input type="hidden" name="id" value={paymentMethod.id} />
          ) : null}
          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="code">{strings.paymentMethods.code}</Label>
              <Input id="code" name="code" defaultValue={paymentMethod?.code} required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">{strings.paymentMethods.name}</Label>
              <Input id="name" name="name" defaultValue={paymentMethod?.name} required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="type">{strings.paymentMethods.type}</Label>
              <select
                id="type"
                name="type"
                defaultValue={paymentMethod?.type ?? "cash"}
                className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
              >
                {paymentMethodTypeValues.map((type) => (
                  <option key={type} value={type}>
                    {typeLabels[type]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="mdrPercent">{strings.paymentMethods.mdrPercent}</Label>
              <Input
                id="mdrPercent"
                name="mdrPercent"
                type="number"
                step="0.0001"
                min={0}
                defaultValue={paymentMethod?.mdrPercent ?? "0"}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="sortOrder">{strings.paymentMethods.sortOrder}</Label>
              <Input
                id="sortOrder"
                name="sortOrder"
                type="number"
                defaultValue={paymentMethod?.sortOrder ?? 0}
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="isCashDrawer"
                name="isCashDrawer"
                defaultChecked={paymentMethod?.isCashDrawer ?? false}
              />
              <Label htmlFor="isCashDrawer">{strings.paymentMethods.isCashDrawer}</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="requiresRef"
                name="requiresRef"
                defaultChecked={paymentMethod?.requiresRef ?? false}
              />
              <Label htmlFor="requiresRef">{strings.paymentMethods.requiresRef}</Label>
            </div>
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
