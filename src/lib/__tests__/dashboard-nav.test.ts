/**
 * Filter menu per peran & jenis usaha (24 September 2026) -- test wajib
 * dari instruksi CEO, murni logika (TIDAK butuh DB/Next.js sama sekali,
 * lihat filterNavItemsForViewer di dashboard-nav.ts). Ini TAMPILAN SAJA --
 * tidak menguji requirePermissionDb/RLS, itu tidak disentuh sama sekali.
 */
import { describe, expect, it } from "vitest";
import { filterNavItemsForViewer, type NavItem } from "../dashboard-nav";

const ITEMS: NavItem[] = [
  { href: "/ingredients", label: "Bahan", icon: "wheat", group: "inventory", permission: "product.manage", businessType: "fnb" },
  { href: "/pemilik", label: "Pemilik Titipan", icon: "handCoins", group: "team", permission: "pemilik.manage", businessType: "thrifting" },
  { href: "/team", label: "Tim & Akses", icon: "shieldCheck", group: "team", permission: "membership.manage" },
  { href: "/audit", label: "Laporan Auditor", icon: "clipboardCheck", group: "reports" },
];

function viewer(overrides: Partial<Parameters<typeof filterNavItemsForViewer>[1]>) {
  return {
    hasAccess: true,
    hasPermission: () => true,
    hasFnbOutlet: false,
    hasThriftingOutlet: false,
    canAudit: false,
    ...overrides,
  };
}

describe("filterNavItemsForViewer", () => {
  it("akun HANYA outlet thrifting -- tidak melihat Bahan (fnb-only)", () => {
    const visible = filterNavItemsForViewer(ITEMS, viewer({ hasThriftingOutlet: true, hasFnbOutlet: false }));
    expect(visible.map((i) => i.href)).not.toContain("/ingredients");
    expect(visible.map((i) => i.href)).toContain("/pemilik");
  });

  it("akun HANYA outlet F&B -- tidak melihat Pemilik Titipan (thrifting-only)", () => {
    const visible = filterNavItemsForViewer(ITEMS, viewer({ hasFnbOutlet: true, hasThriftingOutlet: false }));
    expect(visible.map((i) => i.href)).not.toContain("/pemilik");
    expect(visible.map((i) => i.href)).toContain("/ingredients");
  });

  it("akun pegang KEDUA jenis outlet (mis. Ita) -- melihat SEMUANYA, tidak dipaksa pilih salah satu", () => {
    const visible = filterNavItemsForViewer(ITEMS, viewer({ hasFnbOutlet: true, hasThriftingOutlet: true }));
    expect(visible.map((i) => i.href)).toContain("/ingredients");
    expect(visible.map((i) => i.href)).toContain("/pemilik");
  });

  it("owner/akuntan (allowedOutletIds null) -- melihat semuanya, TIDAK dihitung dari outlet yang benar-benar ada", () => {
    // Simulasi caller layout.tsx: allowedOutletIds===null -> hasFnbOutlet
    // dan hasThriftingOutlet SELALU true, apa pun isi outlet bisnisnya.
    const visible = filterNavItemsForViewer(ITEMS, viewer({ hasFnbOutlet: true, hasThriftingOutlet: true }));
    expect(visible.map((i) => i.href).sort()).toEqual(["/ingredients", "/pemilik", "/team"].sort());
  });

  it("tidak punya permission -- item tetap tersembunyi walau jenis usahanya cocok", () => {
    const visible = filterNavItemsForViewer(
      ITEMS,
      viewer({ hasFnbOutlet: true, hasThriftingOutlet: true, hasPermission: () => false })
    );
    expect(visible.map((i) => i.href)).not.toContain("/ingredients");
    expect(visible.map((i) => i.href)).not.toContain("/pemilik");
    expect(visible.map((i) => i.href)).not.toContain("/team");
  });

  it("item bersama (Tim) -- murni izin, tidak peduli jenis usaha sama sekali", () => {
    const visible = filterNavItemsForViewer(
      ITEMS,
      viewer({ hasFnbOutlet: false, hasThriftingOutlet: false, hasPermission: () => true })
    );
    expect(visible.map((i) => i.href)).toContain("/team");
  });

  it("/audit diputuskan lewat canAudit, BUKAN lewat permission/businessType", () => {
    const withoutAudit = filterNavItemsForViewer(ITEMS, viewer({ canAudit: false, hasPermission: () => true }));
    expect(withoutAudit.map((i) => i.href)).not.toContain("/audit");

    const withAudit = filterNavItemsForViewer(ITEMS, viewer({ canAudit: true, hasPermission: () => false }));
    expect(withAudit.map((i) => i.href)).toContain("/audit");
  });

  it("belum login/tidak ada membership aktif (hasAccess=false) -- tidak melihat apa pun kecuali /audit ikut aturannya sendiri", () => {
    const visible = filterNavItemsForViewer(ITEMS, viewer({ hasAccess: false, canAudit: false }));
    expect(visible).toEqual([]);
  });
});
