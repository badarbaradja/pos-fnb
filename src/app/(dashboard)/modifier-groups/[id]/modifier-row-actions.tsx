"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { deleteModifier, setModifierActive } from "./actions";
import { Button } from "@/components/ui/button";
import { DeleteConfirmButton } from "@/components/dashboard/delete-confirm-button";
import { id as strings } from "@/lib/i18n/id";

export function ModifierToggleActiveButton({
  modifierId,
  modifierGroupId,
  isActive,
}: {
  modifierId: string;
  modifierGroupId: string;
  isActive: boolean;
}) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  async function handleToggle() {
    setIsPending(true);
    try {
      const result = await setModifierActive(modifierId, modifierGroupId, !isActive);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(
        isActive ? strings.modifiers.deactivateSuccess : strings.modifiers.activateSuccess
      );
      router.refresh();
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleToggle} disabled={isPending}>
      {isActive ? strings.modifiers.deactivateButton : strings.modifiers.activateButton}
    </Button>
  );
}

export function ModifierDeleteButton({
  modifierId,
  modifierGroupId,
}: {
  modifierId: string;
  modifierGroupId: string;
}) {
  return (
    <DeleteConfirmButton
      onDelete={() => deleteModifier(modifierId, modifierGroupId)}
      confirmTitle={strings.modifiers.deleteConfirmTitle}
      confirmHint={strings.modifiers.deleteConfirmHint}
      successMessage={strings.modifiers.deleteSuccess}
      buttonLabel={strings.modifiers.deleteButton}
    />
  );
}
