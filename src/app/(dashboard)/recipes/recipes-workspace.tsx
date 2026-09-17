"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { id as strings } from "@/lib/i18n/id";
import type {
  IngredientOption,
  RecipeItemDetail,
  RecipeOverviewRow,
  RecipeProductType,
} from "@/lib/recipes/manage";
import { RECIPE_PRODUCT_TYPES } from "@/lib/recipes/manage";
import { getRecipeDetailAction, saveRecipeAction } from "./actions";
import { IngredientPicker } from "./ingredient-picker";

type FilterMode = "all" | "missing" | "has" | "simpleMissing";

type DraftLine = {
  key: string; // stabil untuk React key, bukan dari DB (bahan baru belum punya recipeItem.id)
  ingredientId: string;
  ingredientName: string;
  baseUnit: string;
  qty: string;
  isOptional: boolean;
  wastePercent: string;
};

let draftKeySeq = 0;
function nextDraftKey(): string {
  draftKeySeq += 1;
  return `draft-${draftKeySeq}`;
}

function toDraftLines(items: RecipeItemDetail[]): DraftLine[] {
  return items.map((item) => ({
    key: item.id,
    ingredientId: item.ingredientId,
    ingredientName: item.ingredientName,
    baseUnit: item.baseUnit,
    qty: item.qty,
    isOptional: item.isOptional,
    wastePercent: item.wastePercent,
  }));
}

function toRecipeProductType(value: string): RecipeProductType {
  return (RECIPE_PRODUCT_TYPES as readonly string[]).includes(value)
    ? (value as RecipeProductType)
    : "recipe";
}

function productTypeLabel(value: string): string {
  if (value === "simple") return strings.recipes.typeSimple;
  if (value === "recipe") return strings.recipes.typeRecipe;
  if (value === "service") return strings.recipes.typeService;
  return strings.recipes.typeOther;
}

