import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getCurrentBusiness, getSession } from "@/lib/auth/session";
import { logout } from "@/lib/auth/actions";
import { hasPermission } from "@/lib/auth/permissions";
import { outletScopeCondition } from "@/lib/auth/outlet-scope";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { getUserDb } from "@/lib/db/client";
import { outlets, stockTransfers } from "@/lib/db/schema";
import { getKasirDestinationsForUser, type KasirDestination } from "@/lib/pos/kasir-shortcut";
import { Button } from "@/components/ui/button";
import { MobileNavDrawer } from "@/components/dashboard/mobile-nav-drawer";
import { BukaKasirButton } from "@/components/dashboard/buka-kasir-button";
import { SidebarNav, SidebarTopLink } from "@/components/dashboard/sidebar-nav";
import { filterNavItemsForViewer, type NavItem } from "@/lib/dashboard-nav";
import { id } from "@/lib/i18n/id";

// Grouped for the redesigned sidebar/drawer (Phase 2, 18 September 2026) --
// same routes/permissions as before, just labeled + bucketed + iconed.
//
// Filter menu per peran & jenis usaha (24 September 2026) -- `permission`
// dan `businessType` ditambahkan di sini SAMA PERSIS dengan gerbang
// `requirePermissionDb`/`requirePermission` di masing-masing page.tsx
// (diverifikasi satu per satu, bukan ditebak dari nama) -- lihat
// docs/04-CATATAN-TEKNIS.md kalau ada yang tidak cocok kelak, perbarui
// KEDUANYA (page.tsx dan baris ini) supaya tidak diam-diam berbeda lagi.
// `businessType` undefined = "bersama": murni `permission`, TIDAK disaring
// jenis usaha sama sekali.
//
// fnb-only: dipastikan lewat kode (bukan cuma nama) -- /pos/thrift TIDAK
// PERNAH membaca tabel `products`, dan `stock_opname_items`/
// `stock_transfer_items` cuma punya kolom ingredient_id (TIDAK ADA
// barang_id) -- jadi Produk, Tingkat Harga, Grup Modifier, Satuan, Bahan,
// Resep, Stock Opname, DAN Transfer Stok (keputusan CEO 24 September
// 2026 -- schema stock_transfer_items tidak punya barang_id, manajer
// thrifting-only akan melihat menu yang tidak berguna sama sekali kalau
// ini dibiarkan "bersama") murni konsep dapur/resep/gudang bahan F&B.
// thrifting-only: Pemilik Titipan, Barang (TT01, comment permissions.ts),
// Pengaturan Label (subtitle-nya sendiri: "berlaku untuk semua barang
// titipan"), dan Laporan Stok (comment di reports/stock/page.tsx sendiri:
// "Cuma outlet posMode='thrifting' yang relevan -- barang tidak ada untuk
// outlet F&B").
// bersama: Kategori (categories.scope dipakai products.category_id DAN
// barang.category_id), Metode Pembayaran, Karyawan, Perangkat, Outlet,
// Tim, Laporan Penjualan (payOrderWithDb DAN sellBarangWithDb sama-sama
// menulis ke `orders`).
const navItems: NavItem[] = [
  { href: "/products", label: id.nav.products, icon: "package", group: "catalog", permission: "product.manage", businessType: "fnb" },
  { href: "/categories", label: id.nav.categories, icon: "tags", group: "catalog", permission: "product.manage" },
  { href: "/price-tiers", label: id.nav.priceTiers, icon: "layers", group: "catalog", permission: "price.manage", businessType: "fnb" },
  { href: "/payment-methods", label: id.nav.paymentMethods, icon: "creditCard", group: "catalog", permission: "product.manage" },
  { href: "/modifier-groups", label: id.nav.modifierGroups, icon: "slidersHorizontal", group: "catalog", permission: "product.manage", businessType: "fnb" },
  { href: "/employees", label: id.nav.employees, icon: "users", group: "team", permission: "employee.manage" },
  { href: "/devices", label: id.nav.devices, icon: "tablet", group: "team", permission: "employee.manage" },
  { href: "/outlets", label: id.nav.outlets, icon: "store", group: "settings", permission: "outlet.manage" },
  { href: "/team", label: id.nav.team, icon: "shieldCheck", group: "team", permission: "membership.manage" },
  { href: "/pemilik", label: id.nav.pemilik, icon: "handCoins", group: "team", permission: "pemilik.manage", businessType: "thrifting" },
  { href: "/barang", label: id.nav.barang, icon: "shoppingBag", group: "inventory", permission: "barang.manage", businessType: "thrifting" },
  { href: "/label-settings", label: id.nav.labelSettings, icon: "tag", group: "settings", permission: "settings.business", businessType: "thrifting" },
  { href: "/units", label: id.nav.units, icon: "ruler", group: "inventory", permission: "product.manage", businessType: "fnb" },
  { href: "/ingredients", label: id.nav.ingredients, icon: "wheat", group: "inventory", permission: "product.manage", businessType: "fnb" },
  { href: "/recipes", label: id.nav.recipes, icon: "bookOpen", group: "inventory", permission: "product.manage", businessType: "fnb" },
  { href: "/stock-opnames", label: id.nav.stockOpnames, icon: "clipboardCheck", group: "inventory", permission: "stock.opname_input", businessType: "fnb" },
  { href: "/stock-transfers", label: id.nav.stockTransfers, icon: "arrowLeftRight", group: "inventory", permission: "stock.transfer", businessType: "fnb" },
  { href: "/reports/sales", label: id.nav.reports, icon: "trendingUp", group: "reports", permission: "report.sales" },
  { href: "/reports/stock", label: id.nav.stockReport, icon: "boxes", group: "reports", permission: "report.sales", businessType: "thrifting" },
  { href: "/reports/bagi-hasil", label: id.nav.bagiHasilReport, icon: "pieChart", group: "reports", permission: "report.sales", businessType: "thrifting" },
  // /audit TIDAK diberi `permission` -- gerbangnya requireAuditAccessDb
  // (bukan PermissionKey), disaring terpisah lewat `canAudit` di bawah.
  { href: "/audit", label: id.nav.audit, icon: "clipboardCheck", group: "reports" },
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
  // Filter menu per jenis usaha (24 September 2026) -- null = "belum tahu"
  // (dianggap TIDAK terlihat, bukan default tampil, kalau db gagal diambil
  // di bawah -- fail-closed, bukan fail-open, untuk item spesifik jenis
  // usaha). `allowedOutletIds === null` (owner/akuntan) SELALU true untuk
  // keduanya, TIDAK dihitung dari outlet yang benar-benar ada -- instruksi
  // eksplisit CEO ("Owner dan akuntan ... melihat semuanya"), supaya owner
  // tidak diam-diam kehilangan item menu kalau outlet jenis tertentu
  // kebetulan sedang nonaktif semua.
  let hasFnbOutlet = false;
  let hasThriftingOutlet = false;
  if (business) {
    if (business.allowedOutletIds === null) {
      hasFnbOutlet = true;
      hasThriftingOutlet = true;
    }
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

        // Filter menu per jenis usaha -- outlet yang BENAR-BENAR ada DAN
        // ada di allowedOutletIds pemanggil (outletScopeCondition, pola
        // sama SETIAP halaman lain yang menyaring per outlet). Orang yang
        // pegang kedua jenis outlet (mis. Ita) TIDAK dipaksa memilih --
        // keduanya dihitung independen, bukan salah satu.
        if (business.allowedOutletIds !== null) {
          const outletRows = await db
            .select({ posMode: outlets.posMode })
            .from(outlets)
            .where(
              and(
                eq(outlets.businessId, business.businessId),
                eq(outlets.isActive, true),
                outletScopeCondition(business.allowedOutletIds, outlets.id)
              )
            );
          hasFnbOutlet = outletRows.some((o) => o.posMode === "fnb");
          hasThriftingOutlet = outletRows.some((o) => o.posMode === "thrifting");
        }
      } finally {
        await close();
      }
    }
  }

  // Halaman Auditor (24 September 2026) -- disembunyikan dari nav untuk
  // staf yang tidak lolos requireAuditAccess() (lib/audit/access.ts),
  // supaya tidak ada tautan mati ke pesan "tidak punya akses". Ini
  // TIDAK menggantikan gerbang di halaman itu sendiri (nav cuma UX, bukan
  // keamanan) -- kalau seseorang mengetik /audit langsung, halaman itu
  // tetap menolaknya sendiri.
  const canAudit = business
    ? business.role === "owner" || business.role === "accountant" || business.auditAllOutlets
    : false;

  // Filter menu per peran & jenis usaha (24 September 2026, instruksi
  // eksplisit CEO) -- KEDUANYA TAMPILAN SAJA. Gerbang sesungguhnya tetap
  // requirePermissionDb/RLS di masing-masing halaman -- daftar ini cuma
  // menentukan apa yang MUNCUL di sidebar/drawer, TIDAK PERNAH dipakai
  // untuk memutuskan izin di Server Action/query mana pun. Logika murninya
  // ada di lib/dashboard-nav.ts#filterNavItemsForViewer (dites tanpa DB).
  const businessRole = business?.role ?? null;
  const visibleNavItems = filterNavItemsForViewer(navItems, {
    hasAccess: businessRole !== null,
    hasPermission: (permission) => businessRole !== null && hasPermission(businessRole, permission),
    hasFnbOutlet,
    hasThriftingOutlet,
    canAudit,
  });

  const navItemsWithBadges = visibleNavItems.map((item) =>
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
