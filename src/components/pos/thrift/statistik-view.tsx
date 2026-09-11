import Link from "next/link";
import { Decimal } from "decimal.js";
import type { SalesSummary, SalesByProductRow } from "@/lib/db/queries/sales-report";
import type {
  StokStatusSummary,
  BarangMenumpukRow,
  BagiHasilPemilikRow,
} from "@/lib/pos/thrift-statistik";
import { formatIDR } from "@/lib/utils/money";
import { id as strings } from "@/lib/i18n/id";

/**
 * components/pos/thrift/statistik-view.tsx — "Halaman Statistik Ita" (11
 * September 2026). Presentasi murni -- semua data sudah diambil
 * page.tsx, komponen ini tidak query apa pun sendiri.
 */
export function StatistikView({
  outletName,
  todaySummary,
  monthSummary,
  topItems,
  stokStatus,
  barangMenumpuk,
  bagiHasil,
}: {
  outletName: string;
  todaySummary: SalesSummary;
  monthSummary: SalesSummary;
  topItems: SalesByProductRow[];
  stokStatus: StokStatusSummary;
  barangMenumpuk: BarangMenumpukRow[];
  bagiHasil: BagiHasilPemilikRow[];
}) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">
          {strings.statistikIta.title.replace("{outlet}", outletName)}
        </h1>
        <Link href="/pos/thrift" className="text-sm text-muted-foreground hover:underline">
          {strings.statistikIta.backToKasir}
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1 rounded-lg border p-4">
          <span className="text-xs text-muted-foreground">{strings.statistikIta.omzetHariIni}</span>
          <span className="text-2xl font-semibold">{formatIDR(new Decimal(todaySummary.netSales))}</span>
          <span className="text-xs text-muted-foreground">{todaySummary.orderCount} transaksi</span>
        </div>
        <div className="flex flex-col gap-1 rounded-lg border p-4">
          <span className="text-xs text-muted-foreground">{strings.statistikIta.omzetBulanIni}</span>
          <span className="text-2xl font-semibold">{formatIDR(new Decimal(monthSummary.netSales))}</span>
          <span className="text-xs text-muted-foreground">{monthSummary.orderCount} transaksi</span>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground">{strings.statistikIta.stokStatusTitle}</h2>
        <div className="grid grid-cols-4 gap-2">
          <StokCard label={strings.statistikIta.stokBaruMasuk} value={stokStatus.baruMasuk} />
          <StokCard label={strings.statistikIta.stokSiapJual} value={stokStatus.siapJual} />
          <StokCard label={strings.statistikIta.stokTerjual} value={stokStatus.terjual} />
          <StokCard label={strings.statistikIta.stokRusak} value={stokStatus.rusak} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground">{strings.statistikIta.topItemsTitle}</h2>
        {topItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">{strings.statistikIta.topItemsEmpty}</p>
        ) : (
          <div className="flex flex-col gap-1 rounded-lg border p-3">
            {topItems.map((item, i) => (
              <div key={item.productId ?? item.productName} className="flex items-center justify-between text-sm">
                <span>
                  {i + 1}. {item.productName}
                </span>
                <span className="font-medium">{formatIDR(new Decimal(item.netAmount))}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground">{strings.statistikIta.menumpukTitle}</h2>
        {barangMenumpuk.length === 0 ? (
          <p className="text-sm text-muted-foreground">{strings.statistikIta.menumpukEmpty}</p>
        ) : (
          <div className="flex flex-col gap-1 rounded-lg border p-3">
            {barangMenumpuk.map((b) => (
              <div key={b.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex flex-col">
                  <span>
                    {b.nama}
                    {b.ukuran ? ` · ${b.ukuran}` : ""}
                    {b.warna ? ` · ${b.warna}` : ""}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {b.kode} {b.pemilikNama ? `· ${b.pemilikNama}` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-medium">
                    {strings.statistikIta.menumpukUmurHari.replace("{hari}", String(b.umurHari))}
                  </span>
                  <span className="block text-xs text-muted-foreground">{formatIDR(new Decimal(b.hargaJual))}</span>
                </span>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">{strings.statistikIta.menumpukHint}</p>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground">{strings.statistikIta.bagiHasilTitle}</h2>
        {bagiHasil.length === 0 ? (
          <p className="text-sm text-muted-foreground">{strings.statistikIta.bagiHasilEmpty}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="p-2 font-medium">{strings.statistikIta.bagiHasilColPemilik}</th>
                  <th className="p-2 text-right font-medium">{strings.statistikIta.bagiHasilColJumlah}</th>
                  <th className="p-2 text-right font-medium">{strings.statistikIta.bagiHasilColTotal}</th>
                  <th className="p-2 text-right font-medium">{strings.statistikIta.bagiHasilColPemilikShare}</th>
                  <th className="p-2 text-right font-medium">{strings.statistikIta.bagiHasilColTokoShare}</th>
                </tr>
              </thead>
              <tbody>
                {bagiHasil.map((row) => (
                  <tr key={row.pemilikId ?? "toko"} className="border-t">
                    <td className="p-2">{row.pemilikNama}</td>
                    <td className="p-2 text-right">{row.jumlahTerjual}</td>
                    <td className="p-2 text-right">{formatIDR(new Decimal(row.totalPenjualan))}</td>
                    <td className="p-2 text-right">{formatIDR(new Decimal(row.pemilikShareAmount))}</td>
                    <td className="p-2 text-right">{formatIDR(new Decimal(row.tokoShareAmount))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">{strings.statistikIta.bagiHasilHint}</p>
      </div>
    </div>
  );
}

function StokCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-lg border p-3">
      <span className="text-lg font-semibold">{value}</span>
      <span className="text-center text-xs text-muted-foreground">{label}</span>
    </div>
  );
}
