import { and, asc, eq } from "drizzle-orm";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { isOutletAllowed } from "@/lib/auth/outlet-scope";
import { outlets } from "@/lib/db/schema";
import { id as strings } from "@/lib/i18n/id";
import { StockOpnameWorkspace } from "./stock-opname-workspace";

export default async function StockOpnamesPage() {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId, allowedOutletIds } = await requirePermissionDb(
    supabase,
    "stock.opname_input"
  );

  let outletOptions;
  try {
    const rows = await db
      .select({ id: outlets.id, name: outlets.name, code: outlets.code })
      .from(outlets)
      .where(and(eq(outlets.businessId, businessId), eq(outlets.isActive, true)))
      .orderBy(asc(outlets.name));
    outletOptions = rows.filter((o) => isOutletAllowed(allowedOutletIds, o.id));
  } finally {
    await closeDb();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">{strings.stockOpnames.title}</h1>
        <p className="text-sm text-muted-foreground">{strings.stockOpnames.subtitle}</p>
      </div>

      {outletOptions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{strings.common.noOutletAccess}</p>
      ) : (
        <StockOpnameWorkspace outletOptions={outletOptions} />
      )}
    </div>
  );
}
