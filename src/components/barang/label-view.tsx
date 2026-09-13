import { Decimal } from "decimal.js";
import { BarcodeCanvas } from "@/components/barcode/barcode-canvas";
import { formatIDR } from "@/lib/utils/money";
import type { LabelSettingsValue } from "@/lib/labels/manage";

export type LabelBarangData = {
  kode: string;
  nama: string;
  ukuran: string | null;
  hargaJual: string;
  pemilikKode: string | null;
};

/**
 * components/barang/label-view.tsx — TT05. Layout label barcode fisik,
 * dipakai DUA tempat: pratinjau di halaman pengaturan (data contoh) dan
 * halaman cetak sungguhan (data barang asli) -- satu sumber kebenaran
 * tampilan supaya pratinjau tidak pernah menipu (apa yang dilihat di
 * layar = apa yang tercetak).
 *
 * Ukuran fisik lewat CSS mm langsung (bukan px) -- konsisten dengan
 * @page di halaman cetak (app/(dashboard)/barang/[id]/label/page.tsx).
 */
export function LabelView({
  settings,
  barang,
  onBarcodeError,
}: {
  settings: LabelSettingsValue;
  barang: LabelBarangData;
  onBarcodeError?: (message: string | null) => void;
}) {
  const widthMm = Number(settings.widthMm);
  const heightMm = Number(settings.heightMm);
  // Barcode selebar label dikurangi margin kecil kiri-kanan, tinggi ~40%
  // dari tinggi label (sisanya untuk teks) -- proporsi tetap, bukan
  // dihitung ulang per preset supaya barcode tidak pernah gepeng di label
  // pendek (33x15mm).
  const barcodeWidthMm = Math.max(widthMm - 4, 10);
  const barcodeHeightMm = Math.max(heightMm * 0.35, 6);

  return (
    <div
      className="flex flex-col items-center justify-start gap-0.5 overflow-hidden bg-white text-black"
      style={{ width: `${widthMm}mm`, height: `${heightMm}mm`, padding: "1mm" }}
    >
      {settings.showName ? (
        <div className="w-full truncate text-center leading-tight" style={{ fontSize: "2.2mm" }}>
          {barang.nama}
        </div>
      ) : null}
      {settings.showUkuran && barang.ukuran ? (
        <div className="w-full truncate text-center leading-tight" style={{ fontSize: "1.8mm" }}>
          {barang.ukuran}
        </div>
      ) : null}
      {settings.showPrice ? (
        <div className="w-full truncate text-center font-bold leading-tight" style={{ fontSize: "2.6mm" }}>
          {formatIDR(new Decimal(barang.hargaJual))}
        </div>
      ) : null}
      {settings.showBarcode ? (
        <BarcodeCanvas
          data={barang.kode}
          widthMm={barcodeWidthMm}
          heightMm={barcodeHeightMm}
          onEncodeError={onBarcodeError}
        />
      ) : null}
      <div className="w-full truncate text-center font-mono leading-tight" style={{ fontSize: "1.8mm" }}>
        {barang.kode}
      </div>
      {settings.showPemilikKode && barang.pemilikKode ? (
        <div className="w-full truncate text-center leading-tight" style={{ fontSize: "1.6mm" }}>
          {barang.pemilikKode}
        </div>
      ) : null}
    </div>
  );
}
