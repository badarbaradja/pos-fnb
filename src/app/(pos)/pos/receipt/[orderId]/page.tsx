import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { getOrderForReceiptById } from "../get-order-for-receipt";
import { buildReceipt } from "@/lib/printing/receipt-template";
import { ReceiptView } from "@/components/receipt/receipt-view";
import { PrintButton } from "@/components/receipt/print-button";
import { id as strings } from "@/lib/i18n/id";

export default async function ReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ fresh?: string }>;
}) {
  const { orderId } = await params;
  const { fresh } = await searchParams;
  // ?fresh=1 dipasang eksplisit oleh payment-dialog.tsx tepat setelah bayar
  // sukses -- kunjungan lain ke halaman ini (link langsung, dari pencarian
  // nomor struk) dianggap cetak ulang.
  const isReprint = fresh !== "1";

  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "pos.reprint_receipt"
  );

  let orderData;
  try {
    orderData = await getOrderForReceiptById(db, businessId, orderId);
  } finally {
    await closeDb();
  }

  if (!orderData) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-2 p-8 text-center">
        <h1 className="text-lg font-semibold">{strings.receipt.notFoundTitle}</h1>
        <p className="text-sm text-muted-foreground">{strings.receipt.notFoundBody}</p>
      </div>
    );
  }

  const receipt = buildReceipt(orderData, new Date(), isReprint);

  return (
    <div className="flex min-h-dvh flex-col items-center gap-4 bg-muted/30 p-4">
      <div className="print:hidden">
        <PrintButton />
      </div>
      <div className="shadow print:shadow-none">
        <ReceiptView receipt={receipt} />
      </div>
    </div>
  );
}
