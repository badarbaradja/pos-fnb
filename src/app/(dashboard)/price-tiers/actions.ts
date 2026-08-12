"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { priceTiers } from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";
import { id as strings } from "@/lib/i18n/id";

const priceTierSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().trim().min(1, strings.common.requiredField),
  name: z.string().trim().min(1, strings.common.requiredField),
  channel: z.string().trim().optional(),
  markupPercent: z.coerce.number(),
  isDefault: z.coerce.boolean(),
});

export type PriceTierFormState = {
  error?: string;
};

export async function savePriceTier(
  _prevState: PriceTierFormState,
  formData: FormData
): Promise<PriceTierFormState> {
  const parsed = priceTierSchema.safeParse({
    id: formData.get("id") || undefined,
    code: formData.get("code"),
    name: formData.get("name"),
    channel: formData.get("channel") || undefined,
    markupPercent: formData.get("markupPercent") || 0,
    isDefault: formData.get("isDefault") === "on",
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError,
    };
  }

  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "price.manage"
  );

  try {
    if (parsed.data.id) {
      // business_id difilter eksplisit juga -- RLS lapisan terakhir, bukan
      // satu-satunya (CLAUDE.md §3.4).
      await db
        .update(priceTiers)
        .set({
          code: parsed.data.code,
          name: parsed.data.name,
          channel: parsed.data.channel ?? null,
          markupPercent: String(parsed.data.markupPercent),
          isDefault: parsed.data.isDefault,
        })
        .where(
          and(eq(priceTiers.id, parsed.data.id), eq(priceTiers.businessId, businessId))
        );
    } else {
      await db.insert(priceTiers).values({
        id: generateId(),
        businessId,
        code: parsed.data.code,
        name: parsed.data.name,
        channel: parsed.data.channel ?? null,
        markupPercent: String(parsed.data.markupPercent),
        isDefault: parsed.data.isDefault,
      });
    }
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "23505") {
      return { error: strings.priceTiers.duplicateCode };
    }
    throw err;
  } finally {
    await closeDb();
  }

  revalidatePath("/price-tiers");
  return {};
}
