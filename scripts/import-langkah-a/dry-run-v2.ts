import { readFileSync } from "fs";
import { join } from "path";

/**
 * Dry-run v2 -- setelah semua keputusan CEO 2026-09-15 diterapkan:
 * - 19 satuan ambigu diselesaikan (baca dari nama / sinonim / jawaban eksplisit)
 * - Topping Extra (17) + Tambahan (11) -> MODIFIER, bukan products
 * - id 461 "Mie Bestie" (Indosteak) -> duplikat, di-skip (impor id 460 saja)
 * - id 423, 424 -> nama diubah untuk disambiguasi "Kopi 1 Liter"
 * - add on gula 30%/50% -> modifier harga 0
 */

function parseCsv<T extends Record<string, string>>(text: string): T[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const header = splitCsvLine(lines[0]!);
  const rows: T[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]!);
    const row: Record<string, string> = {};
    header.forEach((h, idx) => (row[h] = (cols[idx] ?? "").trim()));
    // Lihat catatan yang sama di analyze.ts -- semua kolom header selalu
    // terisi (string kosong kalau memang kosong), assert ke bentuk yang
    // sudah diverifikasi manual di pemanggil.
    rows.push(row as T);
  }
  return rows;
}
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

type MaterialRow = { id: string; name: string; harga_beli: string; satuan: string };
type ProdukRow = {
  id: string;
  name: string;
  category: string;
  resto: string;
  harga_jual: string;
  note: string;
};

const materials = parseCsv<MaterialRow>(readFileSync(join(__dirname, "material.csv"), "utf-8"));
const produk = parseCsv<ProdukRow>(readFileSync(join(__dirname, "produk.csv"), "utf-8"));

const UNIT_NORMALIZE: Record<string, string> = {
  porsi: "porsi",
  gr: "gram",
  gram: "gram",
  g: "gram",
  pcs: "pcs",
  ml: "ml",
  liter: "liter",
  kg: "kg",
  dirgen: "dirigen",
  dergen: "dirigen",
  botol: "botol",
  kotak: "kotak",
  bungkus: "bungkus",
  pack: "pack",
  pck: "pack",
  pak: "pack",
};
// Jawaban CEO 2026-09-15 untuk 19 baris yang sebelumnya ambigu (per id).
const UNIT_OVERRIDE_BY_ID: Record<string, string> = {
  "50": "porsi",
  "56": "gram",
  "86": "porsi",
  "185": "gram",
  "235": "gram",
  "242": "gram",
  "279": "pcs",
  "299": "porsi",
  "345": "porsi",
  "347": "porsi",
  "348": "porsi",
  "352": "botol",
  "353": "pcs",
  "358": "ml",
  "373": "pcs",
  "388": "gram",
  "430": "pcs",
  "458": "pcs",
  "497": "porsi",
};

export type ResolvedIngredient = { id: string; name: string; unit: string };
export const resolvedIngredients: ResolvedIngredient[] = [];
const stillUnresolved: string[] = [];

for (const row of materials) {
  if (UNIT_OVERRIDE_BY_ID[row.id]) {
    resolvedIngredients.push({ id: row.id, name: row.name, unit: UNIT_OVERRIDE_BY_ID[row.id]! });
    continue;
  }
  const raw = row.satuan.replace(/\xa0/g, " ").trim().toLowerCase();
  if (UNIT_NORMALIZE[raw]) {
    resolvedIngredients.push({ id: row.id, name: row.name, unit: UNIT_NORMALIZE[raw]! });
    continue;
  }
  stillUnresolved.push(`[${row.id}] ${row.name} -- satuan="${row.satuan}"`);
}

console.log("=".repeat(70));
console.log("DRY RUN v2 -- MATERIAL");
console.log("=".repeat(70));
console.log(`Total: ${materials.length}, resolved: ${resolvedIngredients.length}, MASIH BELUM JELAS: ${stillUnresolved.length}`);
for (const u of stillUnresolved) console.log("  !! " + u);

const unitCounts = new Map<string, number>();
for (const r of resolvedIngredients) unitCounts.set(r.unit, (unitCounts.get(r.unit) ?? 0) + 1);
console.log("\n-- Distribusi satuan final --");
for (const [u, c] of [...unitCounts.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${u}: ${c}`);

// ==== Produk ====
const TOPPING_TAMBAHAN_CATEGORIES = new Set(["Topping Extra", "Tambahan"]);
const RENAME: Record<string, string> = {
  "423": "Butterscotch Latte 1 Liter",
  "424": "Jasmine Honey Latte 1 Liter",
};
const SKIP_IDS = new Set(["461"]); // duplikat persis dari 460

type ProductRow = (typeof produk)[number];
export const productsToImport: ProductRow[] = [];
export const modifierRows: ProductRow[] = [];

for (const row of produk) {
  if (SKIP_IDS.has(row.id)) continue;
  if (TOPPING_TAMBAHAN_CATEGORIES.has(row.category)) {
    modifierRows.push(row);
    continue;
  }
  const renamed = RENAME[row.id];
  productsToImport.push(renamed ? { ...row, name: renamed } : row);
}

console.log("\n" + "=".repeat(70));
console.log("DRY RUN v2 -- PRODUK");
console.log("=".repeat(70));
console.log(`Total baris produk.csv: ${produk.length}`);
console.log(`-> jadi PRODUCTS: ${productsToImport.length}`);
console.log(`-> jadi MODIFIER (Topping Extra + Tambahan): ${modifierRows.length}`);
console.log(`-> di-skip (duplikat, id 461): ${SKIP_IDS.size}`);
console.log(`Cek total: ${productsToImport.length + modifierRows.length + SKIP_IDS.size} (harus = ${produk.length})`);

const catSet = new Set(productsToImport.map((r) => r.category));
console.log(`\n-- Kategori produk final (distinct): ${catSet.size} --`);
for (const c of [...catSet].sort()) console.log(`  ${c}`);

console.log("\n-- Grup modifier yang akan dibuat --");
const gulaIds = new Set(["326", "327"]);
const indokopiTopping = modifierRows.filter((r) => r.category === "Topping Extra" && !gulaIds.has(r.id));
const gula = modifierRows.filter((r) => gulaIds.has(r.id));
const tambahanIndosteak = modifierRows.filter((r) => r.category === "Tambahan" && r.resto === "Indosteak");
const tambahanIndokopi = modifierRows.filter((r) => r.category === "Tambahan" && r.resto === "Indokopi");
const tambahanIndokopiLite = modifierRows.filter((r) => r.category === "Tambahan" && r.resto === "Indokopi Lite");
console.log(`  Topping Extra - Indokopi: ${indokopiTopping.length} item`);
console.log(`  Level Gula - Indokopi: ${gula.length} item (harga dipaksa 0)`);
console.log(`  Tambahan - Indosteak: ${tambahanIndosteak.length} item`);
console.log(`  Tambahan - Indokopi: ${tambahanIndokopi.length} item`);
console.log(`  Tambahan - Indokopi Lite: ${tambahanIndokopiLite.length} item`);
const totalModifierCheck =
  indokopiTopping.length + gula.length + tambahanIndosteak.length + tambahanIndokopi.length + tambahanIndokopiLite.length;
console.log(`  Cek total: ${totalModifierCheck} (harus = ${modifierRows.length})`);

const restoCounts = new Map<string, number>();
for (const r of productsToImport) restoCounts.set(r.resto, (restoCounts.get(r.resto) ?? 0) + 1);
console.log("\n-- Resto (produk final) --");
for (const [r, c] of restoCounts) console.log(`  ${r}: ${c}`);
