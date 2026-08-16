import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentBusiness, getSession } from "@/lib/auth/session";
import { logout } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { MobileNavDrawer } from "@/components/dashboard/mobile-nav-drawer";
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
  { href: "/units", label: id.nav.units },
  { href: "/reports/sales", label: id.nav.reports },
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

  return (
    <div className="flex flex-1 flex-col lg:flex-row">
      {/* Topbar mobile/tablet (<1024px) -- cuma hamburger, sidebar penuh
          disembunyikan (T18b). Dari lg: ke atas topbar ini hilang total,
          sidebar tetap seperti sebelumnya. */}
      <div className="flex items-center gap-2 border-b p-3 lg:hidden">
        <MobileNavDrawer
          navItems={navItems}
          appName={id.nav.appName}
          roleLabel={business?.role ?? null}
          logoutAction={logout}
          logoutLabel={id.auth.logout}
        />
        <span className="font-semibold">{id.nav.appName}</span>
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
        <nav className="flex flex-col gap-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded px-2 py-1.5 text-sm hover:bg-muted"
            >
              {item.label}
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
