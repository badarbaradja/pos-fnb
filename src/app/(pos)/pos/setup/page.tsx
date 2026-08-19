import { and, asc, eq } from "drizzle-orm";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { hasPermission, requirePermissionDb } from "@/lib/auth/permissions";
import { devices, outlets } from "@/lib/db/schema";
import { id as strings } from "@/lib/i18n/id";
import { SetupForm, type DeviceOption } from "@/components/pos/setup-form";

/**
 * T22e — halaman "Hubungkan Perangkat". Digerbang izin PALING RENDAH di
 * /pos ("pos.create_order", sama seperti layar kasir) supaya SIAPA PUN
 * yang berhak duduk di kasir bisa MELIHAT halaman ini kalau tabletnya
 * lepas sambungan (bukan halaman error kosong) -- tapi cuma yang punya
 * "employee.manage" (owner/manajer, sama gerbang dengan halaman /devices)
 * yang melihat form untuk benar-benar menyambungkan. Lihat
 * lib/pos/device-pairing.ts untuk desain lengkapnya.
 */
export default async function PosSetupPage() {
  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId, role } = await requirePermissionDb(
    supabase,
    "pos.create_order"
  );
  const canManage = hasPermission(role, "employee.manage");

  let deviceRows: DeviceOption[] = [];
  try {
    if (canManage) {
      deviceRows = await db
        .select({
          id: devices.id,
          name: devices.name,
          serialNumber: devices.serialNumber,
          outletName: outlets.name,
        })
        .from(devices)
        .innerJoin(outlets, eq(devices.outletId, outlets.id))
        .where(and(eq(devices.businessId, businessId), eq(devices.isActive, true)))
        .orderBy(asc(outlets.createdAt), asc(devices.name));
    }
  } finally {
    await closeDb();
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-4">
      <div className="flex w-full max-w-sm flex-col gap-1">
        <h1 className="text-lg font-semibold">{strings.pos.setupTitle}</h1>
        <p className="text-sm text-muted-foreground">{strings.pos.setupHint}</p>
      </div>
      <SetupForm canManage={canManage} devices={deviceRows} />
    </div>
  );
}
