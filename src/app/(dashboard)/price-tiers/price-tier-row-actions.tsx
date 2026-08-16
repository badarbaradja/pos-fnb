"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { deletePriceTier, setPriceTierActive } from "./actions";
import { Button } from "@/components/ui/button";
import { DeleteConfirmButton } from "@/components/dashboard/delete-confirm-button";
import { id as strings } from "@/lib/i18n/id";

export function PriceTierToggleActiveButton({
  priceTierId,
  isActive,
}: {
  priceTierId: string;
  isActive: boolean;
}) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  async function handleToggle() {
    setIsPending(true);
    try {
      const result = await setPriceTierActive(priceTierId, !isActive);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(
        isActive ? strings.priceTiers.deactivateSuccess : strings.priceTiers.activateSuccess
      );
      router.refresh();
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleToggle} disabled={isPending}>
      {isActive ? strings.priceTiers.deactivateButton : strings.priceTiers.activateButton}
    </Button>
  );
}

export function PriceTierDeleteButton({ priceTierId }: { priceTierId: string }) {
  return (
    <DeleteConfirmButton
      onDelete={() => deletePriceTier(priceTierId)}
      confirmTitle={strings.priceTiers.deleteConfirmTitle}
      confirmHint={strings.priceTiers.deleteConfirmHint}
      successMessage={strings.priceTiers.deleteSuccess}
      buttonLabel={strings.priceTiers.deleteButton}
    />
  );
}
