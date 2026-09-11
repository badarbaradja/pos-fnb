"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setProductActive } from "./actions";
import { Button } from "@/components/ui/button";
import { id as strings } from "@/lib/i18n/id";

export function ProductToggleActiveButton({
  productId,
  isActive,
}: {
  productId: string;
  isActive: boolean;
}) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  async function handleToggle() {
    setIsPending(true);
    try {
      const result = await setProductActive(productId, !isActive);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(
        isActive ? strings.products.deactivateSuccess : strings.products.activateSuccess
      );
      router.refresh();
    } catch (err) {
      console.error("Ubah status aktif produk gagal:", err);
      toast.error(err instanceof Error ? err.message : strings.common.unexpectedError);
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleToggle} disabled={isPending}>
      {isActive ? strings.products.deactivateButton : strings.products.activateButton}
    </Button>
  );
}
