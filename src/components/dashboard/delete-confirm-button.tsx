"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
 * Tombol hapus permanen + dialog konfirmasi, dipakai ulang di semua
 * halaman master data yang punya pengecualian "boleh dihapus kalau belum
 * pernah dipakai" (audit kelengkapan master data) -- categories,
 * modifier-groups, modifiers, price-tiers, payment-methods. Server Action
 * (`onDelete`) SELALU jadi sumber kebenaran soal boleh/tidaknya (cek
 * referensi ada di server dalam transaksi yang sama dengan delete-nya,
 * bukan di sini) -- komponen ini cuma menampilkan pesan error apa adanya
 * kalau server menolak.
 */
export function DeleteConfirmButton({
  onDelete,
  confirmTitle,
  confirmHint,
  successMessage,
  buttonLabel,
}: {
  onDelete: () => Promise<{ error?: string }>;
  confirmTitle: string;
  confirmHint: string;
  successMessage: string;
  buttonLabel: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);

  async function handleConfirm() {
    setIsPending(true);
    try {
      const result = await onDelete();
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(successMessage);
      setOpen(false);
      router.refresh();
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm">{buttonLabel}</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{confirmTitle}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{confirmHint}</p>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            {strings.common.cancel}
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={isPending}>
            {isPending ? strings.common.saving : buttonLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
