"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { savePemilik } from "../pemilik/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { id as strings } from "@/lib/i18n/id";

/**
 * quick-add-pemilik-dialog.tsx — instruksi CEO 11 September 2026, minimal
 * seperti diminta: nama (wajib), kode (boleh kosong). persenBagi dikirim
 * tersembunyi = 60 (bawaan) -- diubah belakangan di halaman /pemilik,
 * bukan di sini. Memanggil savePemilik() yang SAMA dipakai /pemilik.
 *
 * CATATAN PENTING (bukan bug, keputusan RBAC yang sudah ada): pemilik.manage
 * defaultnya OFF untuk role manager (lihat lib/auth/permissions.ts) --
 * tombol ini baru bisa dipakai kalau employee yang login (mis. Ita) sudah
 * diberi izin pemilik.manage lewat permissions_override.
 */
export function QuickAddPemilikDialog({
  onCreated,
}: {
  onCreated: (id: string, nama: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    const nama = String(formData.get("nama") ?? "");
    startTransition(async () => {
      try {
        const result = await savePemilik({}, formData);
        if (result.error) {
          toast.error(result.error);
          return;
        }
        if (result.success) {
          onCreated(result.success.pemilikId, nama);
          setOpen(false);
        }
      } catch (err) {
        console.error("Tambah pemilik gagal:", err);
        toast.error(err instanceof Error ? err.message : strings.common.unexpectedError);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            className="h-9 rounded-lg border border-dashed border-input px-3 text-sm text-muted-foreground hover:bg-accent"
          >
            {strings.barang.addPemilikButton}
          </button>
        }
      />
      <DialogContent>
        <form action={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{strings.barang.addPemilikButton}</DialogTitle>
          </DialogHeader>
          <input type="hidden" name="persenBagi" value="60" />
          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="quick-pemilik-nama">{strings.pemilik.nama}</Label>
              <Input id="quick-pemilik-nama" name="nama" required autoFocus />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="quick-pemilik-kode">{strings.pemilik.kode}</Label>
              <Input id="quick-pemilik-kode" name="kode" />
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
