import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { isOutletAllowed } from "@/lib/auth/outlet-scope";
import { getLabelSettingsWithDb } from "@/lib/labels/manage";
import { barang, pemilik } from "@/lib/db/schema";
import { LabelPrintArea } from "@/components/barang/label-print-area";
import { Code128DebugPanel } from "@/components/barcode/code128-debug-panel";
import { id as strings } from "@/lib/i18n/id";

export default async function BarangLabelPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId, allowedOutletIds } = await requirePermissionDb(supabase, "barang.manage");

  try {
    const [row] = await db
      .select({
        outletId: barang.outletId,
        kode: barang.kode,
        nama: barang.nama,
        ukuran: barang.ukuran,
        hargaJual: barang.hargaJual,
        pemilikKode: pemilik.kode,
        pemilikNama: pemilik.nama,
      })
      .from(barang)
      .leftJoin(pemilik, eq(barang.pemilikId, pemilik.id))
      .where(and(eq(barang.id, id), eq(barang.businessId, businessId)));

    // Pembatasan akses per outlet, Tahap 3 (13 September 2026, §24) --
    // diakses langsung lewat URL by-id (bukan lewat daftar yang sudah
    // disaring), jalur PERSIS yang CEO minta diuji ("panggil dengan id
    // outlet lain lewat URL langsung"). notFound() (bukan melempar
    // error) -- konsisten dengan "baris tidak ada" di atas, dan tidak
    // membocorkan bahwa kode ini ADA tapi di luar cakupan.
    if (!row || !isOutletAllowed(allowedOutletIds, row.outletId)) {
      notFound();
    }

    const settings = await getLabelSettingsWithDb(db, businessId);

    return (
      <div className="flex flex-col items-center gap-4 print:block">
        <div className="print:hidden">
          <h1 className="text-lg font-semibold">{strings.labelSettings.printPageTitle}</h1>
          <p className="text-sm text-muted-foreground">{row.kode} — {row.nama}</p>
        </div>
        <style>{`
          @page {
            size: 48mm auto;
            margin: 0;
          }
          @media print {
            body * {
              visibility: hidden;
            }
            #label-print-area,
            #label-print-area * {
              visibility: visible;
            }
            #label-print-area {
              position: absolute;
              top: 0;
              left: 0;
            }
          }
        `}</style>
        <LabelPrintArea
          settings={settings}
          barang={{
            kode: row.kode,
            nama: row.nama,
            ukuran: row.ukuran,
            hargaJual: row.hargaJual,
            pemilikKode: row.pemilikKode ?? row.pemilikNama,
          }}
          printButtonLabel={strings.barang.printLabelButton}
        />
        <div className="print:hidden">
          <Code128DebugPanel kode={row.kode} />
        </div>
      </div>
    );
  } finally {
    await closeDb();
  }
}
