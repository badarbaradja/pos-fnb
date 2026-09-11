"use client";

import Link from "next/link";
import { StoreIcon } from "lucide-react";
import { buttonVariants, Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { id as strings } from "@/lib/i18n/id";
import type { KasirDestination } from "@/lib/pos/kasir-shortcut";

/**
 * components/dashboard/buka-kasir-button.tsx — instruksi CEO 12 September
 * 2026: "jangan disuruh mengetik /pos atau /pos/thrift manual". Satu outlet
 * -> tautan langsung. Beberapa outlet -> menu pilih singkat. Ini navigasi
 * saja -- lihat catatan di lib/pos/kasir-shortcut.ts kenapa bukan lapisan
 * izin.
 */
export function BukaKasirButton({
  destinations,
  className,
}: {
  destinations: KasirDestination[];
  className?: string;
}) {
  if (destinations.length === 0) {
    return null;
  }

  if (destinations.length === 1) {
    const dest = destinations[0]!;
    return (
      <Link
        href={dest.href}
        className={cn(buttonVariants({ variant: "default", size: "sm" }), "gap-1.5", className)}
      >
        <StoreIcon />
        {strings.nav.bukaKasirButton} — {dest.outletName}
      </Link>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="default" size="sm" className={cn("gap-1.5", className)}>
            <StoreIcon />
            {strings.nav.bukaKasirButton}
          </Button>
        }
      />
      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{strings.nav.bukaKasirPilihOutlet}</DropdownMenuLabel>
          {destinations.map((dest) => (
            <DropdownMenuItem key={dest.outletId} render={<Link href={dest.href} />}>
              {dest.outletName}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
