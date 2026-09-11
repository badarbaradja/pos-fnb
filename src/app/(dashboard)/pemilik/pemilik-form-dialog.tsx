"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { savePemilik, type PemilikFormState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { id as strings } from "@/lib/i18n/id";

export type PemilikFormValue = {
  id: string;
  kode: string | null;
  nama: string;
  kontak: string | null;
  persenBagi: string;
  catatan: string | null;
};

const initialState: PemilikFormState = {};

export function PemilikFormDialog({
  pemilik,
  trigger,
}: {
  pemilik?: PemilikFormValue;
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(savePemilik, initialState);

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
              {pemilik ? strings.pemilik.editTitle : strings.pemilik.addTitle}
            </DialogTitle>
          </DialogHeader>
          {pemilik ? <input type="hidden" name="id" value={pemilik.id} /> : null}
          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="nama">{strings.pemilik.nama}</Label>
              <Input id="nama" name="nama" defaultValue={pemilik?.nama} required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="kode">{strings.pemilik.kode}</Label>
              <Input id="kode" name="kode" defaultValue={pemilik?.kode ?? ""} />
              <p className="text-xs text-muted-foreground">{strings.pemilik.kodeHint}</p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="kontak">{strings.pemilik.kontak}</Label>
              <Input id="kontak" name="kontak" defaultValue={pemilik?.kontak ?? ""} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="persenBagi">{strings.pemilik.persenBagi}</Label>
              <Input
                id="persenBagi"
                name="persenBagi"
                type="number"
                min={0}
                max={100}
                step="0.01"
                defaultValue={pemilik?.persenBagi ?? "60"}
                required
              />
              <p className="text-xs text-muted-foreground">{strings.pemilik.persenBagiHint}</p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="catatan">{strings.pemilik.catatan}</Label>
              <Textarea id="catatan" name="catatan" defaultValue={pemilik?.catatan ?? ""} />
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
