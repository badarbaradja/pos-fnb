"use server";

import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import { isOutletAllowed } from "@/lib/auth/outlet-scope";
import { businesses, outlets } from "@/lib/db/schema";
import { businessDate } from "@/lib/utils/business-date";
import { resolveEmployeeIdForUser } from "@/lib/pos/void-refund";
import {
  createOpnameWithDb,
  getActiveOpnameDrafts,
  getOpnameItemsForSession,
  submitOpnameWithDb,
  upsertOpnameItemsBulkWithDb,
  upsertOpnameItemWithDb,
  type OpnameItemRow,
  type SubmitOpnameResult,
  type UpsertOpnameItemPayload,
} from "@/lib/stock-opnames/manage";
import { getMaterialReferencePricesByIngredientId } from "@/lib/stock-opnames/material-reference-prices";
import { id as strings } from "@/lib/i18n/id";

export type OpnameOutletOption = { id: string; name: string; code: string };

export async function getOpnameOutletsAction(): Promise<OpnameOutletOption[]> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId, allowedOutletIds } = await requirePermissionDb(
    supabase,
    "stock.opname_input"
  );
  try {
    const rows = await db
      .select({ id: outlets.id, name: outlets.name, code: outlets.code })
      .from(outlets)
      .where(and(eq(outlets.businessId, businessId), eq(outlets.isActive, true)))
      .orderBy(asc(outlets.name));
    return rows.filter((o) => isOutletAllowed(allowedOutletIds, o.id));
  } finally {
    await closeDb();
  }
}

export type ActiveDraft = { id: string; businessDate: string; label: string | null; createdAt: Date };

export async function getActiveDraftsAction(outletId: string): Promise<ActiveDraft[] | { error: string }> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId, allowedOutletIds } = await requirePermissionDb(
    supabase,
    "stock.opname_input"
  );
  try {
    if (!isOutletAllowed(allowedOutletIds, outletId)) {
      return { error: strings.common.outletAccessDenied };
    }
    return await getActiveOpnameDrafts(db, { businessId, outletId });
  } finally {
    await closeDb();
  }
}

export type CreateOpnameActionResult = { opnameId?: string; error?: string };

export async function createOpnameAction(
  outletId: string,
  label?: string
): Promise<CreateOpnameActionResult> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId, userId, allowedOutletIds } = await requirePermissionDb(
    supabase,
    "stock.opname_input"
  );
  try {
    if (!isOutletAllowed(allowedOutletIds, outletId)) {
      return { error: strings.common.outletAccessDenied };
    }

    const [business] = await db.select({ timezone: businesses.timezone }).from(businesses).where(eq(businesses.id, businessId));
    const [outlet] = await db
      .select({ dayCutoffTime: outlets.dayCutoffTime })
      .from(outlets)
      .where(eq(outlets.id, outletId));
    if (!business || !outlet) {
      return { error: strings.common.unexpectedError };
    }

    const employeeId = await resolveEmployeeIdForUser(db, businessId, userId);
    const bDate = businessDate(new Date(), business.timezone, outlet.dayCutoffTime);

    const opnameId = await createOpnameWithDb(db, {
      businessId,
      outletId,
      businessDate: bDate,
      label,
      createdByEmployeeId: employeeId ?? undefined,
    });
    return { opnameId };
  } catch {
    return { error: strings.common.unexpectedError };
  } finally {
    await closeDb();
  }
}

export type GetOpnameItemsActionResult = { items?: OpnameItemRow[]; error?: string };

export async function getOpnameItemsAction(
  opnameId: string,
  outletId: string
): Promise<GetOpnameItemsActionResult> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId, allowedOutletIds } = await requirePermissionDb(
    supabase,
    "stock.opname_input"
  );
  try {
    if (!isOutletAllowed(allowedOutletIds, outletId)) {
      return { error: strings.common.outletAccessDenied };
    }
    const hargaDefault = await getMaterialReferencePricesByIngredientId(db, businessId);
    const items = await getOpnameItemsForSession(db, { businessId, outletId, opnameId, hargaDefault });
    return { items };
  } catch {
    return { error: strings.common.unexpectedError };
  } finally {
    await closeDb();
  }
}

export type UpsertOpnameItemActionResult = { success?: true; error?: string };

export async function upsertOpnameItemAction(
  opnameId: string,
  outletId: string,
  item: UpsertOpnameItemPayload
): Promise<UpsertOpnameItemActionResult> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId, allowedOutletIds } = await requirePermissionDb(
    supabase,
    "stock.opname_input"
  );
  try {
    if (!isOutletAllowed(allowedOutletIds, outletId)) {
      return { error: strings.common.outletAccessDenied };
    }
    await upsertOpnameItemWithDb(db, { businessId, outletId, opnameId, item });
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : strings.common.unexpectedError };
  } finally {
    await closeDb();
  }
}

export type UpsertOpnameItemsBulkActionResult = { saved?: number; error?: string };

/**
 * Simpan Semua (18 September 2026) -- satu panggilan untuk semua baris yang
 * sudah diisi lokal, dipakai tombol "Simpan Semua" dan auto-save berkala.
 * Baris kosong TIDAK dikirim sama sekali (disaring di workspace) -- server
 * tidak perlu tahu bedanya "sengaja dilewati" vs "belum sempat diisi".
 */
export async function upsertOpnameItemsBulkAction(
  opnameId: string,
  outletId: string,
  items: UpsertOpnameItemPayload[]
): Promise<UpsertOpnameItemsBulkActionResult> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId, allowedOutletIds } = await requirePermissionDb(
    supabase,
    "stock.opname_input"
  );
  try {
    if (!isOutletAllowed(allowedOutletIds, outletId)) {
      return { error: strings.common.outletAccessDenied };
    }
    const { saved } = await upsertOpnameItemsBulkWithDb(db, { businessId, outletId, opnameId, items });
    return { saved };
  } catch (err) {
    return { error: err instanceof Error ? err.message : strings.common.unexpectedError };
  } finally {
    await closeDb();
  }
}

export type SubmitOpnameActionResult = { data?: SubmitOpnameResult; error?: string };

export async function submitOpnameAction(
  opnameId: string,
  outletId: string,
  note?: string
): Promise<SubmitOpnameActionResult> {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId, userId, allowedOutletIds } = await requirePermissionDb(
    supabase,
    "stock.opname_input"
  );
  try {
    if (!isOutletAllowed(allowedOutletIds, outletId)) {
      return { error: strings.common.outletAccessDenied };
    }

    const [business] = await db.select({ timezone: businesses.timezone }).from(businesses).where(eq(businesses.id, businessId));
    const [outlet] = await db
      .select({ dayCutoffTime: outlets.dayCutoffTime })
      .from(outlets)
      .where(eq(outlets.id, outletId));
    if (!business || !outlet) {
      return { error: strings.common.unexpectedError };
    }

    const employeeId = await resolveEmployeeIdForUser(db, businessId, userId);
    const bDate = businessDate(new Date(), business.timezone, outlet.dayCutoffTime);

    const data = await submitOpnameWithDb(db, {
      businessId,
      outletId,
      opnameId,
      submittedByEmployeeId: employeeId ?? undefined,
      businessDate: bDate,
      note,
    });
    revalidatePath("/stock-opnames");
    revalidatePath("/ingredients");
    return { data };
  } catch (err) {
    return { error: err instanceof Error ? err.message : strings.common.unexpectedError };
  } finally {
    await closeDb();
  }
}
