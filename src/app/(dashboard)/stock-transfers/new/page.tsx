import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { employees, ingredients, outlets } from "@/lib/db/schema";
import { id as strings } from "@/lib/i18n/id";
import { ReceiveStockTransferForm } from "../receive-form";

export default async function NewStockTransferPage() {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "stock.transfer");

  let outletRows;
  let ingredientRows;
  let employeeRows;
  let hasCentralKitchen: boolean;
  try {
    outletRows = await db
      .select({ id: outlets.id, name: outlets.name })
      .from(outlets)
      .where(
        and(eq(outlets.businessId, businessId), eq(outlets.isActive, true), eq(outlets.isCentralKitchen, false))
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
  } finally {
    await closeDb();
  }

  if (!hasCentralKitchen) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">{strings.stockTransfers.receiveTitle}</h1>
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
        <h1 className="text-xl font-semibold">{strings.stockTransfers.receiveTitle}</h1>
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
        <h1 className="text-xl font-semibold">{strings.stockTransfers.receiveTitle}</h1>
        <p className="text-sm text-muted-foreground">{strings.stockTransfers.subtitle}</p>
      </div>
      <ReceiveStockTransferForm outlets={outletRows} ingredients={ingredientOptions} employees={employeeRows} />
    </div>
  );
}
