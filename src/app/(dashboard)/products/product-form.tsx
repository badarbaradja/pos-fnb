"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { saveProduct, type ProductFormState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { ProductImageField } from "@/components/dashboard/products/product-image-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { id as strings } from "@/lib/i18n/id";

type CategoryOption = { id: string; name: string };
type PriceTierOption = { id: string; code: string; name: string };
type ModifierGroupOption = { id: string; name: string };
type BrandOption = { id: string; name: string };
type OutletOption = { id: string; name: string };

export type VariantValue = {
  key: string;
  id?: string;
  name: string;
  sku: string;
  priceDelta: string;
  isDefault: boolean;
  isActive: boolean;
};

export type ProductFormValue = {
  id: string;
  categoryId: string | null;
  brandId: string | null;
  sku: string | null;
  barcode: string | null;
  name: string;
  description: string | null;
  imagePath: string | null;
  productType: string;
  trackStock: boolean;
  isFavorite: boolean;
  isTaxable: boolean;
  prepStation: string | null;
  prepMinutes: number | null;
  sortOrder: number;
  isActive: boolean;
};

const productTypeOptions: { value: string; labelKey: keyof typeof strings.products }[] = [
  { value: "simple", labelKey: "productTypeSimple" },
  { value: "recipe", labelKey: "productTypeRecipe" },
  { value: "bundle", labelKey: "productTypeBundle" },
  { value: "service", labelKey: "productTypeService" },
  { value: "open_price", labelKey: "productTypeOpenPrice" },
];

// base-ui Select.Value cuma menampilkan label kalau Select.Root diberi
// `items` (peta value -> label) -- tanpa ini, Select.Value jatuh ke value
// mentah (UUID kategori, "recipe", dst) sampai popup pernah dibuka sekali
// dan Select.Item-nya sempat mount. Lihat internals/resolveValueLabel.js
// di @base-ui/react.
const productTypeItems: Record<string, ReactNode> = Object.fromEntries(
  productTypeOptions.map((opt) => [opt.value, strings.products[opt.labelKey]])
);

const initialState: ProductFormState = {};

function newVariantRow(): VariantValue {
  return {
    key: crypto.randomUUID(),
    name: "",
    sku: "",
    priceDelta: "0",
    isDefault: false,
    isActive: true,
  };
}

