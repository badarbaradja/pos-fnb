"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { deleteCategory, setCategoryActive } from "./actions";
import { Button } from "@/components/ui/button";
import { DeleteConfirmButton } from "@/components/dashboard/delete-confirm-button";
import { id as strings } from "@/lib/i18n/id";

export function CategoryToggleActiveButton({
  categoryId,
  isActive,
}: {
  categoryId: string;
  isActive: boolean;
}) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  async function handleToggle() {
    setIsPending(true);
    try {
      const result = await setCategoryActive(categoryId, !isActive);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(
        isActive ? strings.categories.deactivateSuccess : strings.categories.activateSuccess
      );
      router.refresh();
    } catch (err) {
      console.error("Ubah status aktif kategori gagal:", err);
      toast.error(err instanceof Error ? err.message : strings.common.unexpectedError);
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleToggle} disabled={isPending}>
      {isActive ? strings.categories.deactivateButton : strings.categories.activateButton}
    </Button>
  );
}

export function CategoryDeleteButton({ categoryId }: { categoryId: string }) {
  return (
    <DeleteConfirmButton
      onDelete={() => deleteCategory(categoryId)}
      confirmTitle={strings.categories.deleteConfirmTitle}
      confirmHint={strings.categories.deleteConfirmHint}
      successMessage={strings.categories.deleteSuccess}
      buttonLabel={strings.categories.deleteButton}
    />
  );
}
