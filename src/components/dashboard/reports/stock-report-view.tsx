"use client";

import { Decimal } from "decimal.js";
import type { StokByCategoryRow } from "@/lib/db/queries/barang-report";
import type { StokStatusSummary, BarangMenumpukRow } from "@/lib/pos/thrift-statistik";
import { formatIDR } from "@/lib/utils/money";
import { id as strings } from "@/lib/i18n/id";

/**
 * components/dashboard/reports/stock-report-view.tsx — TT10, presentasi
 * murni (semua data sudah diambil page.tsx, sama pola StatistikView).
 * Pemilihan outlet lewat navigasi biasa (?outletId=), bukan client
 * state -- konsisten dengan /reports/sales.
 */
export function StockReportView({
  outlets,
  selectedOutletId,
  byCategory,
  statusSummary,
  menumpukDays,
  menumpukList,
}: {
  outlets: { id: string; name: string }[];
  selectedOutletId: string;
  byCategory: StokByCategoryRow[];
  statusSummary: StokStatusSummary;
  menumpukDays: number;
  menumpukList: BarangMenumpukRow[];
}) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">{strings.stockReport.title}</h1>
        <p className="text-sm text-muted-foreground">{strings.stockReport.subtitle}</p>
      </div>

      {outlets.length > 1 ? (
        <form className="flex items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground" htmlFor="outletId">
              {strings.stockReport.outletLabel}
            </label>
            <select
              id="outletId"
              name="outletId"
              defaultValue={selectedOutletId}
              onChange={(e) => e.currentTarget.form?.requestSubmit()}
              className="h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm"
            >
              {outlets.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
        </form>
      ) : null}

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground">{strings.stockReport.statusTitle}</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatusCard label={strings.statistikIta.stokBaruMasuk} value={statusSummary.baruMasuk} />
          <StatusCard label={strings.statistikIta.stokSiapJual} value={statusSummary.siapJual} />
          <StatusCard label={strings.statistikIta.stokTerjual} value={statusSummary.terjual} />
          <StatusCard label={strings.statistikIta.stokRusak} value={statusSummary.rusak} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground">{strings.stockReport.byCategoryTitle}</h2>
        {byCategory.length === 0 ? (
          <p className="text-sm text-muted-foreground">{strings.stockReport.byCategoryEmpty}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="p-2 font-medium">{strings.stockReport.colCategory}</th>
                  <th className="p-2 text-right font-medium">{strings.statistikIta.stokBaruMasuk}</th>
                  <th className="p-2 text-right font-medium">{strings.statistikIta.stokSiapJual}</th>
                  <th className="p-2 text-right font-medium">{strings.statistikIta.stokTerjual}</th>
                  <th className="p-2 text-right font-medium">{strings.statistikIta.stokRusak}</th>
                  <th className="p-2 text-right font-medium">{strings.stockReport.colTotal}</th>
                </tr>
              </thead>
              <tbody>
                {byCategory.map((row) => (
                  <tr key={row.categoryId ?? "none"} className="border-t">
                    <td className="p-2">{row.categoryName ?? strings.stockReport.categoryNone}</td>
                    <td className="p-2 text-right">{row.baruMasuk}</td>
                    <td className="p-2 text-right">{row.siapJual}</td>
                    <td className="p-2 text-right">{row.terjual}</td>
                    <td className="p-2 text-right">{row.rusak}</td>
                    <td className="p-2 text-right font-medium">{row.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground">
          {strings.stockReport.byAgeTitle.replace("{hari}", String(menumpukDays))}
        </h2>
        <p className="text-xs text-muted-foreground">
          {strings.stockReport.byAgeHint.replace("{hari}", String(menumpukDays))}
        </p>
        {menumpukList.length === 0 ? (
          <p className="text-sm text-muted-foreground">{strings.statistikIta.menumpukEmpty}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="p-2 font-medium">{strings.stockReport.colKode}</th>
                  <th className="p-2 font-medium">{strings.stockReport.colNama}</th>
                  <th className="p-2 text-right font-medium">{strings.stockReport.colUmurHari}</th>
                  <th className="p-2 text-right font-medium">{strings.stockReport.colHargaJual}</th>
                </tr>
              </thead>
              <tbody>
                {menumpukList.map((b) => (
                  <tr key={b.id} className="border-t">
                    <td className="p-2 font-mono text-xs">{b.kode}</td>
                    <td className="p-2">
                      {b.nama}
                      {b.ukuran ? ` · ${b.ukuran}` : ""}
                    </td>
                    <td className="p-2 text-right">{b.umurHari}</td>
                    <td className="p-2 text-right">{formatIDR(new Decimal(b.hargaJual))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-lg border p-3">
      <span className="text-lg font-semibold">{value}</span>
      <span className="text-center text-xs text-muted-foreground">{label}</span>
    </div>
  );
}
