import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { UserDbHandle } from "@/lib/db/client";
import {
  categories,
  devices,
  modifierGroups,
  modifiers,
  outlets,
  paymentMethods,
  priceTiers,
  productModifierGroups,
  productPrices,
  products,
  productVariants,
} from "@/lib/db/schema";

export type PosModifier = { id: string; name: string; price: string };
export type PosModifierGroup = {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  isRequired: boolean;
  modifiers: PosModifier[];
};
export type PosVariant = {
  id: string;
  name: string;
  priceDelta: string;
  isDefault: boolean;
};
export type PosProduct = {
  id: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  isTaxable: boolean;
  pricesByTier: Record<string, string>; // priceTierId -> harga; tier tanpa harga tidak ada key-nya
  variants: PosVariant[];
  modifierGroups: PosModifierGroup[];
};
export type PosCategory = {
  id: string;
  name: string;
  color: string | null;
  sortOrder: number;
};
export type PosOutlet = {
  id: string;
  code: string;
  taxPercent: string;
  taxInclusive: boolean;
  serviceChargePercent: string;
  serviceChargeInTaxBase: boolean;
  roundingTo: number;
  cashEnabled: boolean;
};
export type PosPriceTier = {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
};
export type PosPaymentMethod = {
  id: string;
  code: string;
  name: string;
  isCashDrawer: boolean;
  requiresRef: boolean;
};
export type PosDevice = {
  id: string;
  name: string;
};

/**
 * Fetch SEKALI saat halaman kasir dibuka (Server Component) -- tap produk
 * atau ganti tingkat harga di klien tidak boleh memicu query baru
 * (kesepakatan T12). Harga SEMUA tingkat harga diambil sekaligus supaya
 * selector tier di klien bisa switch murni dari data yang sudah di memori.
 */
