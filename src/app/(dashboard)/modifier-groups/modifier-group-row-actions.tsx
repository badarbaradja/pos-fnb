"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { deleteModifierGroup, setModifierGroupActive } from "./actions";
import { Button } from "@/components/ui/button";
import { DeleteConfirmButton } from "@/components/dashboard/delete-confirm-button";
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

export function ModifierGroupDeleteButton({ modifierGroupId }: { modifierGroupId: string }) {
  return (
    <DeleteConfirmButton
      onDelete={() => deleteModifierGroup(modifierGroupId)}
      confirmTitle={strings.modifierGroups.deleteConfirmTitle}
      confirmHint={strings.modifierGroups.deleteConfirmHint}
      successMessage={strings.modifierGroups.deleteSuccess}
      buttonLabel={strings.modifierGroups.deleteButton}
    />
  );
}
