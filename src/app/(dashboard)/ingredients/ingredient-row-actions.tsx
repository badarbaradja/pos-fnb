"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { deleteIngredient, setIngredientActive, setIngredientHitungTiapShift } from "./actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
    } catch (err) {
      console.error("Ubah status aktif bahan gagal:", err);
      toast.error(err instanceof Error ? err.message : strings.common.unexpectedError);
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

/**
 * Rencana Revisi 24 September 2026 §7 poin 4 -- satu kolom centang di
 * halaman Bahan yang sudah ada (bukan halaman baru). Menentukan bahan mana
 * masuk daftar pendek opname 'buka'/'tutup' per shift -- lihat
 * lib/stock-opnames/shift-opname.ts getFlaggedIngredientIds().
 */
export function IngredientHitungTiapShiftCheckbox({
  ingredientId,
  hitungTiapShift,
}: {
  ingredientId: string;
  hitungTiapShift: boolean;
}) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  async function handleChange(checked: boolean) {
    setIsPending(true);
    try {
      const result = await setIngredientHitungTiapShift(ingredientId, checked);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    } catch (err) {
      console.error("Ubah hitung tiap shift gagal:", err);
      toast.error(err instanceof Error ? err.message : strings.common.unexpectedError);
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Checkbox
      checked={hitungTiapShift}
      disabled={isPending}
      onCheckedChange={(c) => handleChange(c === true)}
    />
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
