/**
 * scripts/seed-shared.ts — konstanta & helper dipakai lintas script seed
 * (seed-demo.ts, seed-catalog.ts, dan T24b nanti) supaya semuanya menunjuk
 * ke business demo yang sama tanpa duplikasi nama.
 */
import { eq } from "drizzle-orm";
import type { getAdminDb } from "../src/lib/db/client";
import { businesses } from "../src/lib/db/schema";

export const DEMO_BUSINESS_NAME = "Demo Cafe";

export async function getDemoBusinessId(
  db: ReturnType<typeof getAdminDb>
): Promise<string> {
  const [business] = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(eq(businesses.name, DEMO_BUSINESS_NAME));
  if (!business) {
    throw new Error(
      `Business demo "${DEMO_BUSINESS_NAME}" belum ada. Jalankan dulu: npm run seed:demo -- <email>`
    );
  }
  return business.id;
}
