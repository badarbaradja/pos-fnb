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

export const useCartStore = create<CartState>((set) => ({
  lines: [],
  discountType: "none",
  orderDiscountAmount: new Decimal(0),
  orderDiscountPercentInput: new Decimal(0),

  addLine: (line) =>
    set((state) => ({
      lines: [
        ...state.lines,
        {
          ...line,
          id: generateId(),
          itemDiscount: line.itemDiscount ?? new Decimal(0),
          note: line.note ?? "",
        },
      ],
    })),

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
