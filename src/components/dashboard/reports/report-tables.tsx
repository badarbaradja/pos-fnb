import { Decimal } from "decimal.js";
import type {
  SalesByCashierRow,
  SalesByCategoryRow,
  SalesByChannelRow,
  SalesByHourRow,
  SalesByPaymentMethodRow,
  SalesByProductRow,
} from "@/lib/db/queries/sales-report";
import { formatIDR } from "@/lib/utils/money";
import { getChannelLabel } from "@/lib/pos/channel-labels";
import { id as strings } from "@/lib/i18n/id";

function ReportTable({
  title,
  isEmpty,
  children,
}: {
  title: string;
  isEmpty: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>
      {isEmpty ? (
        <p className="text-sm text-muted-foreground">{strings.reports.empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">{children}</div>
      )}
    </div>
  );
}

export function SalesByProductTable({ rows }: { rows: SalesByProductRow[] }) {
  return (
    <ReportTable title={strings.reports.byProductTitle} isEmpty={rows.length === 0}>
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th className="p-2 font-medium">{strings.reports.colProduct}</th>
            <th className="p-2 text-right font-medium">{strings.reports.colQty}</th>
            <th className="p-2 text-right font-medium">{strings.reports.colValue}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.productId}-${row.productName}`} className="border-t">
              <td className="p-2">{row.productName}</td>
              <td className="p-2 text-right">{new Decimal(row.qty).toString()}</td>
              <td className="p-2 text-right">{formatIDR(new Decimal(row.netAmount))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ReportTable>
  );
}

export function SalesByCategoryTable({ rows }: { rows: SalesByCategoryRow[] }) {
  return (
    <ReportTable title={strings.reports.byCategoryTitle} isEmpty={rows.length === 0}>
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th className="p-2 font-medium">{strings.reports.colCategory}</th>
            <th className="p-2 text-right font-medium">{strings.reports.colQty}</th>
            <th className="p-2 text-right font-medium">{strings.reports.colValue}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.categoryName ?? "__none__"} className="border-t">
              <td className="p-2">{row.categoryName ?? strings.reports.uncategorized}</td>
              <td className="p-2 text-right">{new Decimal(row.qty).toString()}</td>
              <td className="p-2 text-right">{formatIDR(new Decimal(row.netAmount))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ReportTable>
  );
}

export function SalesByCashierTable({ rows }: { rows: SalesByCashierRow[] }) {
  return (
    <ReportTable title={strings.reports.byCashierTitle} isEmpty={rows.length === 0}>
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th className="p-2 font-medium">{strings.reports.colCashier}</th>
            <th className="p-2 text-right font-medium">{strings.reports.colOrderCount}</th>
            <th className="p-2 text-right font-medium">{strings.reports.colValue}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            // Kunci gabungan cashierId+cashierName+index, BUKAN cashierId
            // saja -- akun tamu bersama (TT09b) bisa menghasilkan beberapa
            // baris dengan cashierId SAMA (satu akun) tapi cashierName
            // berbeda (Rani, Dimas, dst dari shift berbeda hari yang sama).
            <tr key={`${row.cashierId ?? "none"}-${row.cashierName ?? "none"}-${index}`} className="border-t">
              <td className="p-2">{row.cashierName ?? strings.reports.unknownCashier}</td>
              <td className="p-2 text-right">{row.orderCount}</td>
              <td className="p-2 text-right">{formatIDR(new Decimal(row.netAmount))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ReportTable>
  );
}

export function SalesByPaymentMethodTable({ rows }: { rows: SalesByPaymentMethodRow[] }) {
  return (
    <ReportTable title={strings.reports.byPaymentMethodTitle} isEmpty={rows.length === 0}>
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th className="p-2 font-medium">{strings.reports.colPaymentMethod}</th>
            <th className="p-2 text-right font-medium">{strings.reports.colAmount}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.methodName} className="border-t">
              <td className="p-2">{row.methodName}</td>
              <td className="p-2 text-right">{formatIDR(new Decimal(row.amount))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ReportTable>
  );
}

export function SalesByChannelTable({ rows }: { rows: SalesByChannelRow[] }) {
  return (
    <ReportTable title={strings.reports.byChannelTitle} isEmpty={rows.length === 0}>
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th className="p-2 font-medium">{strings.reports.colChannel}</th>
            <th className="p-2 text-right font-medium">{strings.reports.colOrderCount}</th>
            <th className="p-2 text-right font-medium">{strings.reports.colValue}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.channel} className="border-t">
              <td className="p-2">{getChannelLabel(row.channel)}</td>
              <td className="p-2 text-right">{row.orderCount}</td>
              <td className="p-2 text-right">{formatIDR(new Decimal(row.netAmount))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ReportTable>
  );
}

export function SalesByHourTable({ rows }: { rows: SalesByHourRow[] }) {
  const maxTotal = rows.reduce(
    (max, r) => Decimal.max(max, new Decimal(r.total)),
    new Decimal(0)
  );

  return (
    <ReportTable title={strings.reports.byHourTitle} isEmpty={rows.length === 0}>
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th className="p-2 font-medium">{strings.reports.colHour}</th>
            <th className="p-2 text-right font-medium">{strings.reports.colOrderCount}</th>
            <th className="p-2 text-right font-medium">{strings.reports.colValue}</th>
            <th className="p-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const total = new Decimal(row.total);
            const barPercent = maxTotal.isZero() ? 0 : total.dividedBy(maxTotal).times(100).toNumber();
            return (
              <tr key={row.hour} className="border-t">
                <td className="p-2">{String(row.hour).padStart(2, "0")}:00</td>
                <td className="p-2 text-right">{row.orderCount}</td>
                <td className="p-2 text-right">{formatIDR(total)}</td>
                <td className="w-32 p-2">
                  <div className="h-2 rounded bg-muted">
                    <div
                      className="h-2 rounded bg-primary"
                      style={{ width: `${barPercent}%` }}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ReportTable>
  );
}
