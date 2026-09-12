"use client";

import { useEffect, useRef } from "react";
import { encodeCode128B } from "@/lib/barcode/code128";

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

export function BarcodeCanvas({
  data,
  widthMm,
  heightMm,
  className,
}: {
  data: string;
  widthMm: number;
  heightMm: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  let modules = "";
  try {
    modules = encodeCode128B(data);
  } catch {
    // Data di luar jangkauan Code128 (seharusnya tidak pernah terjadi
    // untuk kode barang -- lib/barang/kode.ts cuma memakai huruf besar/
    // angka/"-" -- tapi kalau terjadi, biarkan kanvas kosong daripada
    // melempar exception yang menghentikan render seluruh label.
    modules = "";
  }

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
