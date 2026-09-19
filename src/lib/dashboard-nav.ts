/**
 * Shared nav-item shape + grouping helper for the dashboard shell (desktop
 * sidebar + mobile drawer) -- UI redesign Phase 2 (18 September 2026,
 * design audit). Previously a single flat 21-link list with no grouping
 * and no active-state highlighting; this keeps the SAME routes/permissions
 * (nothing added or removed here, just labeled + bucketed for display).
 *
 * `icon` is a string KEY, not a Lucide component -- NavItem[] is built in
 * a Server Component (dashboard)/layout.tsx and passed as a prop into
 * Client Components (SidebarNav/MobileNavDrawer). React function
 * components aren't serializable across that boundary ("Only plain
 * objects can be passed..."/"Functions cannot be passed..."). The actual
 * icon components are only resolved client-side, in sidebar-nav.tsx's
 * ICONS registry.
 */
export type NavGroup = "catalog" | "team" | "inventory" | "reports" | "settings";

export type NavIconName =
  | "layoutDashboard"
  | "package"
  | "tags"
  | "layers"
  | "creditCard"
  | "slidersHorizontal"
  | "users"
  | "tablet"
  | "store"
  | "shieldCheck"
  | "handCoins"
  | "shoppingBag"
  | "tag"
  | "ruler"
  | "wheat"
  | "bookOpen"
  | "clipboardCheck"
  | "arrowLeftRight"
  | "trendingUp"
  | "boxes"
  | "pieChart";

export type NavItem = {
  href: string;
  label: string;
  icon: NavIconName;
  group: NavGroup;
  badge?: number;
};

export const NAV_GROUP_ORDER: NavGroup[] = [
  "catalog",
  "inventory",
  "team",
  "reports",
  "settings",
];

export function groupNavItems<T extends { group: NavGroup }>(items: T[]): { group: NavGroup; items: T[] }[] {
  return NAV_GROUP_ORDER.map((group) => ({
    group,
    items: items.filter((item) => item.group === group),
  })).filter((bucket) => bucket.items.length > 0);
}

/** true kalau path saat ini adalah item nav ini ATAU sub-halamannya
 * (mis. /products/123 tetap menyalakan link "Produk"). "/" cuma cocok persis
 * -- kalau tidak, Dashboard akan selalu menyala di semua halaman. */
export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
