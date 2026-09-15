"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { id as strings } from "@/lib/i18n/id";
import type { IngredientOption } from "@/lib/recipes/manage";

/**
 * Pemilih bahan dengan pencarian teks bebas -- proyek ini sengaja tidak
 * memasang komponen combobox baru (CLAUDE.md §3.6: "jangan menambah
 * dependency baru tanpa izin") untuk satu kebutuhan ini, jadi dibuat
 * manual dari Input + daftar hasil filter, cukup untuk 225 bahan yang ada
 * hari ini.
 */
export function IngredientPicker({
  options,
  excludeIds,
  onSelect,
}: {
  options: IngredientOption[];
  excludeIds: Set<string>;
  onSelect: (ingredient: IngredientOption) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const results = useMemo(() => {
    const term = query.trim().toLowerCase();
    const available = options.filter((o) => !excludeIds.has(o.id));
    if (!term) return available.slice(0, 8);
    return available.filter((o) => o.name.toLowerCase().includes(term)).slice(0, 8);
  }, [options, excludeIds, query]);

  return (
    <div className="relative">
      <Input
        placeholder={strings.recipes.ingredientPickerPlaceholder}
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onBlur={() => {
          // Delay supaya klik di daftar hasil sempat terdaftar sebelum ditutup.
          setTimeout(() => setOpen(false), 150);
        }}
      />
      {open ? (
        <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-md">
          {results.length === 0 ? (
            <p className="p-2 text-sm text-muted-foreground">
              {strings.recipes.ingredientPickerEmpty}
            </p>
          ) : (
            results.map((option) => (
              <Button
                key={option.id}
                type="button"
                variant="ghost"
                className="w-full justify-between rounded-none font-normal"
                onClick={() => {
                  onSelect(option);
                  setQuery("");
                  setOpen(false);
                }}
              >
                <span>{option.name}</span>
                <span className="text-xs text-muted-foreground">{option.baseUnit}</span>
              </Button>
            ))
          )}
        </div>
      ) : null}
      <div className="mt-1">
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen((v) => !v)}>
          {strings.recipes.addIngredientButton}
        </Button>
      </div>
    </div>
  );
}
