"use client";

import { useEffect, useRef } from "react";
import { encodeCode128B } from "@/lib/barcode/code128";

/**
 * components/barcode/barcode-canvas.tsx — TT05. Gambar Code128 sebagai
 * gambar (bukan font barcode atau perintah printer bawaan) supaya sama
 * persis di layar (pratinjau) dan di kertas -- portable lintas printer
 * thermal apa pun (instruksi CEO 12 September 2026).
 *
 * widthMm/heightMm di sini HANYA untuk area barcode itu sendiri (bagian
 * dari label yang lebih besar, lihat components/barang/label-view.tsx) --
 * bukan ukuran label penuh. `mmToPx` pakai 96 DPI dasar CSS (1in = 25.4mm
 * = 96px) supaya ukuran fisik di layar (preview) dan di kertas (print,
 * lewat @page di label-view.tsx) konsisten.
 */
const PX_PER_MM = 96 / 25.4;

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
  const widthPx = mmToPx(widthMm);
  const heightPx = mmToPx(heightMm);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, widthPx, heightPx);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, widthPx, heightPx);
    ctx.fillStyle = "#000000";

    let modules: string;
    try {
      modules = encodeCode128B(data);
    } catch {
      // Data di luar jangkauan Code128 (seharusnya tidak pernah terjadi
      // untuk kode barang -- lib/barang/kode.ts cuma memakai huruf besar/
      // angka/"-" -- tapi kalau terjadi, biarkan kanvas kosong daripada
      // melempar exception yang menghentikan render seluruh label.
      return;
    }

    // Bulatkan posisi TEPI tiap modul ke piksel bulat (bukan lebar modul
    // lalu dikalikan indeks) -- kalau tidak, galat pembulatan menumpuk dan
    // bar makin menjauh dari posisi seharusnya di ujung barcode yang
    // panjang, bisa membuat rasio lebar bar tidak lagi 1:2:3:4 yang
    // dibutuhkan scanner untuk membedakan modul.
    const moduleWidthPx = widthPx / modules.length;
    let prevEdge = 0;
    for (let i = 0; i < modules.length; i++) {
      const edge = Math.round((i + 1) * moduleWidthPx);
      if (modules[i] === "1") {
        ctx.fillRect(prevEdge, 0, edge - prevEdge, heightPx);
      }
      prevEdge = edge;
    }
  }, [data, widthPx, heightPx]);

  return (
    <canvas
      ref={canvasRef}
      width={widthPx}
      height={heightPx}
      className={className}
      style={{ width: `${widthMm}mm`, height: `${heightMm}mm` }}
    />
  );
}
