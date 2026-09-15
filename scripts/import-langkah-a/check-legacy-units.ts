import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { eq, like } from "drizzle-orm";
import { getAdminDb } from "../../src/lib/db/client";
import { businesses, ingredients, stockLevels, stockMovements, units } from "../../src/lib/db/schema";

async function main() {
  const db = getAdminDb();
  const [business] = await db.select().from(businesses).where(like(businesses.name, "%Demo Cafe%"));
  if (!business) throw new Error("business not found");
  const businessId = business.id;

  const existingUnits = await db.select().from(units).where(eq(units.businessId, businessId));
  console.log("Units sekarang:", existingUnits);

  const existingIngredients = await db.select().from(ingredients).where(eq(ingredients.businessId, businessId));
  console.log("\nIngredients sekarang:", existingIngredients);

  for (const ing of existingIngredients) {
    const movements = await db.select().from(stockMovements).where(eq(stockMovements.ingredientId, ing.id));
    const levels = await db.select().from(stockLevels).where(eq(stockLevels.ingredientId, ing.id));
    console.log(`\nIngredient "${ing.name}" (${ing.id}): ${movements.length} stock_movements, ${levels.length} stock_levels`);
  }
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
