import { and, asc, eq } from "drizzle-orm";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { outlets } from "@/lib/db/schema";
import { getStokByCategory } from "@/lib/db/queries/barang-report";
import {
  getBarangMenumpuk,
  getBarangMenumpukDays,
  getStokStatusSummary,
} from "@/lib/pos/thrift-statistik";
import { StockReportView } from "@/components/dashboard/reports/stock-report-view";
import { id as strings } from "@/lib/i18n/id";

/**
 * app/(dashboard)/reports/stock/page.tsx — TT10. Pola sama
 * /reports/sales (T17): requirePermissionDb dulu, ambil daftar outlet,
 * jalankan semua query lewat Promise.all, render presentasi murni.
 *
 * BEDA dari laporan penjualan: ini snapshot stok SEKARANG (bukan
 * rentang tanggal) -- "umur hari" barang cuma berarti sesuatu relatif
 * terhadap hari ini, bukan terhadap periode laporan yang dipilih.
 *
 * Cuma outlet posMode='thrifting' yang relevan -- barang tidak ada
 * untuk outlet F&B.
 */
export default async function StockReportPage({
  searchParams,
}: {
  searchParams: Promise<{ outletId?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "report.sales");

  try {
    const outletRows = await db
      .select({ id: outlets.id, name: outlets.name })
      .from(outlets)
      .where(
        and(
          eq(outlets.businessId, businessId),
          eq(outlets.posMode, "thrifting"),
          eq(outlets.isActive, true)
        )
      )
      .orderBy(asc(outlets.createdAt));

    if (outletRows.length === 0) {
      return (
        <div className="flex flex-col gap-2">
          <h1 className="text-xl font-semibold">{strings.stockReport.title}</h1>
          <p className="text-sm text-muted-foreground">{strings.stockReport.noThriftOutlet}</p>
        </div>
      );
    }

    const selectedOutletId = params.outletId || outletRows[0]!.id;
    const selectedOutlet = outletRows.find((o) => o.id === selectedOutletId) ?? outletRows[0]!;

    const menumpukDays = await getBarangMenumpukDays(db, businessId, selectedOutlet.id);

    const [byCategory, statusSummary, menumpukList] = await Promise.all([
      getStokByCategory(db, businessId, selectedOutlet.id),
      getStokStatusSummary(db, businessId, selectedOutlet.id),
      getBarangMenumpuk(db, businessId, selectedOutlet.id, menumpukDays),
    ]);

    return (
      <StockReportView
        outlets={outletRows}
        selectedOutletId={selectedOutlet.id}
        byCategory={byCategory}
        statusSummary={statusSummary}
        menumpukDays={menumpukDays}
        menumpukList={menumpukList}
      />
    );
  } finally {
    await closeDb();
  }
}
