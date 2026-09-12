"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { confirmDayCutoff } from "./actions";
import { Button } from "@/components/ui/button";
import { id as strings } from "@/lib/i18n/id";

/**
 * TT11 -- tombol konfirmasi dayCutoffTime, dipisah dari OutletFormDialog
 * (satu tindakan sekali klik, tidak perlu buka form penuh). Cuma tampil
 * kalau BELUM dikonfirmasi -- sudah dikonfirmasi cukup tampil badge di
 * page.tsx, tidak perlu tombol lagi.
 */
export function DayCutoffConfirmButton({ outletId }: { outletId: string }) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  async function handleConfirm() {
    setIsPending(true);
    try {
      const result = await confirmDayCutoff(outletId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(strings.outlets.cutoffConfirmedToast);
      router.refresh();
    } catch (err) {
      console.error("Konfirmasi batas hari gagal:", err);
      toast.error(err instanceof Error ? err.message : strings.common.unexpectedError);
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleConfirm} disabled={isPending}>
      {isPending ? strings.common.saving : strings.outlets.confirmCutoffButton}
    </Button>
  );
}
