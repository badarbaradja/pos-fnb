import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, and, eq, isNull } from "drizzle-orm";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import {
  categories,
  priceTiers,
  modifierGroups,
  products,
  productVariants,
  productPrices,
  productModifierGroups,
} from "@/lib/db/schema";
import { id as strings } from "@/lib/i18n/id";
import { ProductForm, type VariantValue } from "../product-form";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: productId } = await params;
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "product.manage"
  );

  let product,
    categoryRows,
    priceTierRows,
    modifierGroupRows,
    variantRows,
    priceRows,
    assignmentRows;
  try {
    [product] = await db
      .select()
      .from(products)
      .where(and(eq(products.id, productId), eq(products.businessId, businessId)));
    if (!product) {
      return notFound();
    }

    [
      categoryRows,
      priceTierRows,
      modifierGroupRows,
      variantRows,
      priceRows,
      assignmentRows,
    ] = await Promise.all([
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
        .select()
        .from(productVariants)
        .where(eq(productVariants.productId, productId))
        .orderBy(asc(productVariants.name)),
      db
        .select({
          priceTierId: productPrices.priceTierId,
          price: productPrices.price,
        })
        .from(productPrices)
        .where(
          and(
            eq(productPrices.productId, productId),
            isNull(productPrices.variantId)
          )
        ),
      db
        .select({ modifierGroupId: productModifierGroups.modifierGroupId })
        .from(productModifierGroups)
        .where(eq(productModifierGroups.productId, productId)),
    ]);
  } finally {
    await closeDb();
  }

  const initialVariants: VariantValue[] = variantRows.map((v) => ({
    key: v.id,
    id: v.id,
    name: v.name,
    sku: v.sku ?? "",
    priceDelta: v.priceDelta,
    isDefault: v.isDefault,
    isActive: v.isActive,
  }));

  const initialPrices: Record<string, string> = {};
  for (const row of priceRows) {
    initialPrices[row.priceTierId] = row.price;
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
      <h1 className="text-xl font-semibold">{strings.products.editTitle}</h1>
      <ProductForm
        product={product}
        initialVariants={initialVariants}
        initialPrices={initialPrices}
        assignedModifierGroupIds={assignmentRows.map((a) => a.modifierGroupId)}
        categories={categoryRows}
        priceTiers={priceTierRows}
        modifierGroups={modifierGroupRows}
      />
    </div>
  );
}
