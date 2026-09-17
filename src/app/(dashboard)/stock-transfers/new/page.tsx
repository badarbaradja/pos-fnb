import Link from "next/link";
import { and, asc, eq, inArray } from "drizzle-orm";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { outletScopeCondition } from "@/lib/auth/outlet-scope";
import { employees, ingredients, outlets, stockLevels } from "@/lib/db/schema";
import { getLastRequestForOutlet } from "@/lib/stock-transfers/manage";
import { id as strings } from "@/lib/i18n/id";
import { RequestStockTransferForm, type LastRequestLine } from "../request-form";

export default async function NewStockTransferPage() {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId, allowedOutletIds } = await requirePermissionDb(supabase, "stock.transfer");

  // Pembatasan akses per outlet, Tahap 4 (13 September 2026, §28) --
  // dicek SEBELUM query lain apa pun.
  if (allowedOutletIds !== null && allowedOutletIds.length === 0) {
    await closeDb();
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">{strings.stockTransfers.requestTitle}</h1>
        <p className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {strings.common.noOutletAccess}
        </p>
      </div>
    );
  }

  let outletRows;
  let ingredientRows;
  let employeeRows;
  let hasCentralKitchen: boolean;
  const centralKitchenStock: Record<string, string> = {};
  const outletStockByOutlet: Record<string, Record<string, string>> = {};
  const lastRequestByOutlet: Record<string, LastRequestLine[]> = {};
  try {
    // Dropdown "outlet peminta" TIDAK PERNAH menampilkan outlet di luar
    // cakupan (pola sama halaman Tahap 3 lain) -- lubang ini SUDAH
    // terbuka hari ini sebelum perbaikan ini (dicatat di plan doc §28).
    outletRows = await db
      .select({ id: outlets.id, name: outlets.name })
      .from(outlets)
      .where(
        and(
          eq(outlets.businessId, businessId),
          eq(outlets.isActive, true),
          eq(outlets.isCentralKitchen, false),
          outletScopeCondition(allowedOutletIds, outlets.id)
        )
      )
      .orderBy(asc(outlets.name));

    const [centralKitchen] = await db
      .select({ id: outlets.id })
      .from(outlets)
      .where(and(eq(outlets.businessId, businessId), eq(outlets.isCentralKitchen, true)));
    hasCentralKitchen = Boolean(centralKitchen);

    ingredientRows = await db
      .select()
      .from(ingredients)
      .where(and(eq(ingredients.businessId, businessId), eq(ingredients.isActive, true)))
      .orderBy(asc(ingredients.name));

    employeeRows = await db
      .select({ id: employees.id, fullName: employees.fullName })
      .from(employees)
      .where(and(eq(employees.businessId, businessId), eq(employees.isActive, true)))
      .orderBy(asc(employees.fullName));

    // Stok gudang pusat + stok tiap outlet peminta ditampilkan bersamaan di
    // form (instruksi CEO 16 September 2026): kasir yang tahu gudang cuma
    // punya 3 liter tidak akan mengetik 10 liter lalu menunggu ditolak Ita.
    // Ini MURNI informasi -- tidak pernah memblokir pengajuan (§4 alasan
    // yang sama seperti stok minus tidak memblokir penjualan).
    const outletIdsForStock = [...outletRows.map((o) => o.id), ...(centralKitchen ? [centralKitchen.id] : [])];
    const stockRows = outletIdsForStock.length
      ? await db
          .select({
            outletId: stockLevels.outletId,
            ingredientId: stockLevels.ingredientId,
            qtyOnHand: stockLevels.qtyOnHand,
          })
          .from(stockLevels)
          .where(
            and(eq(stockLevels.businessId, businessId), inArray(stockLevels.outletId, outletIdsForStock))
          )
      : [];
    for (const row of stockRows) {
      if (centralKitchen && row.outletId === centralKitchen.id) {
        centralKitchenStock[row.ingredientId] = row.qtyOnHand;
      } else {
        (outletStockByOutlet[row.outletId] ??= {})[row.ingredientId] = row.qtyOnHand;
      }
    }

    for (const outlet of outletRows) {
      lastRequestByOutlet[outlet.id] = await getLastRequestForOutlet(db, businessId, allowedOutletIds, outlet.id);
    }
  } finally {
    await closeDb();
  }

  if (!hasCentralKitchen) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">{strings.stockTransfers.requestTitle}</h1>
        <p className="text-sm text-destructive">{strings.stockTransfers.noCentralKitchenError}</p>
      </div>
    );
  }

  if (outletRows.length === 0 || ingredientRows.length === 0 || employeeRows.length === 0) {
    const message =
      outletRows.length === 0
        ? strings.stockTransfers.noRetailOutletError
        : ingredientRows.length === 0
          ? strings.ingredients.empty
          : strings.employees.empty;
    const linkHref = ingredientRows.length === 0 ? "/ingredients" : "/employees";
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">{strings.stockTransfers.requestTitle}</h1>
        <p className="text-sm text-muted-foreground">
          {message}{" "}
          {outletRows.length === 0 ? null : (
            <Link href={linkHref} className="underline">
              {strings.ingredients.goToUnits}
            </Link>
          )}
        </p>
      </div>
    );
  }

  const ingredientOptions = ingredientRows.map((i) => ({
    id: i.id,
    name: i.name,
    baseUnit: i.baseUnit,
    purchaseUnit: i.purchaseUnit,
    purchaseFactor: i.purchaseFactor,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">{strings.stockTransfers.requestTitle}</h1>
        <p className="text-sm text-muted-foreground">{strings.stockTransfers.subtitle}</p>
      </div>
      <RequestStockTransferForm
        outlets={outletRows}
        ingredients={ingredientOptions}
        employees={employeeRows}
        lastRequestByOutlet={lastRequestByOutlet}
        centralKitchenStock={centralKitchenStock}
        outletStockByOutlet={outletStockByOutlet}
      />
    </div>
  );
}
