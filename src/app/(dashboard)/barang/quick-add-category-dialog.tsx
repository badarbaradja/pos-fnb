"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveCategory } from "../categories/actions";
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
 * quick-add-category-dialog.tsx — instruksi CEO 11 September 2026: sesi
 * 150 barang tidak boleh terhenti untuk pindah ke /categories cuma untuk
 * menambah satu kategori baru. Cuma minta NAMA -- sortOrder=0 dan
 * scope='thrifting' dikirim tersembunyi (kategori dari layar ini SELALU
 * untuk kasir barang titipan, tidak pernah F&B, lihat categories.scope).
 * Memanggil saveCategory() yang SAMA dipakai /categories, bukan action
 * baru -- satu sumber kebenaran untuk validasi & RLS.
 *
 * SENGAJA TIDAK pakai useActionState+useEffect untuk menutup dialog --
 * "onCreated" dan "setOpen(false)" dipanggil langsung di dalam callback
 * async form action (event handler), bukan di useEffect yang bereaksi ke
 * state (dilarang react-hooks/set-state-in-effect, lihat catatan yang
 * sama di barang-intake-form.tsx).
 */
export function QuickAddCategoryDialog({
  onCreated,
}: {
  onCreated: (id: string, name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    const name = String(formData.get("name") ?? "");
    startTransition(async () => {
      try {
        const result = await saveCategory({}, formData);
        if (result.error) {
          toast.error(result.error);
          return;
        }
        if (result.success) {
          onCreated(result.success.categoryId, name);
          setOpen(false);
        }
      } catch (err) {
        console.error("Tambah kategori gagal:", err);
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
            {strings.barang.addCategoryButton}
          </button>
        }
      />
      <DialogContent>
        <form action={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{strings.barang.addCategoryButton}</DialogTitle>
          </DialogHeader>
          <input type="hidden" name="sortOrder" value="0" />
          <input type="hidden" name="scope" value="thrifting" />
          <div className="flex flex-col gap-2 py-4">
            <Label htmlFor="quick-category-name">{strings.categories.name}</Label>
            <Input id="quick-category-name" name="name" required autoFocus />
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
