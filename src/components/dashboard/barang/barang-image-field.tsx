"use client";

import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ProductInitialsAvatar } from "@/components/products/product-initials-avatar";
import {
  BARANG_IMAGE_MAX_BYTES,
  BARANG_IMAGE_MAX_DIMENSION,
  validateBarangImage,
} from "@/lib/barang/image";
import { id as strings } from "@/lib/i18n/id";

/**
 * components/dashboard/barang/barang-image-field.tsx — TT04 (diupgrade 11
 * September 2026, instruksi CEO langsung: "kamera langsung terbuka").
 * Kamera diminta OTOMATIS saat layar tambah barang dibuka (getUserMedia
 * bawaan browser, BUKAN library baru -- CLAUDE.md melarang dependency
 * tanpa izin) dan TETAP HIDUP antar barang (stream tidak dihentikan saat
 * `reset()` dipanggil) supaya "Simpan & Tambah Lagi" benar-benar langsung
 * siap jepret lagi, bukan minta izin kamera ulang tiap barang.
 *
 * Fallback ke <input type="file" accept="image/*"> (pola lama T09c) kalau
 * getUserMedia gagal/tidak tersedia (desktop tanpa kamera, izin ditolak,
 * konteks bukan HTTPS/localhost) -- supaya layar tetap bisa dipakai, cuma
 * tidak secepat kamera langsung.
 */
export type BarangImageFieldHandle = { reset: () => void };

async function canvasToCompressedFile(canvas: HTMLCanvasElement): Promise<File> {
  const qualitySteps = [0.85, 0.75, 0.65, 0.55, 0.45];
  let blob: Blob | null = null;
  for (const quality of qualitySteps) {
    blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality)
    );
    if (blob && blob.size <= BARANG_IMAGE_MAX_BYTES) break;
  }
  if (!blob) {
    throw new Error("Gagal mengompres gambar");
  }
  return new File([blob], "barang.jpg", { type: "image/jpeg" });
}

async function compressPickedFile(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const longestSide = Math.max(bitmap.width, bitmap.height);
  const scale = Math.min(1, BARANG_IMAGE_MAX_DIMENSION / longestSide);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas tidak didukung di browser ini");
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvasToCompressedFile(canvas);
}

export const BarangImageField = forwardRef<BarangImageFieldHandle, { barangName: string }>(
  function BarangImageField({ barangName }, ref) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const pickerInputRef = useRef<HTMLInputElement>(null);

    const [cameraState, setCameraState] = useState<"starting" | "live" | "unavailable">(
      "starting"
    );
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [isBusy, setIsBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
      let cancelled = false;
      navigator.mediaDevices
        ?.getUserMedia({ video: { facingMode: "environment" }, audio: false })
        .then((stream) => {
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          streamRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play().catch(() => {});
          }
          setCameraState("live");
        })
        .catch(() => {
          if (!cancelled) setCameraState("unavailable");
        });
      return () => {
        cancelled = true;
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      };
    }, []);

    useImperativeHandle(ref, () => ({
      reset() {
        // Cuma still preview yang dikosongkan -- stream kamera TETAP hidup
        // supaya barang berikutnya langsung siap jepret (§7 SPESIFIKASI).
        setPreviewUrl(null);
        setError(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
      },
    }));

    async function handleCapture() {
      const video = videoRef.current;
      if (!video || video.videoWidth === 0) return;
      setError(null);
      setIsBusy(true);
      try {
        const longestSide = Math.max(video.videoWidth, video.videoHeight);
        const scale = Math.min(1, BARANG_IMAGE_MAX_DIMENSION / longestSide);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas tidak didukung di browser ini");
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const file = await canvasToCompressedFile(canvas);
        const validationError = validateBarangImage(file);
        if (validationError) {
          setError(validationError);
          return;
        }
        const dt = new DataTransfer();
        dt.items.add(file);
        if (fileInputRef.current) fileInputRef.current.files = dt.files;
        setPreviewUrl(URL.createObjectURL(file));
      } catch {
        setError(strings.barang.imageTypeError);
      } finally {
        setIsBusy(false);
      }
    }

    async function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
      const file = e.target.files?.[0];
      if (!file) return;
      setError(null);
      setIsBusy(true);
      try {
        const compressed = await compressPickedFile(file);
        const validationError = validateBarangImage(compressed);
        if (validationError) {
          setError(validationError);
          return;
        }
        const dt = new DataTransfer();
        dt.items.add(compressed);
        if (fileInputRef.current) fileInputRef.current.files = dt.files;
        setPreviewUrl(URL.createObjectURL(compressed));
      } catch {
        setError(strings.barang.imageTypeError);
      } finally {
        setIsBusy(false);
        if (pickerInputRef.current) pickerInputRef.current.value = "";
      }
    }

    function handleRetake() {
      setPreviewUrl(null);
      setError(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }

    return (
      <div className="flex flex-col gap-2">
        <Label>{strings.barang.imageSection}</Label>
        <input ref={fileInputRef} type="file" name="imageFile" className="hidden" />
        <input type="hidden" name="imageRemoved" value="0" />
        <input
          ref={pickerInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handlePick}
        />

        {previewUrl ? (
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- preview lokal (object URL) */}
            <img
              src={previewUrl}
              alt=""
              className="aspect-square w-28 shrink-0 rounded-md object-cover"
            />
            <Button type="button" variant="outline" size="sm" onClick={handleRetake}>
              {strings.barang.imageRetakeButton}
            </Button>
          </div>
        ) : cameraState === "live" ? (
          <div className="flex items-center gap-4">
            <video
              ref={videoRef}
              muted
              playsInline
              className="aspect-square w-28 shrink-0 rounded-md bg-black object-cover"
            />
            <div className="flex flex-col gap-2">
              <Button type="button" size="sm" disabled={isBusy} onClick={handleCapture}>
                {isBusy ? strings.barang.imageCompressing : strings.barang.imageCaptureButton}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => pickerInputRef.current?.click()}
              >
                {strings.barang.imageChooseButton}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <div className="w-28 shrink-0">
              <ProductInitialsAvatar name={barangName || "?"} />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isBusy}
              onClick={() => pickerInputRef.current?.click()}
            >
              {isBusy ? strings.barang.imageCompressing : strings.barang.imageChooseButton}
            </Button>
          </div>
        )}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    );
  }
);
