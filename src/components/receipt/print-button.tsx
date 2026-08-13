"use client";

import { Button } from "@/components/ui/button";
import { id as strings } from "@/lib/i18n/id";

export function PrintButton() {
  return (
    <Button size="lg" onClick={() => window.print()}>
      {strings.receipt.printButton}
    </Button>
  );
}
