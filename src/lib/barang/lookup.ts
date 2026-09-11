import { and, eq } from "drizzle-orm";
import type { UserDbHandle } from "@/lib/db/client";
import { barang, pemilik } from "@/lib/db/schema";
import { id as strings } from "@/lib/i18n/id";

type Db = UserDbHandle["db"];

export type ScannedBarang = {
  id: string;
  kode: string;
  nama: string;
  ukuran: string | null;
  warna: string | null;
  hargaJual: string;
  pemilikId: string | null;
  pemilikNama: string | null;
};

export type LookupBarangResult = { error?: string; success?: ScannedBarang };

/**
 * lib/barang/lookup.ts — TT06. Dipanggil setiap kali kasir memindai/
 * mengetik kode barang di layar kasir thrifting (kode dipindai barcode
 * scanner USB/Bluetooth berperilaku seperti keyboard, mengetik teks lalu
 * Enter -- TIDAK ADA pemindaian kamera, lihat RENCANA-PEMBANGUNAN-KASIR-
 * THRIFTING.md §4 TT06 catatan riset).
 *
 * TIDAK memvalidasi shift/outlet cocok dengan barang.outletId di sini --
 * barang secara fisik ada di satu outlet, tapi keputusan "boleh dijual
 * dari outlet lain atau tidak" belum ditanyakan ke CEO (kemungkinan tidak
 * relevan kalau baru ada satu outlet thrifting). Konsekuensinya: lookup
 * ini cuma memfilter businessId (RLS + eksplisit), TIDAK memfilter
 * outletId -- dicatat di sini supaya tidak lupa kalau nanti ada outlet
 * thrifting kedua.
 */
export async function findSellableBarangByKode(
  db: Db,
  businessId: string,
  kode: string
): Promise<LookupBarangResult> {
  const trimmed = kode.trim();
  if (!trimmed) {
    return { error: strings.pos.kodeKosongError };
  }

  const [row] = await db
    .select({
      id: barang.id,
      kode: barang.kode,
      nama: barang.nama,
      ukuran: barang.ukuran,
      warna: barang.warna,
      hargaJual: barang.hargaJual,
      status: barang.status,
      pemilikId: barang.pemilikId,
      pemilikNama: pemilik.nama,
    })
    .from(barang)
    .leftJoin(pemilik, eq(barang.pemilikId, pemilik.id))
    .where(and(eq(barang.kode, trimmed), eq(barang.businessId, businessId)));

  if (!row) {
    return { error: strings.pos.barangTidakDitemukanError.replace("{kode}", trimmed) };
  }
  if (row.status !== "siap_jual") {
    return { error: strings.pos.barangTidakSiapJualError.replace("{kode}", row.kode) };
  }

  return {
    success: {
      id: row.id,
      kode: row.kode,
      nama: row.nama,
      ukuran: row.ukuran,
      warna: row.warna,
      hargaJual: row.hargaJual,
      pemilikId: row.pemilikId,
      pemilikNama: row.pemilikNama,
    },
  };
}
