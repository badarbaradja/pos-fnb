import { readFileSync } from "fs";
import { join } from "path";

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const header = splitCsvLine(lines[0]!);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]!);
    const row: Record<string, string> = {};
    header.forEach((h, idx) => (row[h] = (cols[idx] ?? "").trim()));
    rows.push(row);
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

const materialCsv = readFileSync(join(__dirname, "material.csv"), "utf-8");
const produkCsv = readFileSync(join(__dirname, "produk.csv"), "utf-8");

const materials = parseCsv(materialCsv);
const produk = parseCsv(produkCsv);

// ==== 1. Normalisasi satuan material ====
// Peta HANYA untuk variasi kapitalisasi/spasi/singkatan yang jelas TIDAK
// ambigu terhadap satu satuan dasar yang sama. Tidak menebak makna baru.
const UNIT_NORMALIZE: Record<string, string> = {
  porsi: "porsi",
  gr: "gram",
  gram: "gram",
  g: "gram",
  pcs: "pcs",
  ml: "ml",
  liter: "liter",
  kg: "kg",
  dirgen: "dirigen", // varian ejaan yang sama, bukan satuan berbeda
  dergen: "dirigen",
  botol: "botol",
  kotak: "kotak",
  bungkus: "bungkus",
  pack: "pack",
  pck: "pack",
  pak: "pack",
};

type MaterialRow = (typeof materials)[number];
const normalized: { row: MaterialRow; unit: string }[] = [];
const ambiguous: { row: MaterialRow; rawUnit: string; reason: string }[] = [];

for (const row of materials) {
  const raw = row.satuan.replace(/\xa0/g, " ").trim();
  const key = raw.toLowerCase();

  if (raw === "" ) {
    ambiguous.push({ row, rawUnit: raw, reason: "satuan kosong" });
    continue;
  }
  if (UNIT_NORMALIZE[key]) {
    normalized.push({ row, unit: UNIT_NORMALIZE[key]! });
    continue;
  }
  // Variasi "per X" / "X/pcs" dst -- SEMUA ini sengaja TIDAK ditebak, karena
  // makna sebenarnya (apakah base unit atau catatan takaran resep) tidak
  // jelas dari teks saja.
  ambiguous.push({ row, rawUnit: raw, reason: "tidak ada di peta satuan yang jelas" });
}

console.log("=".repeat(70));
console.log("LANGKAH A -- LAPORAN NORMALISASI SATUAN MATERIAL");
console.log("=".repeat(70));
console.log(`Total material: ${materials.length}`);
console.log(`Bisa dinormalisasi otomatis (tidak ambigu): ${normalized.length}`);
console.log(`AMBIGU -- perlu keputusan CEO: ${ambiguous.length}`);

const unitCounts = new Map<string, number>();
for (const n of normalized) unitCounts.set(n.unit, (unitCounts.get(n.unit) ?? 0) + 1);
console.log("\n-- Satuan hasil normalisasi (jumlah baris) --");
for (const [unit, cnt] of [...unitCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${unit}: ${cnt}`);
}

console.log("\n-- DAFTAR AMBIGU (nama material + satuan asli + alasan) --");
for (const a of ambiguous) {
  console.log(`  [${a.row.id}] "${a.row.name}" -- satuan asli: "${a.rawUnit}" (${a.reason})`);
}

// ==== 2. Harga tidak valid ====
console.log("\n-- Harga beli tidak valid (bukan angka / negatif) --");
let badPriceCount = 0;
for (const row of materials) {
  const n = Number(row.harga_beli);
  if (row.harga_beli === "" || Number.isNaN(n) || n < 0) {
    console.log(`  [${row.id}] "${row.name}" -- harga_beli="${row.harga_beli}"`);
    badPriceCount++;
  }
}
if (badPriceCount === 0) console.log("  (tidak ada)");

// ==== 3. Duplikat nama material ====
const nameCounts = new Map<string, number>();
for (const row of materials) nameCounts.set(row.name, (nameCounts.get(row.name) ?? 0) + 1);
const dupNames = [...nameCounts.entries()].filter(([, c]) => c > 1);
console.log(`\n-- Nama material duplikat (persis sama): ${dupNames.length} --`);
for (const [name, c] of dupNames) console.log(`  "${name}" x${c}`);

// ==== 4. Produk: kategori & resto ====
console.log("\n" + "=".repeat(70));
console.log("LANGKAH A -- LAPORAN PRODUK");
console.log("=".repeat(70));
console.log(`Total baris produk: ${produk.length}`);

const catCounts = new Map<string, number>();
for (const row of produk) catCounts.set(row.category, (catCounts.get(row.category) ?? 0) + 1);
console.log("\n-- Kategori (jumlah produk) --");
for (const [cat, cnt] of [...catCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${cat}: ${cnt}`);
}

