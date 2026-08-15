import { create } from "zustand";
import { Decimal } from "decimal.js";
import { generateId } from "../utils/id";

/**
 * Keranjang order di layar kasir (T12). In-memory saja, tidak di-persist --
 * order beneran baru ditulis ke DB di T13 (tombol Bayar). `id` tiap baris
 * dibuat pakai generateId() (UUID v7) bukan crypto.randomUUID() biasa,
 * supaya begitu T13 menyambungkan penyimpanan, id yang sama bisa langsung
 * jadi order_items.id tanpa perlu diregenerasi (CLAUDE.md §3.4: id
 * order/order_items wajib di-generate di client).
 */

export type SelectedModifier = {
  modifierId: string;
  name: string;
  price: Decimal; // harga per unit, snapshot saat dipilih
};

export type CartLine = {
  id: string;
  productId: string;
  productName: string;
  categoryName: string | null;
  variantId: string | null;
  variantName: string | null;
  // TIDAK ada unitPrice di sini dengan sengaja. Order belum dibayar (Bayar
  // masih dinonaktifkan, T13) berarti belum ada apa pun yang final --
  // harga produk baris ini di-resolve LIVE dari katalog + tingkat harga
  // yang sedang dipilih, di lib/pos/calc-adapter.ts, setiap kali
  // calculateOrder() dipanggil. Ini yang bikin ganti tingkat harga bisa
  // langsung menyesuaikan harga baris yang sudah ada di keranjang.
  modifiers: SelectedModifier[];
  qty: Decimal;
  itemDiscount: Decimal; // nominal, belum persen (lihat percakapan T12)
  isTaxable: boolean;
  note: string;
};

export type DiscountType = "none" | "amount" | "percent";

export type NewCartLine = Omit<CartLine, "id" | "itemDiscount" | "note"> & {
  itemDiscount?: Decimal;
  note?: string;
};

type CartState = {
  lines: CartLine[];
  discountType: DiscountType;
  orderDiscountAmount: Decimal; // nominal
  orderDiscountPercentInput: Decimal; // skala 0-100 (mis. 10 untuk 10%), sama
  // konvensi dengan outlets.tax_percent -- konversi ke pecahan dilakukan di
  // lib/pos/calc-adapter.ts, bukan di sini (docs/03-CALC-SPEC.md A.1).
  addLine: (line: NewCartLine) => void;
  removeLine: (id: string) => void;
  setQty: (id: string, qty: Decimal) => void;
  setItemDiscount: (id: string, amount: Decimal) => void;
  setNote: (id: string, note: string) => void;
  setDiscountType: (type: DiscountType) => void;
  setOrderDiscountAmount: (amount: Decimal) => void;
  setOrderDiscountPercentInput: (percent: Decimal) => void;
  clear: () => void;
};

/**
 * Dua baris digabung (qty dijumlahkan) kalau product_id, variant_id, SET
 * modifier, catatan, dan diskon item semuanya sama -- kalau ada satu saja
 * beda (mis. catatan "tanpa gula" vs kosong), tetap baris terpisah. Modifier
 * dibandingkan sebagai SET (urutan pilih tidak masalah), bukan array
 * berurutan.
 */
function sameModifierSet(a: SelectedModifier[], b: SelectedModifier[]): boolean {
  if (a.length !== b.length) return false;
  const aIds = a.map((m) => m.modifierId).sort();
  const bIds = b.map((m) => m.modifierId).sort();
  return aIds.every((id, i) => id === bIds[i]);
}

function findMergeableLine(lines: CartLine[], candidate: CartLine): CartLine | undefined {
  return lines.find(
    (l) =>
      l.productId === candidate.productId &&
      l.variantId === candidate.variantId &&
      l.note === candidate.note &&
      l.itemDiscount.equals(candidate.itemDiscount) &&
      sameModifierSet(l.modifiers, candidate.modifiers)
  );
}

export const useCartStore = create<CartState>((set) => ({
  lines: [],
  discountType: "none",
  orderDiscountAmount: new Decimal(0),
  orderDiscountPercentInput: new Decimal(0),

  addLine: (line) =>
    set((state) => {
      const candidate: CartLine = {
        ...line,
        id: generateId(),
        itemDiscount: line.itemDiscount ?? new Decimal(0),
        note: line.note ?? "",
      };

      const existing = findMergeableLine(state.lines, candidate);
      if (existing) {
        return {
          lines: state.lines.map((l) =>
            l.id === existing.id ? { ...l, qty: l.qty.plus(candidate.qty) } : l
          ),
        };
      }

      return { lines: [...state.lines, candidate] };
    }),

  removeLine: (id) =>
    set((state) => ({ lines: state.lines.filter((l) => l.id !== id) })),

  setQty: (id, qty) =>
    set((state) => ({
      lines: state.lines.map((l) => (l.id === id ? { ...l, qty } : l)),
    })),

  setItemDiscount: (id, amount) =>
    set((state) => ({
      lines: state.lines.map((l) =>
        l.id === id ? { ...l, itemDiscount: amount } : l
      ),
    })),

  setNote: (id, note) =>
    set((state) => ({
      lines: state.lines.map((l) => (l.id === id ? { ...l, note } : l)),
    })),

  setDiscountType: (type) => set({ discountType: type }),
  setOrderDiscountAmount: (amount) => set({ orderDiscountAmount: amount }),
  setOrderDiscountPercentInput: (percent) =>
    set({ orderDiscountPercentInput: percent }),

  clear: () =>
    set({
      lines: [],
      discountType: "none",
      orderDiscountAmount: new Decimal(0),
      orderDiscountPercentInput: new Decimal(0),
    }),
}));
