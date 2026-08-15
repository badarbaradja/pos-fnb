"use client";

import { createPortal } from "react-dom";
import { Decimal } from "decimal.js";
import { formatIDR } from "@/lib/utils/money";
import { useIsClient } from "@/lib/hooks/use-is-client";
import { id as strings } from "@/lib/i18n/id";

/**
 * Bar melayang mobile-only (T18b) -- tampil kalau keranjang tidak kosong,
 * tap membuka MobileCartSheet. Diportal ke document.body sama alasannya
 * dengan footer CartPanel (lihat komentar di cart-panel.tsx) -- elemen
 * fixed apa pun di pohon pos-screen sebaiknya lepas dari kemungkinan
 * containing block leluhur yang belum ketemu.
 */
export function MobileCartBar({
  itemCount,
  total,
  onOpen,
}: {
  itemCount: Decimal;
  total: Decimal;
  onOpen: () => void;
}) {
  const isClient = useIsClient();
  if (!isClient || itemCount.isZero()) {
    return null;
  }

  return createPortal(
    <button
      type="button"
      onClick={onOpen}
      // h-14 (56px) -- jauh di atas target sentuh 44px (T18b), seluruh
      // bar bisa di-tap, bukan cuma sebagian.
      className="fixed inset-x-0 bottom-0 z-40 flex h-14 items-center justify-between gap-3 bg-primary px-4 text-primary-foreground md:hidden"
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-primary-foreground/20 px-1.5 text-xs font-semibold">
          {itemCount.toString()}
        </span>
        {strings.pos.viewCartButton}
      </span>
      <span className="font-semibold">{formatIDR(total)}</span>
    </button>,
    document.body
  );
}
