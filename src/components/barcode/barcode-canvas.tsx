"use client";

import { useEffect, useRef } from "react";
import { encodeCode128B } from "@/lib/barcode/code128";
import { id as strings } from "@/lib/i18n/id";

/**
 * components/barcode/barcode-canvas.tsx — TT05. Gambar Code128 sebagai
 * gambar (bukan font barcode atau perintah printer bawaan) supaya sama
 * persis di layar (pratinjau) dan di kertas -- portable lintas printer
 * thermal apa pun (instruksi CEO 12 September 2026).
 *
 * PERBAIKAN 12 September 2026 (bug: barcode terbaca scanner tapi isinya
 * salah/acak) -- algoritma encodeCode128B() dan pola tabelnya sudah
 * dibuktikan benar lewat verifikasi eksternal (cocok byte-per-byte
 * dengan tabel produksi library JsBarcode) DAN lewat pembacaan ulang
 * piksel kanvas sungguhan di browser (modul yang benar-benar tergambar
 * = modul yang dihitung, tidak ada pembalikan arah). Akar masalah yang
 * PALING MUNGKIN (belum dikonfirmasi lewat pindai fisik ulang): buffer
 * piksel kanvas sebelumnya cuma ~96 DPI (mmToPx pakai 96/25.4), jauh di
 * bawah DPI cetak printer termal (umumnya 203-300 DPI) -- mesin cetak
 * (lewat RawBT) TERPAKSA memperbesar bitmap resolusi rendah itu, dan
 * proses pembesaran (upscaling) bisa mengaburkan batas antar modul
 * cukup jauh untuk mengubah rasio lebar 1:2:3:4 yang jadi dasar scanner
 * membedakan modul -- struktur simbol tetap valid (makanya tetap
 * "terbaca"), tapi nilai tiap simbol berubah (makanya isinya salah).
 *
 * Perbaikan: buffer internal kanvas SEKARANG dihitung dari JUMLAH MODUL
 * barcode (bukan dari widthMm/96dpi) dengan resolusi tinggi tetap per
 * modul, supaya SELALU ada banyak piksel sumber per modul sebelum mesin
 * cetak/print apa pun memperbesarnya -- ukuran FISIK (mm) di layar/
 * kertas tidak berubah sama sekali, cuma resolusi sumbernya yang naik.
 * `imageRendering: pixelated` mencegah browser menghaluskan (blur) tepi
 * modul saat menskalakan kanvas resolusi tinggi ini ke ukuran mm-nya.
 *
 * BELUM DIBUKTIKAN lewat pindai fisik ulang -- ini hipotesis berbasis
 * bukti (dua lapis lain sudah terbukti benar, jadi lapisan cetak/scan
 * adalah satu-satunya yang tersisa), bukan kepastian. Jangan anggap
 * bug ini tertutup sampai ada pindai sungguhan yang lolos.
 */
const PX_PER_MM = 96 / 25.4;
const MIN_PX_PER_MODULE = 10;

export function mmToPx(mm: number): number {
  return Math.round(mm * PX_PER_MM);
}

/**
 * Dipisah dari body komponen supaya testable tanpa render React (proyek
 * ini tidak punya @testing-library/react/jsdom -- environment vitest
 * 'node' murni, lihat vitest.config.mts). Logika PERSIS yang dipakai
 * BarcodeCanvas, bukan reimplementasi terpisah untuk keperluan test.
 */
export function resolveBarcodeModules(data: string): {
  modules: string;
  errorMessage: string | null;
} {
  try {
    return { modules: encodeCode128B(data), errorMessage: null };
  } catch (err) {
    return { modules: "", errorMessage: err instanceof Error ? err.message : String(err) };
  }
}

