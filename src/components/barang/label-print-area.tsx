"use client";

import { useState, type ReactNode } from "react";
import { LabelView, type LabelBarangData } from "./label-view";
import { PrintButton } from "@/components/receipt/print-button";
import type { LabelSettingsValue } from "@/lib/labels/manage";
import { id as strings } from "@/lib/i18n/id";

/**
 * components/barang/label-print-area.tsx — perbaikan 13 September 2026
 * (temuan CEO, terpisah dari investigasi TT13): sebelumnya
 * BarcodeCanvas menelan galat encode diam-diam, label tercetak KOSONG
 * tanpa pesan apa pun -- baru ketahuan saat barang sudah dijual dan
 * labelnya tidak mau dipindai. Dipakai KEDUA halaman cetak
 * (dashboard & kasir thrift) supaya perilakunya identik -- satu tempat
 * yang menahan state galat encode dan mengunci tombol cetak, bukan
 * diduplikasi di tiap Server Component halaman (yang tidak bisa
 * menahan state client sama sekali).
 *
 * Pesan galat SENGAJA tetap ada di dalam #label-print-area (area yang
 * ikut tercetak) -- kalau seseorang tetap memicu cetak lewat jalur lain
 * (Ctrl+P, ikon print browser) walau tombol kita terkunci, kertas yang
 * keluar membawa pesan galat, bukan kosong tanpa penjelasan (lihat
 * BarcodeCanvas).
 */
export function LabelPrintArea({
  settings,
  barang,
  printButtonLabel,
  extraActions,
}: {
  settings: LabelSettingsValue;
  barang: LabelBarangData;
  printButtonLabel: string;
  extraActions?: ReactNode;
}) {
  const [barcodeError, setBarcodeError] = useState<string | null>(null);

  return (
    <>
      <div id="label-print-area" className="border print:border-0">
        <LabelView settings={settings} barang={barang} onBarcodeError={setBarcodeError} />
      </div>
      <div className="flex flex-col items-center gap-2 print:hidden">
        <div className="flex items-center gap-2">
          <PrintButton label={printButtonLabel} disabled={Boolean(barcodeError)} />
          {extraActions}
        </div>
        {barcodeError ? (
          <p role="alert" className="max-w-xs text-center text-sm text-destructive">
            {strings.barang.printBlockedHint}
          </p>
        ) : null}
      </div>
    </>
  );
}
