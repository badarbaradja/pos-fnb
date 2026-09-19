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
    // Satu baris (tier | aksi) baru dari xl -- di bawah itu ditumpuk dua
    // baris supaya chip tier (kontrol utama) tidak terpotong & tombol aksi
    // tidak meluap (verifikasi visual Phase 2A: di 768px tombol paling kanan
    // keluar viewport dan chip "GoFood" tersembunyi).
    <div className="flex shrink-0 flex-col gap-2 border-b bg-card px-3 py-2 shadow-xs sm:px-4 xl:flex-row xl:items-center xl:justify-between min-w-0 max-w-full overflow-hidden">
      <div className="flex min-w-0 items-center gap-2 overflow-hidden">
        <Label className="shrink-0 text-xs font-medium text-muted-foreground">
          {strings.pos.priceTierLabel}
        </Label>
        <div className="flex min-w-0 flex-nowrap items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5">
          {priceTiers.map((tier) => (
            <Button
              key={tier.id}
              type="button"
              size="touch"
              className="shrink-0 rounded-full font-medium"
              variant={value === tier.id ? "default" : "outline"}
              onClick={() => onChange(tier.id)}
            >
              {tier.name}
            </Button>
          ))}
        </div>
      </div>
      {trailing ? (
        <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto scrollbar-none xl:shrink-0">
          {trailing}
        </div>
      ) : null}
    </div>
  );
}
