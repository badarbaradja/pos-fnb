"use client";

import { useMemo, useState } from "react";
import type { PosCategory, PosProduct } from "@/app/(pos)/pos/get-pos-catalog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ProductCard } from "./product-card";
import { id as strings } from "@/lib/i18n/id";

export function ProductGrid({
  products,
  categories,
  priceTierId,
  onSelectProduct,
}: {
  products: PosProduct[];
  categories: PosCategory[];
  priceTierId: string;
  onSelectProduct: (product: PosProduct) => void;
}) {
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);

  // Katalog sudah di-fetch sekali di server (get-pos-catalog.ts) -- filter
  // di bawah ini murni di memori, tidak memicu query baru (kesepakatan T12).
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return products.filter((p) => {
      const matchesCategory = categoryId ? p.categoryId === categoryId : true;
      const matchesSearch = query ? p.name.toLowerCase().includes(query) : true;
      return matchesCategory && matchesSearch;
    });
  }, [products, search, categoryId]);

  return (
    <div className="flex flex-col gap-3 p-4">
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={strings.pos.searchPlaceholder}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={categoryId === null ? "default" : "outline"}
          onClick={() => setCategoryId(null)}
        >
          {strings.pos.allCategories}
        </Button>
        {categories.map((c) => (
          <Button
            key={c.id}
            type="button"
            size="sm"
            variant={categoryId === c.id ? "default" : "outline"}
            onClick={() => setCategoryId(c.id)}
          >
            {c.name}
          </Button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">{strings.pos.emptyProducts}</p>
      ) : (
        // Scroll halaman biasa (lihat (pos)/layout.tsx) -- bukan lagi
        // overflow-y-auto internal, jadi tidak butuh min-h-0/flex-1 di sini.
        <div className="grid grid-cols-2 gap-3 pb-4 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              priceTierId={priceTierId}
              onSelect={onSelectProduct}
            />
          ))}
        </div>
      )}
    </div>
  );
}
