import { create } from "zustand";
import { Decimal } from "decimal.js";

/**
 * lib/store/thrift-cart-store.ts — TT06. Padanan lib/store/cart-store.ts
 * untuk barang titipan, JAUH lebih sederhana dengan sengaja: setiap barang
 * fisik unik cuma bisa muncul SEKALI di keranjang (qty selalu 1, tidak ada
 * konsep "gabung baris" seperti cart-store.ts F&B), tidak ada modifier,
 * tidak ada diskon per baris (thrifting belum punya UI diskon).
 */

export type ThriftCartLine = {
  barangId: string;
  kode: string;
  nama: string;
  ukuran: string | null;
  warna: string | null;
  hargaJual: Decimal; // snapshot saat dipindai -- sama harga yang dikirim ke sellBarang()
  pemilikId: string | null;
  pemilikNama: string | null;
};

type ThriftCartState = {
  lines: ThriftCartLine[];
  addLine: (line: ThriftCartLine) => { added: boolean };
  removeLine: (barangId: string) => void;
  clear: () => void;
};

export const useThriftCartStore = create<ThriftCartState>((set, get) => ({
  lines: [],

  addLine: (line) => {
    if (get().lines.some((l) => l.barangId === line.barangId)) {
      return { added: false }; // sudah ada -- pemanggil menampilkan pesan, bukan menggandakan baris
    }
    set((state) => ({ lines: [...state.lines, line] }));
    return { added: true };
  },

  removeLine: (barangId) =>
    set((state) => ({ lines: state.lines.filter((l) => l.barangId !== barangId) })),

  clear: () => set({ lines: [] }),
}));
