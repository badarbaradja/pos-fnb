import { and, asc, eq } from "drizzle-orm";
import type { UserDbHandle } from "@/lib/db/client";
import { paymentMethods } from "@/lib/db/schema";
import type { PairedDevice, PairedOutlet } from "@/lib/pos/device-pairing";

export type ThriftPaymentMethod = {
  id: string;
  name: string;
  isCashDrawer: boolean;
  requiresRef: boolean;
};

export type ThriftOutlet = {
  id: string;
  name: string;
  code: string;
  taxPercent: string;
  taxInclusive: boolean;
  serviceChargePercent: string;
  serviceChargeInTaxBase: boolean;
  roundingTo: number;
  cashEnabled: boolean;
};

/**
 * app/(pos)/pos/thrift/get-thrift-catalog.ts — TT06. Padanan minimal
 * get-pos-catalog.ts F&B: TIDAK ADA produk/varian/modifier/tingkat harga
 * (thrifting tidak memakainya sama sekali -- satu harga tetap per barang,
 * lib/barang/lookup.ts yang mengambil barang satu-per-satu saat dipindai,
 * bukan katalog penuh di muka). Cuma outlet+device+metode bayar, fetch
 * SEKALI saat halaman dibuka, sama prinsip T12.
 */
export async function getThriftCatalog(
  db: UserDbHandle["db"],
  businessId: string,
  outlet: PairedOutlet,
  device: PairedDevice
): Promise<{ outlet: ThriftOutlet; device: PairedDevice; paymentMethods: ThriftPaymentMethod[] }> {
  let paymentMethodRows = await db
    .select()
    .from(paymentMethods)
    .where(and(eq(paymentMethods.businessId, businessId), eq(paymentMethods.isActive, true)))
    .orderBy(asc(paymentMethods.sortOrder));
  if (paymentMethodRows.length === 0) {
    throw new Error("Belum ada metode pembayaran untuk bisnis ini.");
  }
  // Sama persis get-pos-catalog.ts: outlet cashless menyaring metode
  // isCashDrawer=true dari daftar yang ditampilkan.
  if (!outlet.cashEnabled) {
    paymentMethodRows = paymentMethodRows.filter((pm) => !pm.isCashDrawer);
  }

  return {
    outlet: {
      id: outlet.id,
      name: outlet.name,
      code: outlet.code,
      taxPercent: outlet.taxPercent,
      taxInclusive: outlet.taxInclusive,
      serviceChargePercent: outlet.serviceChargePercent,
      serviceChargeInTaxBase: outlet.serviceChargeInTaxBase,
      roundingTo: outlet.roundingTo,
      cashEnabled: outlet.cashEnabled,
    },
    device,
    paymentMethods: paymentMethodRows.map((pm) => ({
      id: pm.id,
      name: pm.name,
      isCashDrawer: pm.isCashDrawer,
      requiresRef: pm.requiresRef,
    })),
  };
}
