"use client";

import { useImperativeHandle, useRef, useState, forwardRef } from "react";
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
 * components/dashboard/barang/barang-image-field.tsx — TT04. Kompresi
 * client-side, pola SAMA PERSIS components/dashboard/products/
 * product-image-field.tsx (T09c) -- lihat komentar di sana soal kenapa
 * cuma <input type="file" accept="image/*"> (bukan getUserMedia/<video>):
 * di HP, accept="image/*" sendirian sudah membuka kamera/galeri OS, dan
 * ini satu-satunya mekanisme "kamera" di seluruh pos-fnb sampai sekarang.
 *
 * BEDA dari versi produk: expose imperative handle `reset()` supaya form
 * tambah-cepat (barang-intake-form.tsx) bisa mengosongkan gambar SETELAH
 * satu barang tersimpan tanpa remount seluruh form (yang akan ikut
 * mengosongkan pemilik/kategori yang sengaja dipertahankan, §7).
 */
export type BarangImageFieldHandle = { reset: () => void };

async function compressImage(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const longestSide = Math.max(bitmap.width, bitmap.height);
  const scale = Math.min(1, BARANG_IMAGE_MAX_DIMENSION / longestSide);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas tidak didukung di browser ini");
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

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

export const BarangImageField = forwardRef<
  BarangImageFieldHandle,
  { currentImageUrl?: string | null; barangName: string }
>(function BarangImageField({ currentImageUrl = null, barangName }, ref) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pickerInputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentImageUrl);
  const [isCompressing, setIsCompressing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);

  useImperativeHandle(ref, () => ({
    reset() {
      setPreviewUrl(null);
      setRemoved(false);
      setError(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
  }));

  async function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setIsCompressing(true);
    try {
      const compressed = await compressImage(file);
      const validationError = validateBarangImage(compressed);
      if (validationError) {
        setError(validationError);
        return;
      }
      const dt = new DataTransfer();
      dt.items.add(compressed);
      if (fileInputRef.current) {
        fileInputRef.current.files = dt.files;
      }
      setPreviewUrl(URL.createObjectURL(compressed));
      setRemoved(false);
    } catch {
      setError(strings.barang.imageTypeError);
    } finally {
      setIsCompressing(false);
      if (pickerInputRef.current) {
        pickerInputRef.current.value = "";
      }
    }
  }

  function handleRemove() {
    setPreviewUrl(null);
    setRemoved(true);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="flex flex-col gap-2">
      <Label>{strings.barang.imageSection}</Label>
      <div className="flex items-center gap-4">
        <div className="w-24 shrink-0">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- preview lokal (object URL) & signed URL Supabase
            <img
              src={previewUrl}
              alt=""
              className="aspect-square w-full rounded-md object-cover"
            />
          ) : (
            <ProductInitialsAvatar name={barangName || "?"} />
          )}
        </div>
        <div className="flex flex-col gap-2">
          <input ref={fileInputRef} type="file" name="imageFile" className="hidden" />
          <input
            ref={pickerInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handlePick}
          />
          <input type="hidden" name="imageRemoved" value={removed ? "1" : "0"} />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isCompressing}
            onClick={() => pickerInputRef.current?.click()}
          >
            {isCompressing
              ? strings.barang.imageCompressing
              : previewUrl
                ? strings.barang.imageChangeButton
                : strings.barang.imageChooseButton}
          </Button>
          {previewUrl ? (
            <Button type="button" variant="ghost" size="sm" onClick={handleRemove}>
              {strings.barang.imageRemoveButton}
            </Button>
          ) : null}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
      </div>
    </div>
  );
});
