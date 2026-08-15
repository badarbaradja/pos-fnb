/**
 * Bug produksi Indokopi: tap produk yang sama berulang kali membuat baris
 * terpisah alih-alih menambah qty. Pure in-memory Zustand store, tidak butuh
 * DB -- tidak ada skip guard seperti test lib/pos/* yang butuh Supabase.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";
import { useCartStore, type NewCartLine } from "../cart-store";

function baseLine(overrides: Partial<NewCartLine> = {}): NewCartLine {
  return {
    productId: "prod-1",
    productName: "Americano",
    categoryName: "Kopi Reguler",
    variantId: null,
    variantName: null,
    modifiers: [],
    qty: new Decimal(1),
    isTaxable: true,
    ...overrides,
  };
}

describe("cart-store — penggabungan baris", () => {
  beforeEach(() => {
    useCartStore.getState().clear();
  });

  it("tap produk sama berulang -- qty bertambah di baris yang sama, bukan baris baru", () => {
    const { addLine } = useCartStore.getState();
    addLine(baseLine());
    addLine(baseLine());
    addLine(baseLine());

    const { lines } = useCartStore.getState();
    expect(lines).toHaveLength(1);
    expect(lines[0]!.qty.toString()).toBe("3");
  });

  it("produk sama tapi catatan beda -- tetap baris terpisah", () => {
    const { addLine } = useCartStore.getState();
    addLine(baseLine());
    addLine(baseLine({ note: "tanpa gula" }));

    expect(useCartStore.getState().lines).toHaveLength(2);
  });

  it("produk sama tapi variant beda -- tetap baris terpisah", () => {
    const { addLine } = useCartStore.getState();
    addLine(baseLine({ variantId: "var-regular", variantName: "Regular" }));
    addLine(baseLine({ variantId: "var-large", variantName: "Large" }));

    expect(useCartStore.getState().lines).toHaveLength(2);
  });

  it("produk sama, modifier sama tapi urutan pilih beda -- tetap satu baris (set, bukan array)", () => {
    const { addLine } = useCartStore.getState();
    addLine(
      baseLine({
        modifiers: [
          { modifierId: "mod-a", name: "A", price: new Decimal(0) },
          { modifierId: "mod-b", name: "B", price: new Decimal(0) },
        ],
      })
    );
    addLine(
      baseLine({
        modifiers: [
          { modifierId: "mod-b", name: "B", price: new Decimal(0) },
          { modifierId: "mod-a", name: "A", price: new Decimal(0) },
        ],
      })
    );

    const { lines } = useCartStore.getState();
    expect(lines).toHaveLength(1);
    expect(lines[0]!.qty.toString()).toBe("2");
  });

  it("produk sama tapi set modifier beda -- tetap baris terpisah", () => {
    const { addLine } = useCartStore.getState();
    addLine(
      baseLine({
        modifiers: [{ modifierId: "mod-a", name: "A", price: new Decimal(0) }],
      })
    );
    addLine({ ...baseLine(), modifiers: [] });

    expect(useCartStore.getState().lines).toHaveLength(2);
  });

  it("produk sama tapi diskon item beda -- tetap baris terpisah", () => {
    const { addLine } = useCartStore.getState();
    addLine(baseLine({ itemDiscount: new Decimal(0) }));
    addLine(baseLine({ itemDiscount: new Decimal(1000) }));

    expect(useCartStore.getState().lines).toHaveLength(2);
  });

  it("produk berbeda -- tetap baris terpisah", () => {
    const { addLine } = useCartStore.getState();
    addLine(baseLine({ productId: "prod-1" }));
    addLine(baseLine({ productId: "prod-2" }));

    expect(useCartStore.getState().lines).toHaveLength(2);
  });
});