export function BarcodeCanvas({
  data,
  widthMm,
  heightMm,
  className,
  onEncodeError,
}: {
  data: string;
  widthMm: number;
  heightMm: number;
  className?: string;
  // Perbaikan 13 September 2026 (temuan CEO): dulu error encode DITELAN
  // diam-diam di sini, kanvas dibiarkan kosong tanpa pesan apa pun --
  // label tercetak KOSONG, baru ketahuan saat barang sudah ditempeli
  // label itu dan dijual (tidak bisa dipindai). Kelas kegagalan sama
  // dengan 29 titik silent-failure yang sudah diperbaiki (CLAUDE.md
  // §3.7), cuma belum kena sisir sebelumnya.
  //
  // CATATAN JUJUR: dengan kode barang SELALU digenerate sistem
  // (lib/barang/kode.ts, alfabet aman) dan outlets.code dipaksa
  // ^[A-Z0-9]+$ (Zod + CHECK constraint), jalur ini TIDAK BISA TERCAPAI
  // lewat kode manapun yang dibuat lewat aplikasi -- setiap kode
  // dijamin ASCII 32-126. Ini pertahanan berlapis untuk jalur MASUK
  // LAIN yang belum ada (mis. impor data lama, dibatalkan/ditunda),
  // bukan perbaikan bug yang sedang aktif terjadi hari ini.
  //
  // Callback ini dipakai pemanggil (LabelView -> LabelPrintArea) untuk
  // MENGUNCI tombol cetak, bukan cuma kosmetik di kanvas saja.
  onEncodeError?: (message: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const { modules, errorMessage } = resolveBarcodeModules(data);

  // Beri tahu pemanggil SESUDAH render (bukan langsung di badan komponen)
  // -- memanggil setState pemilik state di parent selama render melanggar
  // aturan React (render harus murni), useEffect yang tepat untuk efek
  // samping begini.
  useEffect(() => {
    onEncodeError?.(errorMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onEncodeError sengaja tidak diikutkan, cukup dipanggil ulang saat PESANNYA berubah, bukan tiap render ulang fungsi callback dari parent
  }, [errorMessage]);

  // Buffer kanvas SELALU beresolusi tinggi (>=10px per modul), TIDAK
  // diturunkan dari widthMm -- ukuran tampil fisik tetap widthMm lewat
  // CSS di bawah, cuma sumbernya sekarang jauh lebih detail dari DPI
  // cetak printer termal mana pun, supaya upscaling di alur cetak tidak
  // punya alasan mengaburkan tepi modul.
  const widthPx = modules.length > 0 ? modules.length * MIN_PX_PER_MODULE : mmToPx(widthMm);
  const heightPx = Math.max(mmToPx(heightMm), 80);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, widthPx, heightPx);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, widthPx, heightPx);
    ctx.fillStyle = "#000000";

    if (modules.length === 0) return;

    // Bulatkan posisi TEPI tiap modul ke piksel bulat (bukan lebar modul
    // lalu dikalikan indeks) -- kalau tidak, galat pembulatan menumpuk dan
    // bar makin menjauh dari posisi seharusnya di ujung barcode yang
    // panjang, bisa membuat rasio lebar bar tidak lagi 1:2:3:4 yang
    // dibutuhkan scanner untuk membedakan modul. Dengan MIN_PX_PER_MODULE
    // konstan, moduleWidthPx sekarang bilangan bulat persis, jadi galat
    // ini praktis nol -- tapi rumusnya dipertahankan karena widthMm besar
    // (preset custom) tetap bisa membuat pembagian tidak genap.
    const moduleWidthPx = widthPx / modules.length;
    let prevEdge = 0;
    for (let i = 0; i < modules.length; i++) {
      const edge = Math.round((i + 1) * moduleWidthPx);
      if (modules[i] === "1") {
        ctx.fillRect(prevEdge, 0, edge - prevEdge, heightPx);
      }
      prevEdge = edge;
    }
  }, [modules, widthPx, heightPx]);

  if (errorMessage) {
    // WAJIB tetap di dalam area yang tercetak (TIDAK print:hidden) --
    // kalau seseorang tetap memicu cetak (mis. Ctrl+P langsung, tombol
    // cetak kita sendiri sudah dikunci pemanggil), kertas yang keluar
    // harus membawa pesan galat, bukan kosong tanpa penjelasan.
    return (
      <div
        role="alert"
        className="flex items-center justify-center border border-dashed border-destructive bg-destructive/10 p-1 text-center text-destructive"
        style={{ width: `${widthMm}mm`, minHeight: `${heightMm}mm`, fontSize: "1.8mm", lineHeight: 1.2 }}
      >
        {strings.barang.barcodeErrorPrefix}
        {errorMessage}
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      width={widthPx}
      height={heightPx}
      className={className}
      style={{ width: `${widthMm}mm`, height: `${heightMm}mm`, imageRendering: "pixelated" }}
    />
  );
}
