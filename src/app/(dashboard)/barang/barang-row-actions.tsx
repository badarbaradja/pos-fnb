"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { setBarangStatus } from "./actions";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { id as strings } from "@/lib/i18n/id";

export function BarangLabelLink({ barangId }: { barangId: string }) {
  return (
    <Link
      href={`/barang/${barangId}/label`}
      target="_blank"
      className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
    >
      {strings.barang.printLabelButton}
    </Link>
  );
}

export function BarangStatusActions({
  barangId,
  status,
}: {
  barangId: string;
  status: "baru_masuk" | "siap_jual" | "terjual" | "rusak";
}) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  async function handleSetStatus(next: "baru_masuk" | "siap_jual" | "rusak") {
    setIsPending(true);
    try {
      const result = await setBarangStatus(barangId, next);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(strings.barang.statusChangedToast);
      router.refresh();
    } catch (err) {
      console.error("Ubah status barang gagal:", err);
      toast.error(err instanceof Error ? err.message : strings.common.unexpectedError);
    } finally {
      setIsPending(false);
    }
  }

  if (status === "terjual") {
    // Barang yang sudah terjual TIDAK PUNYA tombol status sama sekali --
    // satu-satunya jalan status ini terjadi adalah trigger
    // claim_barang_for_sale() saat transaksi sungguhan, tidak bisa ditarik
    // balik lewat halaman ini (lib/barang/manage.ts#setBarangStatusWithDb).
    return <span className="text-xs text-muted-foreground">{strings.barang.soldLocked}</span>;
  }

  return (
    <div className="flex items-center justify-end gap-1">
      {status !== "siap_jual" ? (
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => handleSetStatus("siap_jual")}
        >
          {strings.barang.markReadyButton}
        </Button>
      ) : null}
      {status !== "rusak" ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={isPending}
          onClick={() => handleSetStatus("rusak")}
        >
          {strings.barang.markDamagedButton}
        </Button>
      ) : null}
    </div>
  );
}
