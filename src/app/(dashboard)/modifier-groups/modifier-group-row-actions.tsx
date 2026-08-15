"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setModifierGroupActive } from "./actions";
import { Button } from "@/components/ui/button";
import { id as strings } from "@/lib/i18n/id";

export function ModifierGroupToggleActiveButton({
  modifierGroupId,
  isActive,
}: {
  modifierGroupId: string;
  isActive: boolean;
}) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  async function handleToggle() {
    setIsPending(true);
    try {
      const result = await setModifierGroupActive(modifierGroupId, !isActive);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(
        isActive
          ? strings.modifierGroups.deactivateSuccess
          : strings.modifierGroups.activateSuccess
      );
      router.refresh();
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleToggle} disabled={isPending}>
      {isActive
        ? strings.modifierGroups.deactivateButton
        : strings.modifierGroups.activateButton}
    </Button>
  );
}
