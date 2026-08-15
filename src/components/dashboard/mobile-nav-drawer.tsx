"use client";

import { useState } from "react";
import Link from "next/link";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { MenuIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { id as strings } from "@/lib/i18n/id";

type NavItem = { href: string; label: string };

/**
 * Sidebar dashboard jadi drawer hamburger di bawah 1024px (T18b) --
 * dashboard SELALU punya cukup ruang untuk sidebar tetap dari lg: ke atas
 * (beda dari /pos yang breakpoint-nya md:, lihat catatan T18b di
 * docs/04-CATATAN-TEKNIS.md §14). Dialog base-ui di-style ulang jadi
 * drawer dari kiri, SENGAJA bukan pakai DialogContent yang sudah ada
 * (modal tengah layar) supaya dialog lain di app tidak ikut berubah.
 * Drawer tertutup otomatis saat link nav ditekan -- navigasi = ganti
 * halaman = drawer harus hilang, bukan menutupi halaman baru.
 */
export function MobileNavDrawer({
  navItems,
  appName,
  roleLabel,
  logoutAction,
  logoutLabel,
}: {
  navItems: NavItem[];
  appName: string;
  roleLabel: string | null;
  logoutAction: () => Promise<void>;
  logoutLabel: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-11 lg:hidden"
          />
        }
      >
        <MenuIcon />
        <span className="sr-only">{strings.nav.openMenu}</span>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/30 duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 lg:hidden" />
        <DialogPrimitive.Popup className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col gap-4 border-r bg-background p-4 outline-none duration-150 data-open:animate-in data-open:slide-in-from-left data-closed:animate-out data-closed:slide-out-to-left lg:hidden">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold">{appName}</div>
              {roleLabel ? (
                <div className="text-xs text-muted-foreground capitalize">
                  {roleLabel}
                </div>
              ) : null}
            </div>
            <DialogPrimitive.Close
              render={<Button variant="ghost" size="icon-sm" className="size-11" />}
            >
              <XIcon />
              <span className="sr-only">{strings.nav.closeMenu}</span>
            </DialogPrimitive.Close>
          </div>
          <nav className="flex flex-col gap-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="rounded px-2 py-3 text-sm hover:bg-muted"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <form action={logoutAction} className="mt-auto">
            <Button type="submit" variant="outline" size="sm" className="h-11 w-full">
              {logoutLabel}
            </Button>
          </form>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
