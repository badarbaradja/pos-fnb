"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboardIcon,
  PackageIcon,
  TagsIcon,
  LayersIcon,
  CreditCardIcon,
  SlidersHorizontalIcon,
  UsersIcon,
  TabletIcon,
  StoreIcon,
  ShieldCheckIcon,
  HandCoinsIcon,
  ShoppingBagIcon,
  TagIcon,
  RulerIcon,
  WheatIcon,
  BookOpenIcon,
  ClipboardCheckIcon,
  ArrowLeftRightIcon,
  TrendingUpIcon,
  BoxesIcon,
  PieChartIcon,
  type LucideIcon,
} from "lucide-react";
import { groupNavItems, isNavItemActive, type NavItem, type NavIconName } from "@/lib/dashboard-nav";
import { id as strings } from "@/lib/i18n/id";

const GROUP_LABEL: Record<string, string> = {
  catalog: strings.nav.groupCatalog,
  team: strings.nav.groupTeam,
  inventory: strings.nav.groupInventory,
  reports: strings.nav.groupReports,
  settings: strings.nav.groupSettings,
};

// Icon components resolved HERE, client-side only -- never passed in as
// props from the Server Component layout (see comment in dashboard-nav.ts).
const ICONS: Record<NavIconName, LucideIcon> = {
  layoutDashboard: LayoutDashboardIcon,
  package: PackageIcon,
  tags: TagsIcon,
  layers: LayersIcon,
  creditCard: CreditCardIcon,
  slidersHorizontal: SlidersHorizontalIcon,
  users: UsersIcon,
  tablet: TabletIcon,
  store: StoreIcon,
  shieldCheck: ShieldCheckIcon,
  handCoins: HandCoinsIcon,
  shoppingBag: ShoppingBagIcon,
  tag: TagIcon,
  ruler: RulerIcon,
  wheat: WheatIcon,
  bookOpen: BookOpenIcon,
  clipboardCheck: ClipboardCheckIcon,
  arrowLeftRight: ArrowLeftRightIcon,
  trendingUp: TrendingUpIcon,
  boxes: BoxesIcon,
  pieChart: PieChartIcon,
};

function NavLink({
  href,
  label,
  icon,
  badge,
  active,
  onClick,
  dense,
}: {
  href: string;
  label: string;
  icon: NavIconName;
  badge?: number;
  active: boolean;
  onClick?: () => void;
  dense?: boolean;
}) {
  const Icon = ICONS[icon];
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`group flex items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors ${dense ? "py-3" : "py-1.5"} ${
        active
          ? "bg-sidebar-primary font-medium text-sidebar-primary-foreground"
          : "text-sidebar-foreground hover:bg-sidebar-accent"
      }`}
    >
      <Icon
        className={`size-4 shrink-0 ${active ? "text-sidebar-primary-foreground" : "text-muted-foreground group-hover:text-sidebar-foreground"}`}
      />
      <span className="flex-1 truncate">{label}</span>
      {badge ? (
        <span className="rounded-full bg-destructive px-1.5 text-xs font-medium text-destructive-foreground">
          {badge}
        </span>
      ) : null}
    </Link>
  );
}

/** Link tunggal di luar pengelompokan (mis. "Ringkasan"/home) -- disematkan
 * di atas nav berkelompok, bukan masuk salah satu grup (bukan konsep
 * "katalog"/"tim"/dst., jadi tidak dipaksa masuk salah satu). */
export function SidebarTopLink({
  href,
  label,
  icon,
  onClick,
  dense,
}: {
  href: string;
  label: string;
  icon: NavIconName;
  onClick?: () => void;
  dense?: boolean;
}) {
  const pathname = usePathname();
  return <NavLink href={href} label={label} icon={icon} active={isNavItemActive(pathname, href)} onClick={onClick} dense={dense} />;
}

/**
 * Desktop sidebar nav (lg: and up) -- UI redesign Phase 2. Replaces the
 * previous flat, icon-less, ungrouped 21-link list: same routes/permissions,
 * now bucketed into labeled sections with icons and a real active state
 * (previously none at all -- `usePathname()` needs a client component,
 * the surrounding layout stays a server component).
 */
export function SidebarNav({ items, onNavigate, dense }: { items: NavItem[]; onNavigate?: () => void; dense?: boolean }) {
  const pathname = usePathname();
  const groups = groupNavItems(items);

  return (
    <nav className="flex flex-col gap-4 overflow-y-auto">
      {groups.map(({ group, items: groupItems }) => (
        <div key={group} className="flex flex-col gap-0.5">
          <p className="px-2.5 pb-1 text-xs font-medium tracking-wide text-muted-foreground/80 uppercase">
            {GROUP_LABEL[group]}
          </p>
          {groupItems.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
              badge={item.badge}
              active={isNavItemActive(pathname, item.href)}
              onClick={onNavigate}
              dense={dense}
            />
          ))}
        </div>
      ))}
    </nav>
  );
}
