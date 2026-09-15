"use client";

import { useState, useCallback, useMemo } from "react";
import type { GuestCatalog, GuestProduct, GuestModifierGroup } from "@/lib/order-guest";

// ─── Tipe cart ────────────────────────────────────────────────────────────────

type CartLine = {
  id: string; // unik per baris di keranjang (bukan product id)
  product: GuestProduct;
  variantId: string | null;
  variantName: string | null;
  modifierIds: string[];
  modifierNames: string[];
  modifierPriceTotal: number;
  qty: number;
  note: string;
  unitPrice: number; // base + variant delta
  lineTotal: number;
};

// ─── Helper ────────────────────────────────────────────────────────────────────

function formatRp(amount: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

// ─── Dialog pilih modifier + varian ──────────────────────────────────────────

function ProductDetailDialog({
  product,
  onAdd,
  onClose,
}: {
  product: GuestProduct;
  onAdd: (line: Omit<CartLine, "id">) => void;
  onClose: () => void;
}) {
  const defaultVariant = product.variants.find((v) => v.isDefault) ?? product.variants[0];
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(
    defaultVariant?.id ?? null
  );
  const [selectedModifiers, setSelectedModifiers] = useState<Record<string, string[]>>({});
  const [note, setNote] = useState("");

  const selectedVariant = product.variants.find((v) => v.id === selectedVariantId);
  const variantDelta = selectedVariant ? parseFloat(selectedVariant.priceDelta) : 0;
  const basePrice = parseFloat(product.price);
  const unitPrice = basePrice + variantDelta;

  const allSelectedModifierIds = Object.values(selectedModifiers).flat();
  const modifierPriceTotal = allSelectedModifierIds.reduce((sum, mid) => {
    for (const group of product.modifierGroups) {
      const mod = group.modifiers.find((m) => m.id === mid);
      if (mod) return sum + parseFloat(mod.price);
    }
    return sum;
  }, 0);

  const modifierNames = allSelectedModifierIds.flatMap((mid) => {
    for (const group of product.modifierGroups) {
      const mod = group.modifiers.find((m) => m.id === mid);
      if (mod) return [mod.name];
    }
    return [];
  });

  function toggleModifier(group: GuestModifierGroup, modId: string) {
    setSelectedModifiers((prev) => {
      const current = prev[group.id] ?? [];
      if (current.includes(modId)) {
        return { ...prev, [group.id]: current.filter((id) => id !== modId) };
      }
      if (group.maxSelect === 1) {
        return { ...prev, [group.id]: [modId] };
      }
      if (current.length < group.maxSelect) {
        return { ...prev, [group.id]: [...current, modId] };
      }
      return prev;
    });
  }

  function isValid() {
    return product.modifierGroups.every((group) => {
      const selected = (selectedModifiers[group.id] ?? []).length;
      return selected >= group.minSelect;
    });
  }

  function handleAdd() {
    if (!isValid()) return;
    onAdd({
      product,
      variantId: selectedVariantId,
      variantName: selectedVariant?.name ?? null,
      modifierIds: allSelectedModifierIds,
      modifierNames,
      modifierPriceTotal,
      qty: 1,
      note,
      unitPrice,
      lineTotal: unitPrice + modifierPriceTotal,
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="w-full max-w-lg rounded-t-2xl bg-white sm:rounded-2xl max-h-[85vh] overflow-y-auto">
        {/* Gambar produk */}
        {product.imageUrl && (
          <div className="aspect-video w-full overflow-hidden rounded-t-2xl">
            <img
              src={product.imageUrl}
              alt={product.name}
              className="h-full w-full object-cover"
            />
          </div>
        )}

        <div className="p-5">
          <div className="mb-1 flex items-start justify-between gap-2">
            <h2 className="text-xl font-bold text-gray-900">{product.name}</h2>
            <button
              onClick={onClose}
              className="rounded-full p-1 text-gray-400 hover:bg-gray-100"
              aria-label="Tutup"
            >
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="mb-4 text-lg font-semibold text-orange-600">
            {formatRp(unitPrice + modifierPriceTotal)}
          </div>

          {/* Varian */}
          {product.variants.length > 0 && (
            <div className="mb-4">
              <p className="mb-2 text-sm font-semibold text-gray-700">Pilihan</p>
              <div className="flex flex-wrap gap-2">
                {product.variants.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setSelectedVariantId(v.id)}
                    className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
                      selectedVariantId === v.id
                        ? "border-orange-500 bg-orange-50 text-orange-700"
                        : "border-gray-200 bg-white text-gray-700"
                    }`}
                  >
                    {v.name}
                    {parseFloat(v.priceDelta) !== 0
                      ? ` (+${formatRp(parseFloat(v.priceDelta))})`
                      : ""}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Modifier groups */}
          {product.modifierGroups.map((group) => (
            <div key={group.id} className="mb-4">
              <div className="mb-1 flex items-center gap-2">
                <p className="text-sm font-semibold text-gray-700">{group.name}</p>
                {group.isRequired && (
                  <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-600">
                    Wajib
                  </span>
                )}
                {group.maxSelect > 1 && (
                  <span className="text-xs text-gray-400">
                    Pilih maks. {group.maxSelect}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {group.modifiers.map((mod) => {
                  const isSelected = (selectedModifiers[group.id] ?? []).includes(mod.id);
                  return (
                    <button
                      key={mod.id}
                      onClick={() => toggleModifier(group, mod.id)}
                      className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
                        isSelected
                          ? "border-orange-500 bg-orange-50 text-orange-700"
                          : "border-gray-200 bg-white text-gray-700"
                      }`}
                    >
                      {mod.name}
                      {parseFloat(mod.price) > 0
                        ? ` (+${formatRp(parseFloat(mod.price))})`
                        : ""}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Catatan */}
          <div className="mb-5">
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Catatan <span className="text-gray-400">(opsional)</span>
            </label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="mis. tanpa bawang, tidak pedas"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none"
              maxLength={200}
            />
          </div>

          <button
            onClick={handleAdd}
            disabled={!isValid()}
            className="w-full rounded-xl bg-orange-500 py-3.5 text-base font-semibold text-white transition-colors hover:bg-orange-600 disabled:opacity-40"
          >
            Tambah ke Pesanan — {formatRp(unitPrice + modifierPriceTotal)}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Panel keranjang ──────────────────────────────────────────────────────────

function CartPanel({
  lines,
  onIncrement,
  onDecrement,
  onSubmit,
  isSubmitting,
}: {
  lines: CartLine[];
  onIncrement: (id: string) => void;
  onDecrement: (id: string) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
}) {
  const grandTotal = lines.reduce((s, l) => s + l.lineTotal * l.qty, 0);
  if (lines.length === 0) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-gray-200 bg-white shadow-2xl sm:static sm:border-0 sm:shadow-none">
      <div className="mx-auto max-w-lg">
        <div className="max-h-52 overflow-y-auto px-4 pt-4 sm:max-h-96">
          {lines.map((line) => (
            <div key={line.id} className="mb-3 flex items-start gap-3">
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900">
                  {line.product.name}
                  {line.variantName ? ` · ${line.variantName}` : ""}
                </p>
                {line.modifierNames.length > 0 && (
                  <p className="text-xs text-gray-500">{line.modifierNames.join(", ")}</p>
                )}
                {line.note && (
                  <p className="text-xs italic text-gray-400">"{line.note}"</p>
                )}
                <p className="text-sm font-semibold text-orange-600">
                  {formatRp((line.unitPrice + line.modifierPriceTotal) * line.qty)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onDecrement(line.id)}
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-gray-300 text-gray-600 hover:bg-gray-50"
                >
                  −
                </button>
                <span className="w-5 text-center text-sm font-bold">{line.qty}</span>
                <button
                  onClick={() => onIncrement(line.id)}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-orange-500 text-white hover:bg-orange-600"
                >
                  +
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-gray-100 p-4">
          <div className="mb-3 flex items-center justify-between text-sm">
            <span className="font-medium text-gray-600">
              {lines.reduce((s, l) => s + l.qty, 0)} item
            </span>
            <span className="text-lg font-bold text-gray-900">{formatRp(grandTotal)}</span>
          </div>
          <button
            onClick={onSubmit}
            disabled={isSubmitting}
            className="w-full rounded-xl bg-orange-500 py-3.5 text-base font-bold text-white transition-colors hover:bg-orange-600 disabled:opacity-60"
          >
            {isSubmitting ? "Mengirim..." : "Kirim Pesanan"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Layar konfirmasi ─────────────────────────────────────────────────────────

function ConfirmationScreen({
  queueNumber,
  outletName,
  onReset,
}: {
  queueNumber: number;
  outletName: string;
  onReset: () => void;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-orange-50 p-6 text-center">
      <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-orange-100">
        <svg viewBox="0 0 24 24" className="h-12 w-12 text-orange-500" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h1 className="mb-2 text-3xl font-bold text-gray-900">Pesanan Diterima!</h1>
      <div className="mb-1 text-lg text-gray-600">{outletName}</div>
      <div className="mb-8 mt-6 rounded-2xl bg-white px-10 py-6 shadow-md">
        <p className="mb-1 text-sm font-medium uppercase tracking-wider text-gray-500">
          Nomor Antrian
        </p>
        <p className="text-7xl font-black text-orange-500">#{queueNumber}</p>
      </div>
      <p className="mb-8 max-w-xs text-gray-500">
        Kasir sedang memproses pesanan Anda. Silakan tunggu dan kasir akan
        memanggil Anda saat siap.
      </p>
      <button
        onClick={onReset}
        className="rounded-xl border border-orange-300 bg-white px-8 py-3 font-semibold text-orange-600 hover:bg-orange-50"
      >
        Pesan Lagi
      </button>
    </div>
  );
}

// ─── Komponen utama ────────────────────────────────────────────────────────────

export function SelfOrderScreen({
  token,
  catalog,
}: {
  token: string;
  catalog: GuestCatalog;
}) {
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(
    catalog.categories[0]?.id ?? null
  );
  const [selectedProduct, setSelectedProduct] = useState<GuestProduct | null>(null);
  const [cartLines, setCartLines] = useState<CartLine[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmedQueue, setConfirmedQueue] = useState<number | null>(null);

  const filteredProducts = useMemo(
    () =>
      activeCategoryId
        ? catalog.products.filter((p) => p.categoryId === activeCategoryId)
        : catalog.products,
    [catalog.products, activeCategoryId]
  );

  const addToCart = useCallback((line: Omit<CartLine, "id">) => {
    setCartLines((prev) => [
      ...prev,
      { ...line, id: crypto.randomUUID() },
    ]);
  }, []);

  const incrementLine = useCallback((id: string) => {
    setCartLines((prev) =>
      prev.map((l) =>
        l.id === id
          ? { ...l, qty: l.qty + 1, lineTotal: (l.qty + 1) * (l.unitPrice + l.modifierPriceTotal) }
          : l
      )
    );
  }, []);

  const decrementLine = useCallback((id: string) => {
    setCartLines((prev) =>
      prev.flatMap((l) => {
        if (l.id !== id) return [l];
        if (l.qty <= 1) return []; // hapus
        return [{ ...l, qty: l.qty - 1, lineTotal: (l.qty - 1) * (l.unitPrice + l.modifierPriceTotal) }];
      })
    );
  }, []);

  async function handleSubmit() {
    if (cartLines.length === 0 || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const body = {
        token,
        lines: cartLines.map((l) => ({
          productId: l.product.id,
          variantId: l.variantId,
          modifierIds: l.modifierIds,
          qty: l.qty,
          note: l.note,
        })),
      };
      const res = await fetch("/api/order-guest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json() as { queueNumber?: number; error?: string };
      if (!res.ok || !data.queueNumber) {
        alert(data.error ?? "Gagal mengirim pesanan, coba lagi.");
        return;
      }
      setCartLines([]);
      setConfirmedQueue(data.queueNumber);
    } catch {
      alert("Terjadi kesalahan jaringan, coba lagi.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (confirmedQueue !== null) {
    return (
      <ConfirmationScreen
        queueNumber={confirmedQueue}
        outletName={catalog.outlet.name}
        onReset={() => setConfirmedQueue(null)}
      />
    );
  }

  return (
    <>
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-orange-100 bg-white/90 backdrop-blur">
        <div className="mx-auto max-w-lg px-4 py-3">
          <h1 className="text-lg font-bold text-gray-900">{catalog.outlet.name}</h1>
          <p className="text-sm text-gray-500">Pesan langsung dari sini</p>
        </div>
        {/* Filter kategori */}
        {catalog.categories.length > 0 && (
          <div className="flex gap-2 overflow-x-auto px-4 pb-3 scrollbar-hide">
            <button
              onClick={() => setActiveCategoryId(null)}
              className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                activeCategoryId === null
                  ? "bg-orange-500 text-white"
                  : "bg-gray-100 text-gray-700"
              }`}
            >
              Semua
            </button>
            {catalog.categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCategoryId(cat.id)}
                className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                  activeCategoryId === cat.id
                    ? "bg-orange-500 text-white"
                    : "bg-gray-100 text-gray-700"
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>
        )}
      </header>

      {/* Grid produk */}
      <main className="mx-auto max-w-lg pb-52 sm:pb-8">
        {filteredProducts.length === 0 ? (
          <div className="py-20 text-center text-gray-400">Tidak ada menu di kategori ini</div>
        ) : (
          <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3">
            {filteredProducts.map((product) => (
              <button
                key={product.id}
                onClick={() => setSelectedProduct(product)}
                className="flex flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-100 hover:shadow-md active:scale-[0.98] transition-all"
              >
                <div className="aspect-square w-full bg-orange-50">
                  {product.imageUrl ? (
                    <img
                      src={product.imageUrl}
                      alt={product.name}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-4xl">🍽️</div>
                  )}
                </div>
                <div className="flex flex-1 flex-col p-3">
                  <p className="text-sm font-semibold text-gray-900 leading-tight line-clamp-2">
                    {product.name}
                  </p>
                  <p className="mt-auto pt-2 text-sm font-bold text-orange-600">
                    {formatRp(parseFloat(product.price))}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>

      {/* Keranjang */}
      <CartPanel
        lines={cartLines}
        onIncrement={incrementLine}
        onDecrement={decrementLine}
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
      />

      {/* Dialog detail produk */}
      {selectedProduct && (
        <ProductDetailDialog
          product={selectedProduct}
          onAdd={addToCart}
          onClose={() => setSelectedProduct(null)}
        />
      )}
    </>
  );
}
