"use client";

import type { PosPriceTier } from "@/app/(pos)/pos/get-pos-catalog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { id as strings } from "@/lib/i18n/id";

export function PriceTierSelector({
  priceTiers,
  value,
  onChange,
  trailing,
}: {
  priceTiers: PosPriceTier[];
  value: string;
  onChange: (priceTierId: string) => void;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 border-b p-3">
      <Label className="text-xs text-muted-foreground">
        {strings.pos.priceTierLabel}
      </Label>
      <div className="flex flex-wrap gap-2">
        {priceTiers.map((tier) => (
          <Button
            key={tier.id}
            type="button"
            size="sm"
            variant={value === tier.id ? "default" : "outline"}
            onClick={() => onChange(tier.id)}
          >
            {tier.name}
          </Button>
        ))}
      </div>
      {trailing ? <div className="ml-auto flex items-center">{trailing}</div> : null}
    </div>
  );
}
