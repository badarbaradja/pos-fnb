import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { categories, priceTiers, modifierGroups, brands, outlets } from "@/lib/db/schema";
import { id as strings } from "@/lib/i18n/id";
import { ProductForm } from "../product-form";

export default async function NewProductPage() {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "product.manage"
  );

  let categoryRows, priceTierRows, modifierGroupRows, brandRows, outletRows;
  try {
    [categoryRows, priceTierRows, modifierGroupRows, brandRows, outletRows] = await Promise.all([
      db
        .select({ id: categories.id, name: categories.name })
        .from(categories)
        .where(eq(categories.businessId, businessId))
        .orderBy(asc(categories.sortOrder), asc(categories.name)),
      db
        .select({ id: priceTiers.id, code: priceTiers.code, name: priceTiers.name })
        .from(priceTiers)
        .where(eq(priceTiers.businessId, businessId))
        .orderBy(asc(priceTiers.code)),
      db
        .select({ id: modifierGroups.id, name: modifierGroups.name })
        .from(modifierGroups)
        .where(eq(modifierGroups.businessId, businessId))
        .orderBy(asc(modifierGroups.name)),
      db
        .select({ id: brands.id, name: brands.name })
        .from(brands)
        .where(eq(brands.businessId, businessId))
        .orderBy(asc(brands.name)),
      db
        .select({ id: outlets.id, name: outlets.name })
        .from(outlets)
        .where(eq(outlets.businessId, businessId))
        .orderBy(asc(outlets.createdAt)),
    ]);
  } finally {
    await closeDb();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/products"
          className="text-sm text-muted-foreground hover:underline"
        >
          {"< "}
          {strings.products.backToProducts}
        </Link>
      </div>
      <h1 className="text-xl font-semibold">{strings.products.addTitle}</h1>
      <ProductForm
        currentImageUrl={null}
        initialVariants={[]}
        initialPrices={{}}
        assignedModifierGroupIds={[]}
        assignedOutletIds={[]}
        categories={categoryRows}
        priceTiers={priceTierRows}
        modifierGroups={modifierGroupRows}
        brands={brandRows}
        outlets={outletRows}
      />
    </div>
  );
}
