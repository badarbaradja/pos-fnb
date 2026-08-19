import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { employees, ingredients, stockTransferItems, stockTransfers } from "@/lib/db/schema";
import { id as strings } from "@/lib/i18n/id";
import { ReceiveStockTransferForm, type ReceiveItemOption } from "../../receive-form";

export default async function ReceiveStockTransferPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: transferId } = await params;
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "stock.transfer");

  let transfer;
  let itemOptions: ReceiveItemOption[];
  let employeeRows;
  try {
    [transfer] = await db
      .select()
      .from(stockTransfers)
      .where(and(eq(stockTransfers.id, transferId), eq(stockTransfers.businessId, businessId)));
    if (!transfer || transfer.status !== "sent") {
      return notFound();
    }

    const itemRows = await db
      .select()
      .from(stockTransferItems)
      .where(eq(stockTransferItems.transferId, transferId));

    const ingredientIds = itemRows.map((i) => i.ingredientId);
    const ingredientRows = ingredientIds.length
      ? await db.select().from(ingredients).where(eq(ingredients.businessId, businessId))
      : [];
    const ingredientById = new Map(ingredientRows.map((i) => [i.id, i]));

    itemOptions = itemRows.map((item) => ({
      itemId: item.id,
      ingredientName: ingredientById.get(item.ingredientId)?.name ?? item.ingredientId,
      sentUnit: item.sentUnit ?? "",
      sentQty: item.sentQty ?? "0",
    }));

    employeeRows = await db
      .select({ id: employees.id, fullName: employees.fullName })
      .from(employees)
      .where(and(eq(employees.businessId, businessId), eq(employees.isActive, true)))
      .orderBy(asc(employees.fullName));
  } finally {
    await closeDb();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">{strings.stockTransfers.receiveTitle}</h1>
      </div>
      <ReceiveStockTransferForm transferId={transferId} items={itemOptions} employees={employeeRows} />
    </div>
  );
}
