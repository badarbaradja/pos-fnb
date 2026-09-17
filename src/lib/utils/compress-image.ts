/**
 * lib/utils/compress-image.ts — Langkah D (17 September 2026), diambil
 * dari implementasi yang sudah ada di product-image-field.tsx (T09c) dan
 * dijadikan util bersama supaya dipakai ULANG oleh CameraCapture, bukan
 * disalin -- instruksi eksplisit CEO ("kompresi pakai yang sudah ada").
 *
 * Kompresi client-side murni kenyamanan -- penegakan sungguhan (ukuran
 * maksimum, tipe file) selalu di server, sama prinsip
 * lib/products/image.ts#validateProductImage (CLAUDE.md §3.4).
 */
export async function compressImageToJpeg(
  source: Blob,
  maxDimension: number,
  maxBytes: number
): Promise<Blob> {
  const bitmap = await createImageBitmap(source);
  const longestSide = Math.max(bitmap.width, bitmap.height);
  const scale = Math.min(1, maxDimension / longestSide); // jangan upscale gambar kecil
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Canvas tidak didukung di browser ini");
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  // Turunkan kualitas bertahap sampai <=maxBytes atau kehabisan percobaan
  // -- cap iterasi supaya tidak bisa nyangkut, bukan while(true).
  const qualitySteps = [0.85, 0.75, 0.65, 0.55, 0.45];
  let blob: Blob | null = null;
  for (const quality of qualitySteps) {
    blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality)
    );
    if (blob && blob.size <= maxBytes) break;
  }
  if (!blob) {
    throw new Error("Gagal mengompres gambar");
  }
  return blob;
}
