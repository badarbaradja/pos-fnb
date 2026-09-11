"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setPemilikActive } from "./actions";
import { Button } from "@/components/ui/button";
import { id as strings } from "@/lib/i18n/id";

export function PemilikToggleActiveButton({
  pemilikId,
  isActive,
}: {
  pemilikId: string;
  isActive: boolean;
}) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  async function handleToggle() {
    setIsPending(true);
    try {
      const result = await setPemilikActive(pemilikId, !isActive);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(
        isActive ? strings.pemilik.deactivateSuccess : strings.pemilik.activateSuccess
      );
      router.refresh();
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleToggle} disabled={isPending}>
      {isActive ? strings.pemilik.deactivateButton : strings.pemilik.activateButton}
    </Button>
  );
}