export function ProductForm({
  product,
  currentImageUrl,
  initialVariants,
  initialPrices,
  assignedModifierGroupIds,
  assignedOutletIds,
  categories,
  priceTiers,
  modifierGroups,
  brands,
  outlets,
}: {
  product?: ProductFormValue;
  currentImageUrl: string | null;
  initialVariants: VariantValue[];
  initialPrices: Record<string, string>;
  assignedModifierGroupIds: string[];
  assignedOutletIds: string[];
  categories: CategoryOption[];
  priceTiers: PriceTierOption[];
  modifierGroups: ModifierGroupOption[];
  brands: BrandOption[];
  outlets: OutletOption[];
}) {
  const [state, formAction, isPending] = useActionState(
    saveProduct,
    initialState
  );
  const [variants, setVariants] = useState<VariantValue[]>(initialVariants);
  const categoryItems: Record<string, ReactNode> = Object.fromEntries(
    categories.map((category) => [category.id, category.name])
  );
  const brandItems: Record<string, ReactNode> = Object.fromEntries(
    brands.map((brand) => [brand.id, brand.name])
  );

  useEffect(() => {
    if (state.error) {
      toast.error(state.error);
    }
  }, [state]);

  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-8">
      {product ? <input type="hidden" name="id" value={product.id} /> : null}
      <input type="hidden" name="variantCount" value={variants.length} />

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-muted-foreground">
          {strings.products.coreSection}
        </h2>
        <ProductImageField currentImageUrl={currentImageUrl} productName={product?.name ?? ""} />
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">{strings.products.name}</Label>
          <Input id="name" name="name" defaultValue={product?.name} required />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="categoryId">{strings.products.category}</Label>
          <Select
            name="categoryId"
            defaultValue={product?.categoryId ?? undefined}
            items={categoryItems}
          >
            <SelectTrigger id="categoryId" className="w-full">
              <SelectValue placeholder={strings.products.categoryNone} />
            </SelectTrigger>
            <SelectContent>
              {categories.map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="brandId">{strings.products.brand}</Label>
          <Select
            name="brandId"
            defaultValue={product?.brandId ?? undefined}
            items={brandItems}
          >
            <SelectTrigger id="brandId" className="w-full">
              <SelectValue placeholder={strings.products.brandNone} />
            </SelectTrigger>
            <SelectContent>
              {brands.map((brand) => (
                <SelectItem key={brand.id} value={brand.id}>
                  {brand.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{strings.products.brandHint}</p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="productType">{strings.products.productType}</Label>
          <Select
            name="productType"
            defaultValue={product?.productType ?? "recipe"}
            items={productTypeItems}
          >
            <SelectTrigger id="productType" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {productTypeOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {strings.products[opt.labelKey]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="sku">{strings.products.sku}</Label>
            <Input id="sku" name="sku" defaultValue={product?.sku ?? ""} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="barcode">{strings.products.barcode}</Label>
            <Input id="barcode" name="barcode" defaultValue={product?.barcode ?? ""} />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="description">{strings.products.description}</Label>
          <Textarea
            id="description"
            name="description"
            defaultValue={product?.description ?? ""}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="prepStation">{strings.products.prepStation}</Label>
            <Input
              id="prepStation"
              name="prepStation"
              defaultValue={product?.prepStation ?? ""}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="prepMinutes">{strings.products.prepMinutes}</Label>
            <Input
              id="prepMinutes"
              name="prepMinutes"
              type="number"
              min={0}
              defaultValue={product?.prepMinutes ?? ""}
            />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="sortOrder">{strings.products.sortOrder}</Label>
          <Input
            id="sortOrder"
            name="sortOrder"
            type="number"
            defaultValue={product?.sortOrder ?? 0}
          />
        </div>
        <div className="flex flex-wrap gap-6">
          <div className="flex items-center gap-2">
            <Checkbox
              id="trackStock"
              name="trackStock"
              defaultChecked={product?.trackStock ?? true}
            />
            <Label htmlFor="trackStock">{strings.products.trackStock}</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="isFavorite"
              name="isFavorite"
              defaultChecked={product?.isFavorite ?? false}
            />
            <Label htmlFor="isFavorite">{strings.products.isFavorite}</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="isTaxable"
              name="isTaxable"
              defaultChecked={product?.isTaxable ?? true}
            />
            <Label htmlFor="isTaxable">{strings.products.isTaxable}</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="isActive"
              name="isActive"
              defaultChecked={product?.isActive ?? true}
            />
            <Label htmlFor="isActive">{strings.products.isActive}</Label>
          </div>
        </div>
      </section>

      <Separator />

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground">
            {strings.products.variantsSection}
          </h2>
          <p className="text-xs text-muted-foreground">
            {strings.products.variantsHint}
          </p>
        </div>

        {variants.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {strings.products.variantEmpty}
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {variants.map((variant, index) => (
              <div
                key={variant.key}
                className="flex flex-col gap-3 rounded-lg border p-3"
              >
                {variant.id ? (
                  <input
                    type="hidden"
                    name={`variants.${index}.id`}
                    value={variant.id}
                  />
                ) : null}
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`${variant.key}-name`}>
                      {strings.products.variantName}
                    </Label>
                    <Input
                      id={`${variant.key}-name`}
                      name={`variants.${index}.name`}
                      defaultValue={variant.name}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`${variant.key}-sku`}>
                      {strings.products.variantSku}
                    </Label>
                    <Input
                      id={`${variant.key}-sku`}
                      name={`variants.${index}.sku`}
                      defaultValue={variant.sku}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${variant.key}-priceDelta`}>
                    {strings.products.variantPriceDelta}
                  </Label>
                  <Input
                    id={`${variant.key}-priceDelta`}
                    name={`variants.${index}.priceDelta`}
                    type="number"
                    step="0.01"
                    defaultValue={variant.priceDelta}
                  />
                </div>
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`${variant.key}-isDefault`}
                      name={`variants.${index}.isDefault`}
                      defaultChecked={variant.isDefault}
                    />
                    <Label htmlFor={`${variant.key}-isDefault`}>
                      {strings.products.variantIsDefault}
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`${variant.key}-isActive`}
                      name={`variants.${index}.isActive`}
                      defaultChecked={variant.isActive}
                    />
                    <Label htmlFor={`${variant.key}-isActive`}>
                      {strings.products.variantIsActive}
                    </Label>
                  </div>
                  {!variant.id ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="ml-auto"
                      onClick={() =>
                        setVariants((rows) =>
                          rows.filter((row) => row.key !== variant.key)
                        )
                      }
                    >
                      {strings.products.removeVariant}
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => setVariants((rows) => [...rows, newVariantRow()])}
        >
          {strings.products.addVariant}
        </Button>
      </section>

      <Separator />

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground">
            {strings.products.modifierGroupsSection}
          </h2>
          <p className="text-xs text-muted-foreground">
            {strings.products.modifierGroupsHint}
          </p>
        </div>
        {modifierGroups.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {strings.products.modifierGroupsEmpty}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {modifierGroups.map((group) => (
              <div key={group.id} className="flex items-center gap-2">
                <Checkbox
                  id={`modifierGroup.${group.id}`}
                  name={`modifierGroup.${group.id}`}
                  defaultChecked={assignedModifierGroupIds.includes(group.id)}
                />
                <Label htmlFor={`modifierGroup.${group.id}`}>{group.name}</Label>
              </div>
            ))}
          </div>
        )}
      </section>

      <Separator />

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground">
            {strings.products.outletAvailabilitySection}
          </h2>
          <p className="text-xs text-muted-foreground">
            {strings.products.outletAvailabilityHint}
          </p>
        </div>
        {outlets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {strings.products.outletAvailabilityEmpty}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {outlets.map((outlet) => (
              <div key={outlet.id} className="flex items-center gap-2">
                <Checkbox
                  id={`outlet.${outlet.id}`}
                  name={`outlet.${outlet.id}`}
                  defaultChecked={assignedOutletIds.includes(outlet.id)}
                />
                <Label htmlFor={`outlet.${outlet.id}`}>{outlet.name}</Label>
              </div>
            ))}
          </div>
        )}
      </section>

      <Separator />

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground">
            {strings.products.pricesSection}
          </h2>
          <p className="text-xs text-muted-foreground">
            {strings.products.pricesHint}
          </p>
        </div>
        {priceTiers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {strings.products.pricesEmpty}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {priceTiers.map((tier) => (
              <div key={tier.id} className="flex flex-col gap-1.5">
                <Label htmlFor={`price.${tier.id}`}>
                  {tier.name} ({tier.code})
                </Label>
                <Input
                  id={`price.${tier.id}`}
                  name={`price.${tier.id}`}
                  type="number"
                  step="0.01"
                  min={0}
                  defaultValue={initialPrices[tier.id] ?? ""}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      <Button type="submit" disabled={isPending} className="self-start">
        {isPending ? strings.common.saving : strings.common.save}
      </Button>
    </form>
  );
}
