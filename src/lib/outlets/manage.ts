import { z } from "zod";
import { and, eq } from "drizzle-orm";
import type { UserDbHandle } from "@/lib/db/client";
import { brands, outlets } from "@/lib/db/schema";
import { assertRowsAffected, isUniqueViolation } from "@/lib/db/errors";
import { generateId } from "@/lib/utils/id";
import { CUTOFF_PATTERN } from "@/lib/utils/business-date";
import { hasOpenShiftForOutlet } from "@/lib/pos/shift";
import { id as strings } from "@/lib/i18n/id";

/**
 * lib/outlets/manage.ts — T22b. Pola thin-wrapper sama lib/employees/manage.ts
 * (fungsi murni (db, businessId, input) => result, testable tanpa request
 * Next.js sungguhan, dipisah dari Server Action pembungkus di
 * app/(dashboard)/outlets/actions.ts).
 *
 * TIDAK ADA deleteOutletWithDb -- master data tidak pernah dihapus, cuma
 * dinonaktifkan (CLAUDE.md §3.2). `code` tidak bisa diubah lewat
 * updateOutletWithDb sama sekali (bukan cuma dikunci di UI) -- dipakai di
 * nomor struk (schema.ts komentar), sama alasan employees.code/
 * devices.serialNumber.
 *
 * Izin bertingkat SENGAJA tidak dicek di sini (mengikuti pola manage.ts lain
 * -- pengecekan izin ada di Server Action pembungkus), tapi dicatat di sini
 * supaya jelas: MEMBUAT outlet baru digerbang "settings.business" (owner-
 * only), MENGUBAH outlet yang sudah ada digerbang "outlet.manage" (owner +
 * manajer) -- lihat permissions.ts.
 */

type Db = UserDbHandle["db"];

// code SENGAJA dipisah dari field lain -- cuma masuk skema create, tidak
// pernah masuk skema update (lihat catatan file di atas).
const editableOutletFields = {
  // T22a -- setiap outlet wajib satu brand (label/laporan, §8.a/§8.b di
  // docs/05-RENCANA-FASE-2.md). Boleh diubah lewat update (beda dari code)
  // -- rebranding satu outlet tidak mengubah identitas struk/riwayatnya.
  brandId: z.string().uuid(strings.outlets.brandRequired),
  name: z.string().trim().min(1, strings.common.requiredField),
  address: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  dayCutoffTime: z
    .string()
    .trim()
    .regex(CUTOFF_PATTERN, strings.outlets.cutoffTimeFormatError),
  isCentralKitchen: z.coerce.boolean().default(false),
  taxPercent: z.coerce.number().min(0, strings.outlets.percentMustBeNonNegative),
  taxInclusive: z.coerce.boolean().default(false),
  serviceChargePercent: z.coerce.number().min(0, strings.outlets.percentMustBeNonNegative),
  serviceChargeInTaxBase: z.coerce.boolean().default(true),
  roundingTo: z.coerce.number().int().positive(strings.outlets.roundingMustBePositive),
  cashVarianceTolerance: z.string().trim().min(1, strings.common.requiredField),
  cashEnabled: z.coerce.boolean().default(true),
  varianceAlertPercent: z.coerce.number().min(0, strings.outlets.percentMustBeNonNegative),
  varianceAlertValue: z.string().trim().min(1, strings.common.requiredField),
};

const createOutletSchema = z.object({
  code: z.string().trim().min(1, strings.common.requiredField),
  ...editableOutletFields,
});

const updateOutletSchema = z.object({
  id: z.string().uuid(),
  ...editableOutletFields,
  isActive: z.boolean(),
});

export type OutletActionResult = {
  error?: string;
  success?: { outletId: string };
};

/**
 * Cek brand benar-benar terdaftar milik bisnis ini -- pertahanan server
 * dengan pesan jelas (bukan cuma mengandalkan error FK/trigger mentah dari
 * Postgres saat cross-tenant), pola sama validateUnitCodes di
 * lib/ingredients/manage.ts.
 */
async function validateBrand(
  db: Db,
  businessId: string,
  brandId: string
): Promise<string | undefined> {
  const [row] = await db
    .select({ id: brands.id })
    .from(brands)
    .where(and(eq(brands.id, brandId), eq(brands.businessId, businessId)));
  return row ? undefined : strings.outlets.brandNotFound;
}

export async function createOutletWithDb(
  db: Db,
  businessId: string,
  rawInput: unknown
): Promise<OutletActionResult> {
  const parsed = createOutletSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const data = parsed.data;

  const brandError = await validateBrand(db, businessId, data.brandId);
  if (brandError) {
    return { error: brandError };
  }

  const outletId = generateId();
  try {
    await db.insert(outlets).values({
      id: outletId,
      businessId,
      brandId: data.brandId,
      code: data.code,
      name: data.name,
      address: data.address || null,
      phone: data.phone || null,
      dayCutoffTime: data.dayCutoffTime,
      isCentralKitchen: data.isCentralKitchen,
      taxPercent: String(data.taxPercent),
      taxInclusive: data.taxInclusive,
      serviceChargePercent: String(data.serviceChargePercent),
      serviceChargeInTaxBase: data.serviceChargeInTaxBase,
      roundingTo: data.roundingTo,
      cashVarianceTolerance: data.cashVarianceTolerance,
      cashEnabled: data.cashEnabled,
      varianceAlertPercent: String(data.varianceAlertPercent),
      varianceAlertValue: data.varianceAlertValue,
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { error: strings.outlets.duplicateCode };
    }
    throw err;
  }

  return { success: { outletId } };
}

export async function updateOutletWithDb(
  db: Db,
  businessId: string,
  rawInput: unknown
): Promise<OutletActionResult> {
  const parsed = updateOutletSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const data = parsed.data;

  const brandError = await validateBrand(db, businessId, data.brandId);
  if (brandError) {
    return { error: brandError };
  }

  if (!data.isActive) {
    const hasOpenShift = await hasOpenShiftForOutlet(db, data.id);
    if (hasOpenShift) {
      return { error: strings.outlets.deactivateBlockedOpenShift };
    }
  }

  const updated = await db
    .update(outlets)
    .set({
      brandId: data.brandId,
      name: data.name,
      address: data.address || null,
      phone: data.phone || null,
      dayCutoffTime: data.dayCutoffTime,
      isCentralKitchen: data.isCentralKitchen,
      taxPercent: String(data.taxPercent),
      taxInclusive: data.taxInclusive,
      serviceChargePercent: String(data.serviceChargePercent),
      serviceChargeInTaxBase: data.serviceChargeInTaxBase,
      roundingTo: data.roundingTo,
      cashVarianceTolerance: data.cashVarianceTolerance,
      cashEnabled: data.cashEnabled,
      varianceAlertPercent: String(data.varianceAlertPercent),
      varianceAlertValue: data.varianceAlertValue,
      isActive: data.isActive,
    })
    .where(and(eq(outlets.id, data.id), eq(outlets.businessId, businessId)))
    .returning({ id: outlets.id });
  assertRowsAffected(updated, "outlet");

  return { success: { outletId: data.id } };
}
