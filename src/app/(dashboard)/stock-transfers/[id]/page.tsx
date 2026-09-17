import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { isOutletAllowed } from "@/lib/auth/outlet-scope";
import { ingredients, outlets, stockTransferItems, stockTransfers } from "@/lib/db/schema";
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

const statusLabels: Record<string, string> = {
  requested: strings.stockTransfers.statusRequested,
  approved: strings.stockTransfers.statusApproved,
  rejected: strings.stockTransfers.statusRejected,
  sent: strings.stockTransfers.statusSent,
  received: strings.stockTransfers.statusReceived,
  cancelled: strings.stockTransfers.statusCancelled,
};

/** Kolom "Saat Dikirim"/"Saat Diterima" -- foto, tanpa-foto+alasan, atau belum sampai tahap ini. */
function PhotoCell({
  label,
  reachedStage,
  signedUrl,
  missingReason,
}: {
  label: string;
  reachedStage: boolean;
  signedUrl: string | null;
  missingReason: string | null;
}) {
  return (
    <div className="flex flex-1 flex-col gap-2">
      <p className="text-sm font-medium">{label}</p>
      {!reachedStage ? (
        <p className="text-sm text-muted-foreground">{strings.stockTransfers.detailPhotoNotYet}</p>
      ) : signedUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed URL Supabase Storage, bukan aset Next static
        <img src={signedUrl} alt={label} className="w-full max-w-sm rounded-md border object-cover" />
      ) : (
        <div className="rounded-md border border-amber-500/50 bg-amber-500/5 p-3 text-sm">
          <Badge variant="secondary" className="mb-1">
            {strings.stockTransfers.photoMissingBadge}
          </Badge>
          <p>
            {strings.stockTransfers.detailPhotoMissingReasonLabel} {missingReason}
          </p>
        </div>
      )}
    </div>
  );
}

export default async function StockTransferDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: transferId } = await params;
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId, allowedOutletIds } = await requirePermissionDb(
    supabase,
    "stock.transfer"
  );

  let transfer;
  let itemRows;
  let outletNameById: Map<string, string>;
  let sentPhotoUrl: string | null = null;
  let receivedPhotoUrl: string | null = null;
  try {
    [transfer] = await db
      .select()
      .from(stockTransfers)
      .where(and(eq(stockTransfers.id, transferId), eq(stockTransfers.businessId, businessId)));
    if (!transfer) {
      await closeDb();
      return notFound();
    }

    // Visibilitas: siapa pun yang punya akses ke gudang ATAU outlet
    // tujuan boleh lihat detailnya -- pola sama daftar (bukan gerbang
    // aksi, cuma baca).
    if (
      !isOutletAllowed(allowedOutletIds, transfer.fromOutletId) &&
      !isOutletAllowed(allowedOutletIds, transfer.toOutletId)
    ) {
      await closeDb();
      return (
        <div className="flex flex-col gap-4">
          <h1 className="text-xl font-semibold">{strings.stockTransfers.detailTitle}</h1>
          <p className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
            {strings.common.outletAccessDenied}
          </p>
        </div>
      );
    }

    const outletRows = await db
      .select({ id: outlets.id, name: outlets.name })
      .from(outlets)
      .where(eq(outlets.businessId, businessId));
    outletNameById = new Map(outletRows.map((o) => [o.id, o.name]));

    itemRows = await db
      .select({
        id: stockTransferItems.id,
        ingredientName: ingredients.name,
        requestedUnit: stockTransferItems.requestedUnit,
        requestedQty: stockTransferItems.requestedQty,
        sentUnit: stockTransferItems.sentUnit,
        sentQty: stockTransferItems.sentQty,
        receivedQty: stockTransferItems.receivedQty,
      })
      .from(stockTransferItems)
      .innerJoin(ingredients, eq(stockTransferItems.ingredientId, ingredients.id))
      .where(eq(stockTransferItems.transferId, transferId))
      .orderBy(asc(ingredients.name));

    if (transfer.sentPhotoPath) {
      const { data } = await supabase.storage.from("stock-transfers").createSignedUrl(transfer.sentPhotoPath, 3600);
      sentPhotoUrl = data?.signedUrl ?? null;
    }
    if (transfer.receivedPhotoPath) {
      const { data } = await supabase.storage
        .from("stock-transfers")
        .createSignedUrl(transfer.receivedPhotoPath, 3600);
      receivedPhotoUrl = data?.signedUrl ?? null;
    }
  } finally {
    await closeDb();
  }

  const reachedSent = ["sent", "received", "cancelled"].includes(transfer.status) || Boolean(transfer.sentAt);
  const reachedReceived = transfer.status === "received" || Boolean(transfer.receivedAt);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/stock-transfers" className="text-sm text-muted-foreground underline">
          {strings.stockTransfers.detailBackLink}
        </Link>
        <div className="mt-1 flex items-center gap-2">
          <h1 className="text-xl font-semibold">{strings.stockTransfers.detailTitle}</h1>
          <Badge>{statusLabels[transfer.status] ?? transfer.status}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {outletNameById.get(transfer.fromOutletId) ?? "-"} → {outletNameById.get(transfer.toOutletId) ?? "-"}
          {transfer.number ? ` · ${transfer.number}` : ""}
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold">{strings.stockTransfers.detailPhotoSectionTitle}</h2>
        <div className="flex flex-col gap-4 sm:flex-row">
          <PhotoCell
            label={strings.stockTransfers.detailPhotoSendLabel}
            reachedStage={reachedSent}
            signedUrl={sentPhotoUrl}
            missingReason={transfer.sentPhotoMissingReason}
          />
          <PhotoCell
            label={strings.stockTransfers.detailPhotoReceiveLabel}
            reachedStage={reachedReceived}
            signedUrl={receivedPhotoUrl}
            missingReason={transfer.receivedPhotoMissingReason}
          />
        </div>
      </div>

      {itemRows.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{strings.stockTransfers.ingredient}</TableHead>
              <TableHead>{strings.stockTransfers.requestedQtyLabel}</TableHead>
              <TableHead>{strings.stockTransfers.sentQtyLabel}</TableHead>
              <TableHead>{strings.stockTransfers.receivedQtyLabel}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {itemRows.map((item) => (
              <TableRow key={item.id}>
                <TableCell>{item.ingredientName}</TableCell>
                <TableCell>
                  {item.requestedQty} {item.requestedUnit}
                </TableCell>
                <TableCell>{item.sentQty ? `${item.sentQty} ${item.sentUnit ?? ""}` : "-"}</TableCell>
                <TableCell>{item.receivedQty ?? "-"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </div>
  );
}
