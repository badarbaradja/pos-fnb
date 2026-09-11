import { z } from "zod";
import { eq } from "drizzle-orm";
import type { UserDbHandle } from "@/lib/db/client";
import { labelSettings } from "@/lib/db/schema";
import { id as strings } from "@/lib/i18n/id";

type Db = UserDbHandle["db"];

/**
 * lib/labels/manage.ts — TT05. `label_settings` SATU baris per bisnis
 * (unique businessId, lihat schema.ts) -- bukan per barang, per outlet,
 * atau per pengguna. Semua label thrifting satu bisnis memakai pengaturan
 * yang sama, diubah kapan saja dari Admin (RENCANA-PEMBANGUNAN-KASIR-
 * THRIFTING.md §8).
 */
export type LabelSettingsValue = {
  widthMm: string;
  heightMm: string;
  showBarcode: boolean;
  showName: boolean;
  showPrice: boolean;
  showPemilikKode: boolean;
  showUkuran: boolean;
};

const DEFAULT_LABEL_SETTINGS: LabelSettingsValue = {
  widthMm: "50",
  heightMm: "80",
  showBarcode: true,
  showName: true,
  showPrice: true,
  showPemilikKode: false,
  showUkuran: true,
};

export async function getLabelSettingsWithDb(
  db: Db,
  businessId: string
): Promise<LabelSettingsValue> {
  const [row] = await db
    .select({
      widthMm: labelSettings.widthMm,
      heightMm: labelSettings.heightMm,
      showBarcode: labelSettings.showBarcode,
      showName: labelSettings.showName,
      showPrice: labelSettings.showPrice,
      showPemilikKode: labelSettings.showPemilikKode,
      showUkuran: labelSettings.showUkuran,
    })
    .from(labelSettings)
    .where(eq(labelSettings.businessId, businessId));

  return row ?? DEFAULT_LABEL_SETTINGS;
}

const saveLabelSettingsSchema = z.object({
  widthMm: z.coerce.number().positive(strings.labelSettings.sizeMustBePositive),
  heightMm: z.coerce.number().positive(strings.labelSettings.sizeMustBePositive),
  showBarcode: z.coerce.boolean().default(false),
  showName: z.coerce.boolean().default(false),
  showPrice: z.coerce.boolean().default(false),
  showPemilikKode: z.coerce.boolean().default(false),
  showUkuran: z.coerce.boolean().default(false),
});

export type LabelSettingsActionResult = { error?: string; success?: true };

export async function saveLabelSettingsWithDb(
  db: Db,
  businessId: string,
  rawInput: unknown
): Promise<LabelSettingsActionResult> {
  const parsed = saveLabelSettingsSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const data = parsed.data;

  await db
    .insert(labelSettings)
    .values({
      businessId,
      widthMm: String(data.widthMm),
      heightMm: String(data.heightMm),
      showBarcode: data.showBarcode,
      showName: data.showName,
      showPrice: data.showPrice,
      showPemilikKode: data.showPemilikKode,
      showUkuran: data.showUkuran,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: labelSettings.businessId,
      set: {
        widthMm: String(data.widthMm),
        heightMm: String(data.heightMm),
        showBarcode: data.showBarcode,
        showName: data.showName,
        showPrice: data.showPrice,
        showPemilikKode: data.showPemilikKode,
        showUkuran: data.showUkuran,
        updatedAt: new Date(),
      },
    });

  return { success: true };
}
