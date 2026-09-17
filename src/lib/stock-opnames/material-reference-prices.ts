import { readFileSync } from "fs";
import { join } from "path";
import { and, eq } from "drizzle-orm";
import type { UserDbHandle } from "@/lib/db/client";
import { ingredients } from "@/lib/db/schema";

/**
 * lib/stock-opnames/material-reference-prices.ts — Langkah C poin c.
 *
 * material.csv (scripts/import-langkah-a/, disimpan sebagai jejak audit
 * Langkah A -- lihat docs/RENCANA-PEMBANGUNAN-KASIR-THRIFTING.md §36) jadi
 * SATU-SATUNYA sumber saran harga awal untuk opname pertama, dibaca
 * langsung dari file yang sama (bukan disalin ke tabel/JSON kedua) --
 * kalau ada harga yang kelihatan aneh, tetap ada SATU tempat untuk
 * menelusurinya, bukan dua sumber yang bisa diam-diam tidak sinkron.
 *
 * Dicocokkan lewat NAMA bahan, EKSAK -- ingredients.name diisi verbatim
 * dari material.csv "name" saat Langkah A (run-import.ts), jadi
 * pencocokan ini dijamin 1:1 untuk 225 bahan itu. Bahan yang dibuat
 * setelah Langkah A (nama baru, tidak ada di CSV) TIDAK dapat saran
 * harga dari sini -- itu benar, bukan bug: file ini cuma jejak SATU
 * titik waktu impor, bukan katalog harga yang terus diperbarui.
 *
 * Dipanggil hanya saat MEMBUAT/MEMBUKA sesi opname (menyiapkan saran
 * harga untuk direview manusia) -- TIDAK PERNAH dipakai sebagai sumber
 * kebenaran harga permanen di ingredients (keputusan Langkah A: harga
 * bahan tidak pernah disimpan di situ).
 */

const MATERIAL_CSV_PATH = join(process.cwd(), "scripts", "import-langkah-a", "material.csv");

function parseMaterialCsv(text: string): Map<string, string> {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const header = lines[0]?.split(",") ?? [];
  const nameIdx = header.indexOf("name");
  const priceIdx = header.indexOf("harga_beli");
  const byName = new Map<string, string>();
  if (nameIdx === -1 || priceIdx === -1) return byName;

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i]!.split(",");
    const name = cols[nameIdx]?.trim();
    const price = cols[priceIdx]?.trim();
    if (name && price) {
      byName.set(name, price);
    }
  }
  return byName;
}

let cachedPricesByName: Map<string, string> | null = null;

/**
 * Baca material.csv sekali per proses server (di-cache di memori -- file
 * ini statis, jejak satu titik waktu, tidak pernah berubah saat runtime).
 * Kalau file tidak ada (mis. lingkungan yang tidak menyertakan folder
 * scripts/), balikkan Map kosong -- saran harga cuma jadi tidak ada,
 * bukan error yang menghentikan pembuatan sesi opname.
 */
export function loadMaterialReferencePricesByName(): Map<string, string> {
  if (cachedPricesByName) return cachedPricesByName;
  try {
    const text = readFileSync(MATERIAL_CSV_PATH, "utf-8");
    cachedPricesByName = parseMaterialCsv(text);
  } catch {
    cachedPricesByName = new Map();
  }
  return cachedPricesByName;
}

/**
 * Resolve saran harga per ingredientId (bukan nama) untuk satu bisnis --
 * dipakai langsung oleh getOpnameItemsForSession sebagai `hargaDefault`.
 */
export async function getMaterialReferencePricesByIngredientId(
  db: UserDbHandle["db"],
  businessId: string
): Promise<Map<string, string>> {
  const pricesByName = loadMaterialReferencePricesByName();
  if (pricesByName.size === 0) return new Map();

  const rows = await db
    .select({ id: ingredients.id, name: ingredients.name })
    .from(ingredients)
    .where(and(eq(ingredients.businessId, businessId), eq(ingredients.isActive, true)));

  const byIngredientId = new Map<string, string>();
  for (const row of rows) {
    const price = pricesByName.get(row.name);
    if (price) {
      byIngredientId.set(row.id, price);
    }
  }
  return byIngredientId;
}
