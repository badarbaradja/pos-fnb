import { z } from "zod";
import { and, eq } from "drizzle-orm";
import type { UserDbHandle } from "@/lib/db/client";
import { outlets, pemilikPayouts } from "@/lib/db/schema";
import { id as strings } from "@/lib/i18n/id";

type Db = UserDbHandle["db"];

/**
 * lib/pemilik/payout-manage.ts — TT11. "Tandai sudah dibayar" -- SATU
 * BARIS BARU per pencatatan (append-only, lihat komentar schema.ts),
 * tidak pernah mengedit/menjumlah ulang baris lama. "Sisa dibayar"
 * dihitung pemanggil dari SEMUA baris periode itu (lib/calc/
 * bagi-hasil-payout.ts), bukan disimpan di sini.
 */

const recordPayoutSchema = z.object({
  outletId: z.string().uuid(),
  pemilikId: z.string().uuid(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, strings.common.unexpectedError),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, strings.common.unexpectedError),
  jumlah: z.coerce.number().positive(strings.bagiHasil.jumlahBayarHarusPositif),
  tanggalBayar: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, strings.common.unexpectedError),
  catatan: z.string().trim().optional(),
});

export type RecordPayoutResult = { error?: string; success?: { payoutId: string } };

export async function recordPemilikPayoutWithDb(
  db: Db,
  businessId: string,
  recordedByUserId: string,
  rawInput: unknown
): Promise<RecordPayoutResult> {
  const parsed = recordPayoutSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const data = parsed.data;

  // SYARAT 3 TT11 -- terkunci sampai dayCutoffTime outlet ini
  // dikonfirmasi manusia. Batas hari yang salah menggeser transaksi dini
  // hari ke bulan yang keliru, yang mengubah angka bagianPemilik periode
  // ini -- mencatat pembayaran berdasarkan angka yang bisa bergeser
  // adalah persis yang ingin dicegah gerbang ini.
  const [outlet] = await db
    .select({ dayCutoffConfirmed: outlets.dayCutoffConfirmed })
    .from(outlets)
    .where(and(eq(outlets.id, data.outletId), eq(outlets.businessId, businessId)));
  if (!outlet) {
    return { error: strings.common.unexpectedError };
  }
  if (!outlet.dayCutoffConfirmed) {
    return { error: strings.bagiHasil.cutoffBelumDikonfirmasiError };
  }

  const [row] = await db
    .insert(pemilikPayouts)
    .values({
      businessId,
      outletId: data.outletId,
      pemilikId: data.pemilikId,
      startDate: data.startDate,
      endDate: data.endDate,
      jumlah: String(data.jumlah),
      tanggalBayar: data.tanggalBayar,
      recordedByUserId,
      catatan: data.catatan || null,
    })
    .returning({ id: pemilikPayouts.id });

  return { success: { payoutId: row!.id } };
}
