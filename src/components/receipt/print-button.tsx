"use client";

import { Button } from "@/components/ui/button";
import { id as strings } from "@/lib/i18n/id";

export function PrintButton({
  label,
  disabled,
}: { label?: string; disabled?: boolean } = {}) {
  return (
    <Button size="lg" onClick={() => window.print()} disabled={disabled}>
      {label ?? strings.receipt.printButton}
    </Button>
  );
}
