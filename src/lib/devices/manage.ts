import { z } from "zod";
import { and, eq } from "drizzle-orm";
import type { UserDbHandle } from "@/lib/db/client";
import { devices } from "@/lib/db/schema";
import { assertRowsAffected, isUniqueViolation } from "@/lib/db/errors";
import { generateId } from "@/lib/utils/id";
import { id as strings } from "@/lib/i18n/id";

/**
 * lib/devices/manage.ts — T15c. Pola thin-wrapper sama lib/employees/manage.ts
 * (fungsi murni (db, businessId, input) => result, testable tanpa request
 * Next.js sungguhan, dipisah dari Server Action pembungkus di
 * app/(dashboard)/devices/actions.ts).
 *
 * TIDAK ADA deleteDeviceWithDb -- RLS `devices` (schema.ts) cuma punya
 * policy select/insert/update, tidak ada policy delete sama sekali, jadi
 * delete lewat getUserDb() sudah mustahil di level database. Master data
 * tidak pernah dihapus, cuma dinonaktifkan (CLAUDE.md §3.2) -- device yang
 * sudah pernah dipakai transaksi (nomor struk merujuk device_id) harus
 * tetap bisa ditelusuri.
 */

export const deviceTypeValues = ["pos", "waiter", "kds", "display"] as const;

type Db = UserDbHandle["db"];

const createDeviceSchema = z.object({
  name: z.string().trim().min(1, strings.common.requiredField),
  outletId: z.string().uuid(),
  serialNumber: z.string().trim().min(1, strings.common.requiredField),
  deviceType: z.enum(deviceTypeValues),
});

const updateDeviceSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, strings.common.requiredField),
  outletId: z.string().uuid(),
  isActive: z.boolean(),
});

export type DeviceActionResult = {
  error?: string;
  success?: { deviceId: string };
};

export async function createDeviceWithDb(
  db: Db,
  businessId: string,
  rawInput: unknown
): Promise<DeviceActionResult> {
  const parsed = createDeviceSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const data = parsed.data;

  const deviceId = generateId();
  try {
    await db.insert(devices).values({
      id: deviceId,
      businessId,
      outletId: data.outletId,
      serialNumber: data.serialNumber,
      name: data.name,
      deviceType: data.deviceType,
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { error: strings.devices.duplicateSerialNumber };
    }
    throw err;
  }

  return { success: { deviceId } };
}

export async function updateDeviceWithDb(
  db: Db,
  businessId: string,
  rawInput: unknown
): Promise<DeviceActionResult> {
  const parsed = updateDeviceSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const data = parsed.data;

  const updated = await db
    .update(devices)
    .set({
      name: data.name,
      outletId: data.outletId,
      isActive: data.isActive,
    })
    .where(and(eq(devices.id, data.id), eq(devices.businessId, businessId)))
    .returning({ id: devices.id });
  assertRowsAffected(updated, "perangkat");

  return { success: { deviceId: data.id } };
}
