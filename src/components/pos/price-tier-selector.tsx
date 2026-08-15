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
    // flex-col di mobile (trailing/shift-info pindah ke baris kedua supaya
    // tidak berdesakan dengan tier yang sudah scroll horizontal), flex-row
    // dari md ke atas -- semua satu baris seperti sebelumnya (T18b).
    <div className="flex flex-col gap-2 border-b p-3 md:flex-row md:items-center md:gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <Label className="shrink-0 text-xs text-muted-foreground">
          {strings.pos.priceTierLabel}
        </Label>
        {/* flex-nowrap + overflow-x-auto -- TIDAK PERNAH menumpuk ke banyak
            baris, di semua breakpoint (T18b). Sebelumnya flex-wrap makan
            3 baris dengan 15 kategori/tier, menyita ruang grid produk. */}
        <div className="flex flex-nowrap gap-2 overflow-x-auto">
          {priceTiers.map((tier) => (
            <Button
              key={tier.id}
              type="button"
              size="sm"
              className="h-11"
              variant={value === tier.id ? "default" : "outline"}
              onClick={() => onChange(tier.id)}
            >
              {tier.name}
            </Button>
          ))}
        </div>
      </div>
      {trailing ? (
        <div className="flex items-center gap-2 overflow-x-auto md:ml-auto">
          {trailing}
        </div>
      ) : null}
    </div>
  );
}
