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
import { SidebarNav, SidebarTopLink } from "@/components/dashboard/sidebar-nav";
import type { NavItem } from "@/lib/dashboard-nav";
import { id } from "@/lib/i18n/id";

// Grouped for the redesigned sidebar/drawer (Phase 2, 18 September 2026) --
// same routes/permissions as before, just labeled + bucketed + iconed.
const navItems: NavItem[] = [
  { href: "/products", label: id.nav.products, icon: "package", group: "catalog" },
  { href: "/categories", label: id.nav.categories, icon: "tags", group: "catalog" },
  { href: "/price-tiers", label: id.nav.priceTiers, icon: "layers", group: "catalog" },
  { href: "/payment-methods", label: id.nav.paymentMethods, icon: "creditCard", group: "catalog" },
  { href: "/modifier-groups", label: id.nav.modifierGroups, icon: "slidersHorizontal", group: "catalog" },
  { href: "/employees", label: id.nav.employees, icon: "users", group: "team" },
  { href: "/devices", label: id.nav.devices, icon: "tablet", group: "team" },
  { href: "/outlets", label: id.nav.outlets, icon: "store", group: "settings" },
  { href: "/team", label: id.nav.team, icon: "shieldCheck", group: "team" },
  { href: "/pemilik", label: id.nav.pemilik, icon: "handCoins", group: "team" },
  { href: "/barang", label: id.nav.barang, icon: "shoppingBag", group: "inventory" },
  { href: "/label-settings", label: id.nav.labelSettings, icon: "tag", group: "settings" },
  { href: "/units", label: id.nav.units, icon: "ruler", group: "inventory" },
  { href: "/ingredients", label: id.nav.ingredients, icon: "wheat", group: "inventory" },
  { href: "/recipes", label: id.nav.recipes, icon: "bookOpen", group: "inventory" },
  { href: "/stock-opnames", label: id.nav.stockOpnames, icon: "clipboardCheck", group: "inventory" },
  { href: "/stock-transfers", label: id.nav.stockTransfers, icon: "arrowLeftRight", group: "inventory" },
  { href: "/reports/sales", label: id.nav.reports, icon: "trendingUp", group: "reports" },
  { href: "/reports/stock", label: id.nav.stockReport, icon: "boxes", group: "reports" },
  { href: "/reports/bagi-hasil", label: id.nav.bagiHasilReport, icon: "pieChart", group: "reports" },
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
    <div className="flex flex-1 flex-col bg-muted/40 lg:flex-row">
      {/* Topbar mobile/tablet (<1024px) -- cuma hamburger, sidebar penuh
          disembunyikan (T18b). Dari lg: ke atas topbar ini hilang total,
          sidebar tetap seperti sebelumnya. */}
      <div className="flex items-center gap-2 border-b bg-sidebar p-3 lg:hidden">
        <MobileNavDrawer
          navItems={navItemsWithBadges}
          appName={id.nav.appName}
          roleLabel={business?.role ?? null}
          logoutAction={logout}
          logoutLabel={id.auth.logout}
        />
        <span className="font-heading font-semibold text-sidebar-foreground">{id.nav.appName}</span>
        <div className="ml-auto">
          <BukaKasirButton destinations={kasirDestinations} />
        </div>
      </div>
      <aside className="hidden w-60 shrink-0 flex-col gap-4 border-r bg-sidebar p-4 lg:flex">
        <div className="flex items-center gap-2 px-1">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary font-heading text-sm font-bold text-primary-foreground">
            {id.nav.appName.charAt(0)}
          </div>
          <div>
            <div className="font-heading text-sm font-semibold text-sidebar-foreground">{id.nav.appName}</div>
            {business ? (
              <div className="text-xs text-muted-foreground capitalize">
                {business.role}
              </div>
            ) : null}
          </div>
        </div>
        <BukaKasirButton destinations={kasirDestinations} className="w-full" />
        <SidebarTopLink href="/" label={id.nav.dashboard} icon="layoutDashboard" />
        <SidebarNav items={navItemsWithBadges} />
        <form action={logout} className="mt-auto border-t border-sidebar-border pt-3">
          <Button type="submit" variant="outline" size="sm" className="w-full">
            {id.auth.logout}
          </Button>
        </form>
      </aside>
      <main className="flex-1 overflow-auto p-4 lg:p-6">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
