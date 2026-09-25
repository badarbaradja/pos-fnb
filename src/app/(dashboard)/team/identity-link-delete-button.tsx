"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { id as strings } from "@/lib/i18n/id";
import { deleteIdentityLinkAction } from "./actions";

export function IdentityLinkDeleteButton({ id }: { id: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={isPending}
      onClick={() => {
        if (!window.confirm(strings.team.identityLinksDeleteConfirm)) {
          return;
        }
        startTransition(async () => {
          try {
            await deleteIdentityLinkAction(id);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : strings.common.unexpectedError);
          }
        });
      }}
    >
      {strings.common.delete}
    </Button>
  );
}
