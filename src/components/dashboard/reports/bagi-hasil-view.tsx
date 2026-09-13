import { Decimal } from "decimal.js";
import type { BagiHasilLaporanRow } from "@/lib/db/queries/bagi-hasil-report";
import { calculateSisaDibayar } from "@/lib/calc/bagi-hasil-payout";
import { formatIDR } from "@/lib/utils/money";
import { PayoutDialog } from "./payout-dialog";
import { id as strings } from "@/lib/i18n/id";

type OutletOption = {
  id: string;
  name: string;
  dayCutoffTime: string;
  dayCutoffConfirmed: boolean;
};

/**
 * components/dashboard/reports/bagi-hasil-view.tsx — TT11, presentasi
 * murni (data sudah diambil page.tsx). Filter outlet/tanggal lewat
 * navigasi ?outletId=&from=&to= (pola sama /reports/sales), bukan client
 * state -- URL selalu bisa dibagikan/di-bookmark ke periode yang sama.
 */
export function BagiHasilView({
  outlets,
  selectedOutletId,
  dayCutoffTime,
  dayCutoffConfirmed,
  timezoneLabel,
  startDate,
  endDate,
  rows,
}: {
  outlets: OutletOption[];
  selectedOutletId: string;
  dayCutoffTime: string;
  dayCutoffConfirmed: boolean;
  timezoneLabel: string;
  startDate: string;
  endDate: string;
  rows: BagiHasilLaporanRow[];
}) {
  const exportUrl = `/api/reports/bagi-hasil/export?outletId=${selectedOutletId}&from=${startDate}&to=${endDate}`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">{strings.bagiHasil.title}</h1>
        <p className="text-sm text-muted-foreground">{strings.bagiHasil.subtitle}</p>
      </div>

      <form className="flex flex-wrap items-end gap-2">
        {outlets.length > 1 ? (
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground" htmlFor="outletId">
              {strings.bagiHasil.outletLabel}
            </label>
            <select
              id="outletId"
              name="outletId"
              defaultValue={selectedOutletId}
              className="h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm"
            >
              {outlets.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <input type="hidden" name="outletId" value={selectedOutletId} />
        )}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground" htmlFor="from">
            {strings.bagiHasil.startDateLabel}
          </label>
          <input
            id="from"
            name="from"
            type="date"
            defaultValue={startDate}
            className="h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground" htmlFor="to">
            {strings.bagiHasil.endDateLabel}
          </label>
          <input
            id="to"
            name="to"
            type="date"
            defaultValue={endDate}
            className="h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm"
          />
        </div>
        <button
          type="submit"
          className="h-9 rounded-lg border border-input bg-transparent px-3 text-sm hover:bg-muted"
        >
          {strings.common.apply}
        </button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
        <span>
          {strings.bagiHasil.cutoffInfo
            .replace("{cutoff}", dayCutoffTime)
            .replace("{timezone}", timezoneLabel)}
        </span>
        {dayCutoffConfirmed ? (
          <span className="text-xs font-medium text-emerald-600">
            {strings.bagiHasil.cutoffConfirmed}
          </span>
        ) : (
          <span className="text-xs font-medium text-destructive">
            {strings.bagiHasil.cutoffNotConfirmed}
          </span>
        )}
      </div>

      {!dayCutoffConfirmed ? (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {strings.bagiHasil.cutoffWarning}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{strings.bagiHasil.empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="p-2 font-medium">{strings.bagiHasil.colPemilik}</th>
                <th className="p-2 text-right font-medium">{strings.bagiHasil.colDititipkan}</th>
                <th className="p-2 text-right font-medium">{strings.bagiHasil.colTerjual}</th>
                <th className="p-2 text-right font-medium">{strings.bagiHasil.colBelumTerjual}</th>
                <th className="p-2 text-right font-medium">{strings.bagiHasil.colRusak}</th>
                <th className="p-2 text-right font-medium">{strings.bagiHasil.colTotalPenjualan}</th>
                <th className="p-2 text-right font-medium">{strings.bagiHasil.colBagianPemilik}</th>
                <th className="p-2 text-right font-medium">{strings.bagiHasil.colBagianToko}</th>
                <th className="p-2 text-right font-medium">{strings.bagiHasil.colSudahDibayar}</th>
                <th className="p-2 text-right font-medium">{strings.bagiHasil.colSisaDibayar}</th>
                <th className="p-2 text-right font-medium">{strings.bagiHasil.colAksi}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const sisa = calculateSisaDibayar(
                  new Decimal(row.bagianPemilik),
                  new Decimal(row.sudahDibayar)
                );
                return (
                  <tr key={row.pemilikId} className="border-t">
                    <td className="p-2">{row.pemilikNama}</td>
                    <td className="p-2 text-right">{row.dititipkan}</td>
                    <td className="p-2 text-right">{row.terjualKumulatif}</td>
                    <td className="p-2 text-right">{row.belumTerjual}</td>
                    <td className="p-2 text-right">{row.rusak}</td>
                    <td className="p-2 text-right">{formatIDR(new Decimal(row.totalPenjualan))}</td>
                    <td className="p-2 text-right font-medium">
                      {formatIDR(new Decimal(row.bagianPemilik))}
                    </td>
                    <td className="p-2 text-right">{formatIDR(new Decimal(row.bagianToko))}</td>
                    <td className="p-2 text-right">{formatIDR(new Decimal(row.sudahDibayar))}</td>
                    <td
                      className={`p-2 text-right font-medium ${sisa.isNegative() ? "text-destructive" : ""}`}
                    >
                      {formatIDR(sisa)}
                    </td>
                    <td className="p-2 text-right">
                      <PayoutDialog
                        outletId={selectedOutletId}
                        pemilikId={row.pemilikId}
                        pemilikNama={row.pemilikNama}
                        startDate={startDate}
                        endDate={endDate}
                        cutoffConfirmed={dayCutoffConfirmed}
                        bagianPemilik={row.bagianPemilik}
                        sudahDibayar={row.sudahDibayar}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div>
        {dayCutoffConfirmed ? (
          <a
            href={exportUrl}
            className="inline-flex h-9 items-center rounded-lg border border-input bg-transparent px-3 text-sm hover:bg-muted"
          >
            {strings.bagiHasil.exportButton}
          </a>
        ) : (
          <div className="flex flex-col gap-1">
            <button
              type="button"
              disabled
              className="inline-flex h-9 w-fit items-center rounded-lg border border-input bg-transparent px-3 text-sm opacity-50"
            >
              {strings.bagiHasil.exportButton}
            </button>
            <p className="text-xs text-muted-foreground">{strings.bagiHasil.exportLockedHint}</p>
          </div>
        )}
      </div>
    </div>
  );
}
