import { id as strings } from "@/lib/i18n/id";

/**
 * Placeholder statis -- laba kotor butuh HPP (Fase 2, resep+inventori) dan
 * laba bersih butuh biaya operasional (Fase 3). TIDAK menampilkan Rp0,
 * itu akan terbaca seolah bisnisnya benar-benar tidak untung.
 */
export function ProfitPlaceholder() {
  return (
    <div className="flex h-full flex-col justify-center gap-1 rounded-xl border border-dashed p-4">
      <span className="font-heading text-sm font-semibold text-muted-foreground">
        {strings.dashboardHome.profitTitle}
      </span>
      <span className="text-sm text-muted-foreground">
        {strings.dashboardHome.profitPlaceholder}
      </span>
    </div>
  );
}
