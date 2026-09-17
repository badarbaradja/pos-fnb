"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ProductInitialsAvatar } from "@/components/products/product-initials-avatar";
import {
  PRODUCT_IMAGE_MAX_BYTES,
  PRODUCT_IMAGE_MAX_DIMENSION,
  validateProductImage,
} from "@/lib/products/image";
import { compressImageToJpeg } from "@/lib/utils/compress-image";
import { id as strings } from "@/lib/i18n/id";

/**
 * Kompresi client-side murni kenyamanan -- lib/products/image.ts#validateProductImage
 * dipanggil ULANG di server (saveProduct) sebagai penegakan sungguhan
 * (CLAUDE.md, diminta eksplisit "bukan hanya di client"). Fungsi
 * kompresinya sendiri dipindah ke lib/utils/compress-image.ts (Langkah D)
 * supaya dipakai ULANG oleh CameraCapture, bukan disalin.
 */
async function compressImage(file: File): Promise<File> {
  const blob = await compressImageToJpeg(file, PRODUCT_IMAGE_MAX_DIMENSION, PRODUCT_IMAGE_MAX_BYTES);
  return new File([blob], "product.jpg", { type: "image/jpeg" });
}

export function ProductImageField({
  currentImageUrl,
  productName,
}: {
  currentImageUrl: string | null;
  productName: string;
}) {
  // fileInputRef: hidden input yang BENAR-BENAR ikut ke FormData saat form
  // di-submit (name="imageFile") -- isinya disuntik lewat DataTransfer
  // setelah kompresi, bukan file mentah dari picker. pickerInputRef:
  // input file yang user benar-benar lihat/klik lewat tombol.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pickerInputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentImageUrl);
  const [isCompressing, setIsCompressing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);

  async function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setIsCompressing(true);
    try {
      const compressed = await compressImage(file);
      const validationError = validateProductImage(compressed);
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
      setError(strings.products.imageTypeError);
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
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Label>{strings.products.imageSection}</Label>
      <div className="flex items-center gap-4">
        <div className="w-24 shrink-0">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- preview lokal (object URL) & signed URL Supabase, bukan aset Next static
            <img
              src={previewUrl}
              alt=""
              className="aspect-square w-full rounded-md object-cover"
            />
          ) : (
            <ProductInitialsAvatar name={productName || "?"} />
          )}
        </div>
        <div className="flex flex-col gap-2">
          <input ref={fileInputRef} type="file" name="imageFile" className="hidden" />
          <input
            ref={pickerInputRef}
            type="file"
            accept="image/*"
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
              ? strings.products.imageCompressing
              : previewUrl
                ? strings.products.imageChangeButton
                : strings.products.imageChooseButton}
          </Button>
          {previewUrl ? (
            <Button type="button" variant="ghost" size="sm" onClick={handleRemove}>
              {strings.products.imageRemoveButton}
            </Button>
          ) : null}
          <p className="text-xs text-muted-foreground">{strings.products.imageHint}</p>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}
