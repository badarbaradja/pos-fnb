import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getCurrentBusiness, getSession } from "@/lib/auth/session";
import { logout } from "@/lib/auth/actions";
import { hasPermission } from "@/lib/auth/permissions";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { getUserDb } from "@/lib/db/client";
import { stockTransfers } from "@/lib/db/schema";
import { getKasirDestinationsForUser, type KasirDestination } from "@/lib/pos/kasir-shortcut";
import { Button } from "@/components/ui/button";
import { MobileNavDrawer } from "@/components/dashboard/mobile-nav-drawer";
import { BukaKasirButton } from "@/components/dashboard/buka-kasir-button";
import { id } from "@/lib/i18n/id";

const navItems = [
  { href: "/", label: id.nav.dashboard },
  { href: "/products", label: id.nav.products },
  { href: "/categories", label: id.nav.categories },
  { href: "/price-tiers", label: id.nav.priceTiers },
  { href: "/payment-methods", label: id.nav.paymentMethods },
  { href: "/modifier-groups", label: id.nav.modifierGroups },
  { href: "/employees", label: id.nav.employees },
  { href: "/devices", label: id.nav.devices },
  { href: "/outlets", label: id.nav.outlets },
  { href: "/pemilik", label: id.nav.pemilik },
  { href: "/barang", label: id.nav.barang },
  { href: "/label-settings", label: id.nav.labelSettings },
  { href: "/units", label: id.nav.units },
  { href: "/ingredients", label: id.nav.ingredients },
  { href: "/stock-transfers", label: id.nav.stockTransfers },
  { href: "/reports/sales", label: id.nav.reports },
  { href: "/reports/stock", label: id.nav.stockReport },
  { href: "/reports/bagi-hasil", label: id.nav.bagiHasilReport },
];

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const business = await getCurrentBusiness();

  let pendingTransferCount = 0;
  let kasirDestinations: KasirDestination[] = [];
  if (business) {
    const supabase = await createServerSupabaseClient();
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (accessToken) {
      const { db, close } = await getUserDb(accessToken);
      try {
        // T22 -- badge "permintaan transfer menunggu" di nav, tampil di
        // SETIAP halaman dashboard (bukan cuma saat sudah membuka
        // /stock-transfers) supaya gudang punya alasan membuka dashboard
        // sama sekali, sambil menunggu tahu apakah ini cukup atau perlu
        // notifikasi dorong beneran (T26b, docs/01-TASK-BOARD.md --
        // diputuskan setelah lihat pemakaian nyata). Cuma dihitung untuk
        // yang punya izin approve -- staf lain tidak perlu tahu angka ini.
        if (hasPermission(business.role, "stock.transfer_approve")) {
          const rows = await db
            .select({ id: stockTransfers.id })
            .from(stockTransfers)
            .where(and(eq(stockTransfers.businessId, business.businessId), eq(stockTransfers.status, "requested")));
          pendingTransferCount = rows.length;
        }

        // Tombol "Buka Kasir" (12 September 2026) -- navigasi saja, bukan
        // izin, jadi tidak digerbang permission apa pun -- lihat komentar
        // lib/pos/kasir-shortcut.ts.
        kasirDestinations = await getKasirDestinationsForUser(
          db,
          business.businessId,
          session.userId,
          business.role
        );
      } finally {
        await close();
      }
    }
  }

  const navItemsWithBadges = navItems.map((item) =>
    item.href === "/stock-transfers" && pendingTransferCount > 0
      ? { ...item, badge: pendingTransferCount }
      : item
  );

  return (
    <div className="flex flex-1 flex-col lg:flex-row">
      {/* Topbar mobile/tablet (<1024px) -- cuma hamburger, sidebar penuh
          disembunyikan (T18b). Dari lg: ke atas topbar ini hilang total,
          sidebar tetap seperti sebelumnya. */}
      <div className="flex items-center gap-2 border-b p-3 lg:hidden">
        <MobileNavDrawer
          navItems={navItemsWithBadges}
          appName={id.nav.appName}
          roleLabel={business?.role ?? null}
          logoutAction={logout}
          logoutLabel={id.auth.logout}
        />
        <span className="font-semibold">{id.nav.appName}</span>
        <div className="ml-auto">
          <BukaKasirButton destinations={kasirDestinations} />
        </div>
      </div>
      <aside className="hidden w-56 shrink-0 flex-col gap-4 border-r p-4 lg:flex">
        <div>
          <div className="font-semibold">{id.nav.appName}</div>
          {business ? (
            <div className="text-xs text-muted-foreground capitalize">
              {business.role}
            </div>
          ) : null}
        </div>
        <BukaKasirButton destinations={kasirDestinations} className="w-full" />
        <nav className="flex flex-col gap-1">
          {navItemsWithBadges.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center justify-between rounded px-2 py-1.5 text-sm hover:bg-muted"
            >
              <span>{item.label}</span>
              {"badge" in item && item.badge ? (
                <span className="rounded-full bg-destructive px-1.5 text-xs text-destructive-foreground">
                  {item.badge}
                </span>
              ) : null}
            </Link>
          ))}
        </nav>
        <form action={logout} className="mt-auto">
          <Button type="submit" variant="outline" size="sm" className="w-full">
            {id.auth.logout}
          </Button>
        </form>
      </aside>
      <main className="flex-1 overflow-auto p-6">{children}</main>
    </div>
  );
}