export function RecipesWorkspace({
  initialProducts,
  ingredientOptions,
}: {
  initialProducts: RecipeOverviewRow[];
  ingredientOptions: IngredientOption[];
}) {
  const [products, setProducts] = useState(initialProducts);
  const [search, setSearch] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("missing");
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [productType, setProductType] = useState<RecipeProductType>("recipe");
  const [lines, setLines] = useState<DraftLine[] | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [isSaving, startSaving] = useTransition();

  const ingredientById = useMemo(() => {
    const map = new Map<string, IngredientOption>();
    for (const ing of ingredientOptions) map.set(ing.id, ing);
    return map;
  }, [ingredientOptions]);

  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products.filter((p) => {
      if (filterMode === "missing" && p.hasRecipe) return false;
      if (filterMode === "has" && !p.hasRecipe) return false;
      if (filterMode === "simpleMissing" && !(p.productType === "simple" && !p.hasRecipe)) {
        return false;
      }
      if (term && !p.name.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [products, search, filterMode]);

  const selectedProduct = products.find((p) => p.productId === selectedProductId) ?? null;

  async function openProduct(productId: string) {
    setSelectedProductId(productId);
    setLoadingDetail(true);
    setLines(null);
    const product = products.find((p) => p.productId === productId);
    setProductType(toRecipeProductType(product?.productType ?? "recipe"));
    const result = await getRecipeDetailAction(productId);
    setLoadingDetail(false);
    if (result.error || !result.data) {
      toast.error(result.error ?? strings.common.unexpectedError);
      return;
    }
    setLines(toDraftLines(result.data.items));
  }

  function addLine(ingredient: IngredientOption) {
    setLines((prev) => {
      const current = prev ?? [];
      if (current.some((l) => l.ingredientId === ingredient.id)) {
        toast.error(strings.recipes.duplicateIngredient);
        return current;
      }
      return [
        ...current,
        {
          key: nextDraftKey(),
          ingredientId: ingredient.id,
          ingredientName: ingredient.name,
          baseUnit: ingredient.baseUnit,
          qty: "",
          isOptional: false,
          wastePercent: "0",
        },
      ];
    });
  }

  /** Barang jadi: satu bahan saja -- memilih bahan baru MENGGANTI, bukan menambah. */
  function selectSimpleIngredient(ingredient: IngredientOption) {
    setLines([
      {
        key: nextDraftKey(),
        ingredientId: ingredient.id,
        ingredientName: ingredient.name,
        baseUnit: ingredient.baseUnit,
        qty: "1",
        isOptional: false,
        wastePercent: "0",
      },
    ]);
  }

  function changeProductType(next: RecipeProductType) {
    setProductType(next);
    if (next === "service") {
      setLines([]);
      return;
    }
    if (next === "simple") {
      setLines((prev) => {
        const current = prev ?? [];
        if (current.length === 0) return current;
        const first = current[0]!;
        return [{ ...first, qty: "1" }];
      });
    }
  }

  function removeLine(key: string) {
    setLines((prev) => (prev ?? []).filter((l) => l.key !== key));
  }

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((prev) => (prev ?? []).map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function findNextMissingProductId(afterProductId: string): string | null {
    const idx = products.findIndex((p) => p.productId === afterProductId);
    for (let i = idx + 1; i < products.length; i++) {
      if (!products[i]!.hasRecipe) return products[i]!.productId;
    }
    for (let i = 0; i < idx; i++) {
      if (!products[i]!.hasRecipe) return products[i]!.productId;
    }
    return null;
  }

  function handleSave(jumpToNext: boolean) {
    if (!selectedProductId || lines === null) return;

    if (productType === "simple" && lines.length !== 1) {
      toast.error(strings.recipes.simpleMustHaveOneItem);
      return;
    }
    if (productType === "service" && lines.length !== 0) {
      toast.error(strings.recipes.serviceMustHaveNoItems);
      return;
    }
    if (productType !== "service") {
      for (const line of lines) {
        const qtyNum = Number(line.qty);
        if (!line.qty || !Number.isFinite(qtyNum) || qtyNum <= 0) {
          toast.error(`${line.ingredientName}: ${strings.recipes.qtyMustBePositive}`);
          return;
        }
      }
    }

    const productIdAtSave = selectedProductId;
    const productTypeAtSave = productType;
    const linesAtSave =
      productTypeAtSave === "simple" ? [{ ...lines[0]!, qty: "1" }] : lines;

    startSaving(async () => {
      const result = await saveRecipeAction({
        productId: productIdAtSave,
        productType: productTypeAtSave,
        items: linesAtSave.map((l) => ({
          ingredientId: l.ingredientId,
          qty: Number(l.qty),
          isOptional: l.isOptional,
          wastePercent: Number(l.wastePercent) || 0,
        })),
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(strings.common.saveSuccess);

      setProducts((prev) =>
        prev.map((p) =>
          p.productId === productIdAtSave
            ? {
                ...p,
                productType: productTypeAtSave,
                hasRecipe: linesAtSave.length > 0,
                itemCount: linesAtSave.length,
              }
            : p
        )
      );

      if (jumpToNext) {
        const nextId = findNextMissingProductId(productIdAtSave);
        if (nextId) {
          await openProduct(nextId);
        } else {
          setSelectedProductId(null);
          setLines(null);
          toast.success(strings.recipes.allDoneMessage);
        }
      }
    });
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.2fr]">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            placeholder={strings.recipes.searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="sm:max-w-xs"
          />
          <div className="flex flex-wrap gap-1">
            {(
              [
                ["missing", strings.recipes.filterMissing],
                ["has", strings.recipes.filterHas],
                ["simpleMissing", strings.recipes.filterSimpleMissing],
                ["all", strings.recipes.filterAll],
              ] as [FilterMode, string][]
            ).map(([mode, label]) => (
              <Button
                key={mode}
                type="button"
                size="sm"
                variant={filterMode === mode ? "default" : "outline"}
                onClick={() => setFilterMode(mode)}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>

        {filteredProducts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{strings.recipes.emptyList}</p>
        ) : (
          <div className="max-h-[70vh] overflow-y-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{strings.recipes.colName}</TableHead>
                  <TableHead>{strings.recipes.colType}</TableHead>
                  <TableHead>{strings.recipes.colStatus}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProducts.map((p) => (
                  <TableRow
                    key={p.productId}
                    onClick={() => openProduct(p.productId)}
                    className={`cursor-pointer ${p.productId === selectedProductId ? "bg-muted" : ""}`}
                  >
                    <TableCell>
                      <div>{p.name}</div>
                      {p.categoryName ? (
                        <div className="text-xs text-muted-foreground">{p.categoryName}</div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground">
                        {productTypeLabel(p.productType)}
                      </span>
                    </TableCell>
                    <TableCell>
                      {p.hasRecipe ? (
                        <Badge variant="default">
                          {strings.recipes.hasRecipeBadge.replace("{count}", String(p.itemCount))}
                        </Badge>
                      ) : (
                        <Badge variant="secondary">{strings.recipes.noRecipeBadge}</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <div className="rounded-md border p-4">
        {!selectedProduct ? (
          <p className="text-sm text-muted-foreground">{strings.recipes.panelEmptyState}</p>
        ) : loadingDetail || lines === null ? (
          <p className="text-sm text-muted-foreground">{strings.common.loading}</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-lg font-semibold">{selectedProduct.name}</h2>
              {selectedProduct.categoryName ? (
                <p className="text-xs text-muted-foreground">{selectedProduct.categoryName}</p>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <Label>{strings.recipes.typeQuestionLabel}</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                {(
                  [
                    ["simple", strings.recipes.typeSimple, strings.recipes.typeSimpleHint],
                    ["recipe", strings.recipes.typeRecipe, strings.recipes.typeRecipeHint],
                    ["service", strings.recipes.typeService, strings.recipes.typeServiceHint],
                  ] as [RecipeProductType, string, string][]
                ).map(([value, label, hint]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => changeProductType(value)}
                    className={`flex-1 rounded-md border p-2 text-left text-sm transition-colors ${
                      productType === value ? "border-primary bg-muted" : "border-input"
                    }`}
                  >
                    <div className="font-medium">{label}</div>
                    <div className="text-xs text-muted-foreground">{hint}</div>
                  </button>
                ))}
              </div>
            </div>

            {productType === "service" ? (
              <p className="text-sm text-muted-foreground">{strings.recipes.typeServiceHint}</p>
            ) : productType === "simple" ? (
              <div className="flex flex-col gap-2">
                <Label>{strings.recipes.simpleIngredientLabel}</Label>
                <IngredientPicker
                  options={ingredientOptions}
                  excludeIds={new Set()}
                  onSelect={selectSimpleIngredient}
                />
                {lines.length > 0 ? (
                  <div className="flex items-center justify-between rounded-md border p-2 text-sm">
                    <span>{lines[0]!.ingredientName}</span>
                    <span className="text-xs text-muted-foreground">
                      1 {ingredientById.get(lines[0]!.ingredientId)?.baseUnit ?? lines[0]!.baseUnit}
                    </span>
                  </div>
                ) : null}
              </div>
            ) : (
              <>
                <IngredientPicker
                  options={ingredientOptions}
                  excludeIds={new Set(lines.map((l) => l.ingredientId))}
                  onSelect={addLine}
                />

                {lines.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{strings.recipes.noItemsHint}</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{strings.recipes.colIngredient}</TableHead>
                        <TableHead>{strings.recipes.colQty}</TableHead>
                        <TableHead>{strings.recipes.colOptional}</TableHead>
                        <TableHead>{strings.recipes.colWaste}</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lines.map((line) => {
                        const ingredient = ingredientById.get(line.ingredientId);
                        return (
                          <TableRow key={line.key}>
                            <TableCell>{line.ingredientName}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <Input
                                  type="number"
                                  step="0.0001"
                                  min="0"
                                  value={line.qty}
                                  onChange={(e) => updateLine(line.key, { qty: e.target.value })}
                                  className="w-24"
                                />
                                <span className="text-xs text-muted-foreground">
                                  {ingredient?.baseUnit ?? line.baseUnit}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Checkbox
                                checked={line.isOptional}
                                onCheckedChange={(c) =>
                                  updateLine(line.key, { isOptional: c === true })
                                }
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                value={line.wastePercent}
                                onChange={(e) =>
                                  updateLine(line.key, { wastePercent: e.target.value })
                                }
                                className="w-20"
                              />
                            </TableCell>
                            <TableCell>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => removeLine(line.key)}
                              >
                                {strings.recipes.removeLine}
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </>
            )}

            <div className="flex gap-2">
              <Button type="button" disabled={isSaving} onClick={() => handleSave(true)}>
                {isSaving ? strings.common.saving : strings.recipes.saveButton}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={isSaving}
                onClick={() => handleSave(false)}
              >
                {strings.recipes.saveOnlyButton}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
