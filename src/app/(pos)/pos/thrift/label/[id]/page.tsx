import { redirect, notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { getPairedDevice } from "@/lib/pos/device-pairing";
import { getOpenShiftForDevice, isShiftSellable } from "@/lib/pos/shift";
import { getLabelSettingsWithDb } from "@/lib/labels/manage";
import { barang, pemilik } from "@/lib/db/schema";
import { LabelView } from "@/components/barang/label-view";
import { Code128DebugPanel } from "@/components/barcode/code128-debug-panel";
import { PrintButton } from "@/components/receipt/print-button";
import { id as strings } from "@/lib/i18n/id";

/**
 * app/(pos)/pos/thrift/label/[id]/page.tsx — TT05. Cetak label LANGSUNG
 * dari kasir thrifting sesudah "Tambah Barang", tanpa pindah ke dashboard
 * (Ita tidak pernah login dashboard -- gerbang sama persis Statistik Ita
 * dan Tambah Barang: role EMPLOYEE pemilik shift, PIN, bukan
 * requirePermissionDb("barang.manage") yang dipakai versi dashboard di
 * app/(dashboard)/barang/[id]/label/page.tsx).
 */
export default async function ThriftLabelPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "pos.create_order");

  try {
    const paired = await getPairedDevice(db, businessId);
    if (!paired) {
      redirect("/pos/setup");
    }
    if (paired.outlet.posMode === "fnb") {
      redirect("/pos");
    }

    const shift = await getOpenShiftForDevice(db, businessId, paired.device.id);
    if (!shift) {
      redirect("/pos/shift/open");
    }
    if (!isShiftSellable(shift)) {
      redirect("/pos/shift/close");
    }
    if (shift.employeeRole !== "manager" && shift.employeeRole !== "owner") {
      redirect("/pos/thrift");
    }

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
      .where(and(eq(barang.id, id), eq(barang.businessId, businessId), eq(barang.outletId, paired.outlet.id)));

    if (!row) {
      notFound();
    }

    const settings = await getLabelSettingsWithDb(db, businessId);

    return (
      <div className="flex flex-col items-center gap-4 p-4 print:block print:p-0">
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
        <div className="flex gap-2 print:hidden">
          <PrintButton label={strings.barang.printLabelButton} />
          <a href="/pos/thrift" className="text-sm text-muted-foreground hover:underline self-center">
            {strings.statistikIta.backToKasir}
          </a>
        </div>
        <div className="print:hidden">
          <Code128DebugPanel kode={row.kode} />
        </div>
      </div>
    );
  } finally {
    await closeDb();
  }
}
