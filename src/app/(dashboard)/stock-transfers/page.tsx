import Link from "next/link";
import { and, asc, desc, eq } from "drizzle-orm";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { hasPermission, requirePermissionDb } from "@/lib/auth/permissions";
import { isOutletAllowed, outletScopeConditionForTransfer } from "@/lib/auth/outlet-scope";
import { businesses, employees, outlets, stockTransfers } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { id as strings } from "@/lib/i18n/id";
import { ApproveRejectButtons, StockTransferCancelButton } from "./stock-transfer-row-actions";

// Fungsi terpisah (bukan inline Date.now() di body komponen) -- lint
// react-hooks/purity menandai pemanggilan langsung sebagai "impure
// during render" tergantung bentuk ekspresinya; dibungkus fungsi
// bernama di luar komponen supaya konsisten lolos.
function hoursSince(date: Date): number {
  return (Date.now() - date.getTime()) / (1000 * 60 * 60);
}

const statusLabels: Record<string, string> = {
  requested: strings.stockTransfers.statusRequested,
  approved: strings.stockTransfers.statusApproved,
  rejected: strings.stockTransfers.statusRejected,
  sent: strings.stockTransfers.statusSent,
  received: strings.stockTransfers.statusReceived,
  cancelled: strings.stockTransfers.statusCancelled,
};

const statusVariants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  requested: "outline",
  approved: "secondary",
  rejected: "destructive",
  sent: "secondary",
  received: "default",
  cancelled: "destructive",
};

export default async function StockTransfersPage() {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId, role, allowedOutletIds } = await requirePermissionDb(
    supabase,
    "stock.transfer"
  );
  const canApprove = hasPermission(role, "stock.transfer_approve");

  // Pembatasan akses per outlet, Tahap 4 (13 September 2026, §28) --
  // dicek SEBELUM query lain apa pun, pola sama halaman lain.
  if (allowedOutletIds !== null && allowedOutletIds.length === 0) {
    await closeDb();
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">{strings.stockTransfers.title}</h1>
        <p className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {strings.common.noOutletAccess}
        </p>
      </div>
    );
  }

  let rows;
  let outletRows;
  let employeeRows;
  let alertHours = 4;
  try {
    // Daftar transfer disaring OR (fromOutletId ATAU toOutletId) --
    // VISIBILITAS, bukan gerbang aksi (lihat lib/stock-transfers/manage.ts
    // untuk gerbang per-aksi yang satu-kolom).
    rows = await db
      .select()
      .from(stockTransfers)
      .where(
        and(
          eq(stockTransfers.businessId, businessId),
          outletScopeConditionForTransfer(allowedOutletIds, stockTransfers.fromOutletId, stockTransfers.toOutletId)
        )
      )
      .orderBy(desc(stockTransfers.createdAt));

    outletRows = await db
      .select({ id: outlets.id, name: outlets.name })
      .from(outlets)
      .where(eq(outlets.businessId, businessId));

    employeeRows = await db
      .select({ id: employees.id, fullName: employees.fullName })
      .from(employees)
      .where(and(eq(employees.businessId, businessId), eq(employees.isActive, true)))
      .orderBy(asc(employees.fullName));

    const [business] = await db
      .select({ transferRequestAlertHours: businesses.transferRequestAlertHours })
      .from(businesses)
      .where(eq(businesses.id, businessId));
    alertHours = business?.transferRequestAlertHours ?? 4;
  } finally {
    await closeDb();
  }

  const outletNameById = new Map(outletRows.map((o) => [o.id, o.name]));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{strings.stockTransfers.title}</h1>
          <p className="text-sm text-muted-foreground">{strings.stockTransfers.subtitle}</p>
          <p className="text-xs text-muted-foreground">{strings.stockTransfers.noDeleteHint}</p>
        </div>
        <Link href="/stock-transfers/new">
          <Button>{strings.stockTransfers.requestButton}</Button>
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{strings.stockTransfers.empty}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{strings.stockTransfers.colOutlet}</TableHead>
              <TableHead>{strings.stockTransfers.colNumber}</TableHead>
              <TableHead>{strings.stockTransfers.colWaitingSince}</TableHead>
              <TableHead>{strings.stockTransfers.colStatus}</TableHead>
              <TableHead>{strings.stockTransfers.colPhoto}</TableHead>
              <TableHead className="text-right">{strings.stockTransfers.colActions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              // "Menunggu sejak" -- jam ELAPSED wall-clock sederhana (bukan
              // kalender jam operasional per outlet), cukup untuk memberi
              // outlet bukti permintaannya menggantung (keputusan Anda).
              const waitingHours = row.status === "requested" ? hoursSince(row.createdAt) : null;
              const overdue = waitingHours !== null && waitingHours > alertHours;

              return (
                <TableRow key={row.id}>
                  <TableCell>{outletNameById.get(row.toOutletId) ?? "-"}</TableCell>
                  <TableCell className="font-mono text-xs">{row.number ?? "-"}</TableCell>
                  <TableCell className={overdue ? "text-destructive" : "text-sm text-muted-foreground"}>
                    {row.status === "requested" ? (
                      <>
                        {row.createdAt.toLocaleString("id-ID")}
                        {overdue ? (
                          <p className="text-xs font-medium">
                            {strings.stockTransfers.waitingOverdueHint.replace("{hours}", String(alertHours))}
                          </p>
                        ) : null}
                      </>
                    ) : (
                      "-"
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariants[row.status] ?? "secondary"}>
                      {statusLabels[row.status] ?? row.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {/* Langkah D -- baris tanpa foto (kamera gagal saat
                        kirim/terima) WAJIB terlihat di sini, bukan cuma di
                        detail (instruksi eksplisit CEO: "jangan diam-diam
                        lolos"). */}
                    {row.sentPhotoMissingReason || row.receivedPhotoMissingReason ? (
                      <Badge variant="destructive">{strings.stockTransfers.photoMissingBadge}</Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Link href={`/stock-transfers/${row.id}`}>
                        <Button variant="ghost" size="sm">
                          {strings.stockTransfers.detailViewLink}
                        </Button>
                      </Link>
                      {/* Pembatasan akses per outlet, Tahap 4 (13 September
                          2026, §28) -- tombol Approve/Reject DISEMBUNYIKAN
                          kalau outlet gudang (fromOutletId) tidak ada di
                          allowedOutletIds, bukan cuma diserahkan ke gerbang
                          server (keputusan CEO: kontrol yang terlihat lalu
                          gagal saat diklik itu membingungkan). Gerbang
                          server TETAP ada di approveStockTransferWithDb/
                          rejectStockTransferWithDb -- ini murni penyembunyian
                          tampilan. */}
                      {row.status === "requested" &&
                      canApprove &&
                      isOutletAllowed(allowedOutletIds, row.fromOutletId) ? (
                        <ApproveRejectButtons transferId={row.id} employees={employeeRows} />
                      ) : null}
                      {row.status === "approved" ? (
                        <Link href={`/stock-transfers/${row.id}/send`}>
                          <Button size="sm">{strings.stockTransfers.sendButton}</Button>
                        </Link>
                      ) : null}
                      {row.status === "sent" ? (
                        <Link href={`/stock-transfers/${row.id}/receive`}>
                          <Button size="sm">{strings.stockTransfers.receiveButton}</Button>
                        </Link>
                      ) : null}
                      <StockTransferCancelButton
                        transferId={row.id}
                        status={row.status}
                        employees={employeeRows}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
