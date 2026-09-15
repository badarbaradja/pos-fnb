import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { getIngredientOptions, getRecipesOverview } from "@/lib/recipes/manage";
import { id as strings } from "@/lib/i18n/id";
import { RecipesWorkspace } from "./recipes-workspace";

export default async function RecipesPage() {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(supabase, "product.manage");

  let products;
  let ingredientOptions;
  try {
    [products, ingredientOptions] = await Promise.all([
      getRecipesOverview(db, businessId),
      getIngredientOptions(db, businessId),
    ]);
  } finally {
    await closeDb();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">{strings.recipes.title}</h1>
        <p className="text-sm text-muted-foreground">{strings.recipes.subtitle}</p>
      </div>

      {ingredientOptions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {strings.recipes.noIngredientsWarning}{" "}
          <Link href="/ingredients" className="underline">
            {strings.recipes.goToIngredients}
          </Link>
        </p>
      ) : (
        <RecipesWorkspace initialProducts={products} ingredientOptions={ingredientOptions} />
      )}
    </div>
  );
}
