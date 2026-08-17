"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { deleteIngredient, setIngredientActive } from "./actions";
import { Button } from "@/components/ui/button";
import { DeleteConfirmButton } from "@/components/dashboard/delete-confirm-button";
import { id as strings } from "@/lib/i18n/id";

export function IngredientToggleActiveButton({
  ingredientId,
  isActive,
}: {
  ingredientId: string;
  isActive: boolean;
}) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  async function handleToggle() {
    setIsPending(true);
    try {
      const result = await setIngredientActive(ingredientId, !isActive);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(
        isActive ? strings.ingredients.deactivateSuccess : strings.ingredients.activateSuccess
      );
      router.refresh();
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleToggle} disabled={isPending}>
      {isActive ? strings.ingredients.deactivateButton : strings.ingredients.activateButton}
    </Button>
  );
}

export function IngredientDeleteButton({ ingredientId }: { ingredientId: string }) {
  return (
    <DeleteConfirmButton
      onDelete={() => deleteIngredient(ingredientId)}
      confirmTitle={strings.ingredients.deleteConfirmTitle}
      confirmHint={strings.ingredients.deleteConfirmHint}
      successMessage={strings.ingredients.deleteSuccess}
      buttonLabel={strings.ingredients.deleteButton}
    />
  );
}