const restoCounts = new Map<string, number>();
for (const row of produk) restoCounts.set(row.resto, (restoCounts.get(row.resto) ?? 0) + 1);
console.log("\n-- Resto (jumlah produk) --");
for (const [resto, cnt] of [...restoCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${resto}: ${cnt}`);
}

// Topping Extra / Tambahan detail
console.log("\n-- Isi kategori 'Topping Extra' --");
for (const row of produk.filter((r) => r.category === "Topping Extra")) {
  console.log(`  [${row.id}] ${row.name} (${row.resto}) Rp${row.harga_jual}`);
}
console.log("\n-- Isi kategori 'Tambahan' --");
for (const row of produk.filter((r) => r.category === "Tambahan")) {
  console.log(`  [${row.id}] ${row.name} (${row.resto}) Rp${row.harga_jual}`);
}

// Promo Agustus / September detail
console.log("\n-- Isi kategori 'Promo Agustus' --");
for (const row of produk.filter((r) => r.category === "Promo Agustus")) {
  console.log(`  [${row.id}] ${row.name} (${row.resto}) Rp${row.harga_jual} note="${row.note}"`);
}
console.log("\n-- Isi kategori 'Promo September' --");
for (const row of produk.filter((r) => r.category === "Promo September")) {
  console.log(`  [${row.id}] ${row.name} (${row.resto}) Rp${row.harga_jual} note="${row.note}"`);
}
console.log("\n-- Isi kategori 'Promo' (beda dari 'Promo Agustus'/'Promo September') --");
for (const row of produk.filter((r) => r.category === "Promo")) {
  console.log(`  [${row.id}] ${row.name} (${row.resto}) Rp${row.harga_jual} note="${row.note}"`);
}

// Harga tidak valid
console.log("\n-- Harga jual tidak valid (bukan angka / negatif / nol mencurigakan) --");
let badSalePriceCount = 0;
for (const row of produk) {
  const n = Number(row.harga_jual);
  if (row.harga_jual === "" || Number.isNaN(n) || n < 0) {
    console.log(`  [${row.id}] "${row.name}" -- harga_jual="${row.harga_jual}"`);
    badSalePriceCount++;
  }
}
if (badSalePriceCount === 0) console.log("  (tidak ada nilai yang gagal parse)");
console.log("\n-- Harga jual = 1 (kemungkinan bug data sumber, bukan harga sungguhan) --");
for (const row of produk) {
  if (Number(row.harga_jual) === 1) {
    console.log(`  [${row.id}] "${row.name}" (${row.category}, ${row.resto})`);
  }
}

// Duplikat nama+resto (nama sama DAN resto sama -- kandidat re-entry ganda)
const nameRestoCounts = new Map<string, string[]>();
for (const row of produk) {
  const key = `${row.name}|||${row.resto}`;
  const list = nameRestoCounts.get(key) ?? [];
  list.push(row.id);
  nameRestoCounts.set(key, list);
}
const dupNameResto = [...nameRestoCounts.entries()].filter(([, ids]) => ids.length > 1);
console.log(`\n-- Nama+resto duplikat persis (kandidat baris ganda): ${dupNameResto.length} --`);
for (const [key, ids] of dupNameResto) {
  const [name, resto] = key.split("|||");
  console.log(`  "${name}" (${resto}) -- id: ${ids.join(", ")}`);
}

// Resto value sanity check -- pastikan cuma 3 nilai yang kita kenal
const knownResto = new Set(["Indosteak", "Indokopi", "Indokopi Lite"]);
const unknownResto = produk.filter((r) => !knownResto.has(r.resto));
console.log(`\n-- Nilai kolom resto di luar 3 yang dikenal: ${unknownResto.length} --`);
for (const row of unknownResto) console.log(`  [${row.id}] resto="${row.resto}"`);

console.log("\n" + "=".repeat(70));
console.log("RINGKASAN CEPAT");
console.log("=".repeat(70));
console.log(`Material: ${materials.length} baris, ${normalized.length} siap impor, ${ambiguous.length} perlu keputusan satuan`);
console.log(`Produk: ${produk.length} baris, kategori Topping Extra=${catCounts.get("Topping Extra") ?? 0}, Tambahan=${catCounts.get("Tambahan") ?? 0}, Promo Agustus=${catCounts.get("Promo Agustus") ?? 0}, Promo September=${catCounts.get("Promo September") ?? 0}`);
