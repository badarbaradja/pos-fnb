"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { saveDevice, type DeviceFormState } from "./actions";
import { deviceTypeValues } from "@/lib/devices/manage";
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

const deviceTypeLabels: Record<(typeof deviceTypeValues)[number], string> = {
  pos: strings.devices.typePos,
  waiter: strings.devices.typeWaiter,
  kds: strings.devices.typeKds,
  display: strings.devices.typeDisplay,
};

export type DeviceFormValue = {
  id: string;
  name: string;
  outletId: string;
  serialNumber: string;
  deviceType: (typeof deviceTypeValues)[number];
  isActive: boolean;
};

export type OutletOption = { id: string; name: string };

const initialState: DeviceFormState = {};

export function DeviceFormDialog({
  device,
  outlets,
  trigger,
}: {
  device?: DeviceFormValue;
  outlets: OutletOption[];
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(saveDevice, initialState);

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
              {device ? strings.devices.editTitle : strings.devices.addTitle}
            </DialogTitle>
          </DialogHeader>
          {device ? <input type="hidden" name="id" value={device.id} /> : null}
          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">{strings.devices.name}</Label>
              <Input
                id="name"
                name="name"
                placeholder={strings.devices.namePlaceholder}
                defaultValue={device?.name}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="outletId">{strings.devices.outlet}</Label>
              <select
                id="outletId"
                name="outletId"
                defaultValue={device?.outletId ?? outlets[0]?.id ?? ""}
                required
                className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
              >
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
            {!device ? (
              <>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="serialNumber">{strings.devices.serialNumber}</Label>
                  <Input id="serialNumber" name="serialNumber" required />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="deviceType">{strings.devices.deviceType}</Label>
                  <select
                    id="deviceType"
                    name="deviceType"
                    defaultValue="pos"
                    className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
                  >
                    {deviceTypeValues.map((type) => (
                      <option key={type} value={type}>
                        {deviceTypeLabels[type]}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <Checkbox id="isActive" name="isActive" defaultChecked={device.isActive} />
                <Label htmlFor="isActive" className="text-sm font-normal">
                  {strings.devices.isActive}
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
