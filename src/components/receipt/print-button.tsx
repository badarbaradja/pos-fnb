"use client";

import { Button } from "@/components/ui/button";
import { id as strings } from "@/lib/i18n/id";

export function PrintButton({ label }: { label?: string } = {}) {
  return (
    <Button size="lg" onClick={() => window.print()}>
      {label ?? strings.receipt.printButton}
    </Button>
  );
}