export async function getPosCatalog(
  db: UserDbHandle["db"],
  businessId: string
): Promise<{
  outlet: PosOutlet;
  device: PosDevice;
  paymentMethods: PosPaymentMethod[];
  priceTiers: PosPriceTier[];
  defaultPriceTierId: string;
  categories: PosCategory[];
  products: PosProduct[];
}> {
  const [outlet] = await db
    .select()
    .from(outlets)
    .where(and(eq(outlets.businessId, businessId), eq(outlets.isActive, true)))
    .orderBy(asc(outlets.createdAt));
  if (!outlet) {
    throw new Error("Belum ada outlet aktif untuk bisnis ini.");
  }

  const [device] = await db
    .select()
    .from(devices)
    .where(and(eq(devices.outletId, outlet.id), eq(devices.isActive, true)))
    .orderBy(asc(devices.serialNumber));
  if (!device) {
    throw new Error("Belum ada device aktif untuk outlet ini.");
  }

  let paymentMethodRows = await db
    .select()
    .from(paymentMethods)
    .where(and(eq(paymentMethods.businessId, businessId), eq(paymentMethods.isActive, true)))
    .orderBy(asc(paymentMethods.sortOrder));
  if (paymentMethodRows.length === 0) {
    throw new Error("Belum ada metode pembayaran untuk bisnis ini.");
  }
  // Outlet cashless: metode pembayaran yang menyentuh laci kas fisik
  // disembunyikan dari dialog pembayaran sama sekali (T15 lanjutan).
  if (!outlet.cashEnabled) {
    paymentMethodRows = paymentMethodRows.filter((pm) => !pm.isCashDrawer);
  }

  const priceTierRows = await db
    .select()
    .from(priceTiers)
    .where(eq(priceTiers.businessId, businessId))
    .orderBy(asc(priceTiers.code));
  if (priceTierRows.length === 0) {
    throw new Error("Belum ada tingkat harga untuk bisnis ini.");
  }
  const defaultPriceTierId =
    priceTierRows.find((t) => t.isDefault)?.id ?? priceTierRows[0]!.id;

  const categoryRows = await db
    .select()
    .from(categories)
    .where(eq(categories.businessId, businessId))
    .orderBy(asc(categories.sortOrder), asc(categories.name));

  const productRows = await db
    .select({
      id: products.id,
      name: products.name,
      categoryId: products.categoryId,
      categoryName: categories.name,
      isTaxable: products.isTaxable,
    })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(and(eq(products.businessId, businessId), eq(products.isActive, true)))
    .orderBy(asc(products.sortOrder), asc(products.name));

  const productIds = productRows.map((p) => p.id);

  const variantRows = productIds.length
    ? await db
        .select()
        .from(productVariants)
        .where(
          and(
            inArray(productVariants.productId, productIds),
            eq(productVariants.isActive, true)
          )
        )
        .orderBy(asc(productVariants.name))
    : [];

  const priceRows = productIds.length
    ? await db
        .select({
          productId: productPrices.productId,
          priceTierId: productPrices.priceTierId,
          price: productPrices.price,
        })
        .from(productPrices)
        .where(
          and(
            inArray(productPrices.productId, productIds),
            isNull(productPrices.variantId)
          )
        )
    : [];

  const assignmentRows = productIds.length
    ? await db
        .select({
          productId: productModifierGroups.productId,
          groupId: modifierGroups.id,
          groupName: modifierGroups.name,
          minSelect: modifierGroups.minSelect,
          maxSelect: modifierGroups.maxSelect,
          isRequired: modifierGroups.isRequired,
        })
        .from(productModifierGroups)
        .innerJoin(
          modifierGroups,
          eq(productModifierGroups.modifierGroupId, modifierGroups.id)
        )
        .where(inArray(productModifierGroups.productId, productIds))
    : [];

  const groupIds = [...new Set(assignmentRows.map((a) => a.groupId))];
  const modifierRows = groupIds.length
    ? await db
        .select()
        .from(modifiers)
        .where(inArray(modifiers.modifierGroupId, groupIds))
        .orderBy(asc(modifiers.sortOrder), asc(modifiers.name))
    : [];

  const variantsByProduct = new Map<string, PosVariant[]>();
  for (const v of variantRows) {
    const list = variantsByProduct.get(v.productId) ?? [];
    list.push({
      id: v.id,
      name: v.name,
      priceDelta: v.priceDelta,
      isDefault: v.isDefault,
    });
    variantsByProduct.set(v.productId, list);
  }

  const pricesByProduct = new Map<string, Record<string, string>>();
  for (const p of priceRows) {
    const map = pricesByProduct.get(p.productId) ?? {};
    map[p.priceTierId] = p.price;
    pricesByProduct.set(p.productId, map);
  }

  const modifiersByGroup = new Map<string, PosModifier[]>();
  for (const m of modifierRows) {
    const list = modifiersByGroup.get(m.modifierGroupId) ?? [];
    list.push({ id: m.id, name: m.name, price: m.price });
    modifiersByGroup.set(m.modifierGroupId, list);
  }

  const groupsByProduct = new Map<string, PosModifierGroup[]>();
  for (const a of assignmentRows) {
    const list = groupsByProduct.get(a.productId) ?? [];
    list.push({
      id: a.groupId,
      name: a.groupName,
      minSelect: a.minSelect,
      maxSelect: a.maxSelect,
      isRequired: a.isRequired,
      modifiers: modifiersByGroup.get(a.groupId) ?? [],
    });
    groupsByProduct.set(a.productId, list);
  }

  const posProducts: PosProduct[] = productRows.map((p) => ({
    id: p.id,
    name: p.name,
    categoryId: p.categoryId,
    categoryName: p.categoryName,
    isTaxable: p.isTaxable,
    pricesByTier: pricesByProduct.get(p.id) ?? {},
    variants: variantsByProduct.get(p.id) ?? [],
    modifierGroups: groupsByProduct.get(p.id) ?? [],
  }));

  return {
    outlet: {
      id: outlet.id,
      code: outlet.code,
      taxPercent: outlet.taxPercent,
      taxInclusive: outlet.taxInclusive,
      serviceChargePercent: outlet.serviceChargePercent,
      serviceChargeInTaxBase: outlet.serviceChargeInTaxBase,
      roundingTo: outlet.roundingTo,
      cashEnabled: outlet.cashEnabled,
    },
    device: { id: device.id, name: device.name },
    paymentMethods: paymentMethodRows.map((pm) => ({
      id: pm.id,
      code: pm.code,
      name: pm.name,
      isCashDrawer: pm.isCashDrawer,
      requiresRef: pm.requiresRef,
    })),
    priceTiers: priceTierRows.map((t) => ({
      id: t.id,
      code: t.code,
      name: t.name,
      isDefault: t.isDefault,
    })),
    defaultPriceTierId,
    categories: categoryRows.map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      sortOrder: c.sortOrder,
    })),
    products: posProducts,
  };
}
