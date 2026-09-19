"use client";

import { useMemo, useState } from "react";
import { SearchIcon, SearchXIcon } from "lucide-react";
import type { PosCategory, PosProduct } from "@/app/(pos)/pos/get-pos-catalog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
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
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-2.5 sm:p-3 md:p-4">
      <div className="relative shrink-0">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={strings.pos.searchPlaceholder}
          inputSize="touch"
          className="rounded-full text-sm data-[size=touch]:pl-10"
        />
      </div>
      <div className="shrink-0 pt-1 pb-1">
        <div className="flex w-full min-w-0 flex-nowrap items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5">
          <Button
            type="button"
            size="touch"
            className="shrink-0 rounded-full font-medium"
            variant={categoryId === null ? "default" : "outline"}
            onClick={() => setCategoryId(null)}
          >
            {strings.pos.allCategories}
          </Button>
          {categories.map((c) => (
            <Button
              key={c.id}
              type="button"
              size="touch"
              className="shrink-0 rounded-full font-medium"
              variant={categoryId === c.id ? "default" : "outline"}
              onClick={() => setCategoryId(c.id)}
            >
              {c.name}
            </Button>
          ))}
        </div>
      </div>
      {filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState icon={SearchXIcon} title={strings.pos.emptyProducts} />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto pt-1 pb-20 md:pb-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-2.5 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            {filtered.map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                priceTierId={priceTierId}
                onSelect={onSelectProduct}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
