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
import type { PermissionKey } from "@/lib/auth/permissions";

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
  // Filter menu per peran & jenis usaha (24 September 2026) -- KEDUANYA
  // TAMPILAN SAJA, gerbang server (requirePermissionDb) dan RLS di
  // halaman itu sendiri TIDAK berubah sama sekali, tetap satu-satunya
  // yang benar-benar menegakkan akses. `permission` opsional -- item
  // seperti /audit punya gerbangnya sendiri (requireAuditAccessDb, bukan
  // PermissionKey), disaring terpisah di (dashboard)/layout.tsx.
  // `businessType` undefined = "bersama" (murni `permission`, tidak
  // disaring jenis usaha sama sekali) -- lihat komentar navItems di
  // layout.tsx untuk pemetaan lengkap tiap item.
  permission?: PermissionKey;
  businessType?: "fnb" | "thrifting";
};

export const NAV_GROUP_ORDER: NavGroup[] = [
  "catalog",
  "inventory",
  "team",
  "reports",
  "settings",
];

/**
 * filterNavItemsForViewer() — logika murni di balik filter menu per peran
 * & jenis usaha (24 September 2026), diekstrak dari (dashboard)/layout.tsx
 * supaya bisa dites TANPA database/Next.js sama sekali. Item `/audit`
 * (tidak punya `permission`) diputuskan lewat `canAudit`, item lain lewat
 * `permission` + `businessType` seperti biasa. KEDUANYA TAMPILAN SAJA --
 * fungsi ini TIDAK PERNAH dipakai untuk memutuskan izin Server Action
 * atau query mana pun, cuma daftar yang muncul di sidebar/drawer.
 */
export function filterNavItemsForViewer<T extends NavItem>(
  items: T[],
  viewer: {
    hasAccess: boolean; // false = belum login/tidak ada membership aktif -- tidak melihat apa pun
    hasPermission: (permission: PermissionKey) => boolean;
    hasFnbOutlet: boolean;
    hasThriftingOutlet: boolean;
    canAudit: boolean;
  }
): T[] {
  return items.filter((item) => {
    if (item.href === "/audit") return viewer.canAudit;
    if (!viewer.hasAccess) return false;
    if (item.permission && !viewer.hasPermission(item.permission)) return false;
    if (item.businessType === "fnb" && !viewer.hasFnbOutlet) return false;
    if (item.businessType === "thrifting" && !viewer.hasThriftingOutlet) return false;
    return true;
  });
}

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
