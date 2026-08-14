/**
 * Fallback visual untuk produk tanpa gambar (T09c) -- inisial + warna
 * deterministik dari nama produk (BUKAN acak, supaya produk yang sama
 * selalu tampil dengan warna yang sama tiap render). Dipakai di grid
 * kasir (product-card.tsx) dan preview form dashboard (product-image-field.tsx)
 * lewat komponen bersama ProductInitialsAvatar.
 */

export function getProductInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** HSL langsung (bukan kelas Tailwind) supaya tidak perlu palet dark-mode manual. */
export function getProductAvatarColors(name: string): { background: string; foreground: string } {
  const hue = hashString(name) % 360;
  return {
    background: `hsl(${hue}, 55%, 90%)`,
    foreground: `hsl(${hue}, 45%, 32%)`,
  };
}
