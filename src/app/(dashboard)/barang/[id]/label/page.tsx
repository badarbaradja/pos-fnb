import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { getLabelSettingsWithDb } from "@/lib/labels/manage";
import { barang, pemilik } from "@/lib/db/schema";
import { LabelView } from "@/components/barang/label-view";
import { PrintButton } from "@/components/receipt/print-button";
import { id as strings } from "@/lib/i18n/id";

export default async function BarangLabelPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "barang.manage");

  try {
    const [row] = await db
      .select({
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

    if (!row) {
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
        <div id="label-print-area" className="border print:border-0">
          <LabelView
            settings={settings}
            barang={{
              kode: row.kode,
              nama: row.nama,
              ukuran: row.ukuran,
              hargaJual: row.hargaJual,
              pemilikKode: row.pemilikKode ?? row.pemilikNama,
            }}
          />
        </div>
        <div className="print:hidden">
          <PrintButton label={strings.barang.printLabelButton} />
        </div>
      </div>
    );
  } finally {
    await closeDb();
  }
}
