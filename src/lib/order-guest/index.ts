import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { getAdminDb } from "@/lib/db/client";
import {
  categories,
  modifierGroups,
  modifiers,
  orderItems,
  orderItemModifiers,
  orders,
  outletTokens,
  outlets,
  priceTiers,
  productModifierGroups,
  productOutlets,
  productPrices,
  products,
  productVariants,
} from "@/lib/db/schema";

// ─── Tipe publik katalog (subset dari PosProduct, tanpa HPP/stok) ────────────

export type GuestModifier = { id: string; name: string; price: string };
export type GuestModifierGroup = {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  isRequired: boolean;
  modifiers: GuestModifier[];
};
export type GuestVariant = {
  id: string;
  name: string;
  priceDelta: string;
  isDefault: boolean;
};
export type GuestProduct = {
  id: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  price: string; // harga tier default saja
  imageUrl: string | null;
  variants: GuestVariant[];
  modifierGroups: GuestModifierGroup[];
};
export type GuestCategory = {
  id: string;
  name: string;
  color: string | null;
  sortOrder: number;
};
export type GuestOutlet = {
  name: string;
  taxPercent: string;
  taxInclusive: boolean;
  serviceChargePercent: string;
  serviceChargeInTaxBase: boolean;
  roundingTo: number;
};
export type GuestCatalog = {
  outlet: GuestOutlet;
  defaultPriceTierId: string;
  categories: GuestCategory[];
  products: GuestProduct[];
};

// ─── Resolve token → outlet ──────────────────────────────────────────────────

/**
 * Resolve token publik ke outlet. Return null kalau token tidak ada,
 * tidak aktif, atau outlet-nya tidak aktif/bukan fnb.
 *
 * getAdminDb() -- RLS bypass sengaja, tidak ada session customer.
 */
export async function resolveOutletToken(
  token: string
): Promise<{ outletId: string; businessId: string; outlet: GuestOutlet } | null> {
  const db = getAdminDb();
  const [row] = await db
    .select({
      outletId: outlets.id,
      businessId: outlets.businessId,
      name: outlets.name,
      taxPercent: outlets.taxPercent,
      taxInclusive: outlets.taxInclusive,
      serviceChargePercent: outlets.serviceChargePercent,
      serviceChargeInTaxBase: outlets.serviceChargeInTaxBase,
      roundingTo: outlets.roundingTo,
    })
    .from(outletTokens)
    .innerJoin(outlets, eq(outletTokens.outletId, outlets.id))
    .where(
      and(
        eq(outletTokens.token, token),
        eq(outletTokens.isActive, true),
        eq(outlets.isActive, true),
        eq(outlets.posMode, "fnb")
      )
    );
  if (!row) return null;
  return {
    outletId: row.outletId,
    businessId: row.businessId,
    outlet: {
      name: row.name,
      taxPercent: row.taxPercent,
      taxInclusive: row.taxInclusive,
      serviceChargePercent: row.serviceChargePercent,
      serviceChargeInTaxBase: row.serviceChargeInTaxBase,
      roundingTo: row.roundingTo,
    },
  };
}

// ─── Fetch katalog publik ────────────────────────────────────────────────────

/**
 * Ambil katalog untuk layar self-order customer.
 * getAdminDb() -- tidak ada sesi customer.
 * Gambar diambil dari URL publik Supabase Storage (bucket 'products' harus public read).
 */
export async function getGuestCatalog(
  businessId: string,
  outletId: string,
  outlet: GuestOutlet,
  supabaseUrl: string
): Promise<GuestCatalog> {
  const db = getAdminDb();

  const priceTierRows = await db
    .select()
    .from(priceTiers)
    .where(and(eq(priceTiers.businessId, businessId), eq(priceTiers.isActive, true)))
    .orderBy(asc(priceTiers.code));
  const defaultTier = priceTierRows.find((t) => t.isDefault) ?? priceTierRows[0];
  if (!defaultTier) throw new Error("Belum ada tingkat harga aktif.");

  const categoryRows = await db
    .select()
    .from(categories)
    .where(
      and(
        eq(categories.businessId, businessId),
        eq(categories.isActive, true),
        eq(categories.scope, "fnb")
      )
    )
    .orderBy(asc(categories.sortOrder), asc(categories.name));

  let productRows = await db
    .select({
      id: products.id,
      name: products.name,
      categoryId: products.categoryId,
      categoryName: categories.name,
      imagePath: products.imagePath,
    })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(and(eq(products.businessId, businessId), eq(products.isActive, true)))
    .orderBy(asc(products.sortOrder), asc(products.name));

  const allProductIds = productRows.map((p) => p.id);
  const restrictionRows = allProductIds.length
    ? await db
        .select({ productId: productOutlets.productId, outletId: productOutlets.outletId })
        .from(productOutlets)
        .where(inArray(productOutlets.productId, allProductIds))
    : [];
  const restrictedProductIds = new Set(restrictionRows.map((r) => r.productId));
  const allowedForThisOutlet = new Set(
    restrictionRows.filter((r) => r.outletId === outletId).map((r) => r.productId)
  );
  productRows = productRows.filter(
    (p) => !restrictedProductIds.has(p.id) || allowedForThisOutlet.has(p.id)
  );

  const productIds = productRows.map((p) => p.id);

  const priceRows = productIds.length
    ? await db
        .select({ productId: productPrices.productId, price: productPrices.price })
        .from(productPrices)
        .where(
          and(
            inArray(productPrices.productId, productIds),
            eq(productPrices.priceTierId, defaultTier.id),
            isNull(productPrices.variantId)
          )
        )
    : [];

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
        .where(
          and(
            inArray(productModifierGroups.productId, productIds),
            eq(modifierGroups.isActive, true)
          )
        )
    : [];

  const groupIds = [...new Set(assignmentRows.map((a) => a.groupId))];
  const modifierRows = groupIds.length
    ? await db
        .select()
        .from(modifiers)
        .where(and(inArray(modifiers.modifierGroupId, groupIds), eq(modifiers.isActive, true)))
        .orderBy(asc(modifiers.sortOrder), asc(modifiers.name))
    : [];

  const priceByProduct = new Map<string, string>();
  for (const p of priceRows) priceByProduct.set(p.productId, p.price);

  const variantsByProduct = new Map<string, GuestVariant[]>();
  for (const v of variantRows) {
    const list = variantsByProduct.get(v.productId) ?? [];
    list.push({ id: v.id, name: v.name, priceDelta: v.priceDelta, isDefault: v.isDefault });
    variantsByProduct.set(v.productId, list);
  }

  const modifiersByGroup = new Map<string, GuestModifier[]>();
  for (const m of modifierRows) {
    const list = modifiersByGroup.get(m.modifierGroupId) ?? [];
    list.push({ id: m.id, name: m.name, price: m.price });
    modifiersByGroup.set(m.modifierGroupId, list);
  }

  const groupsByProduct = new Map<string, GuestModifierGroup[]>();
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

  const guestProducts: GuestProduct[] = productRows.map((p) => ({
    id: p.id,
    name: p.name,
    categoryId: p.categoryId,
    categoryName: p.categoryName,
    price: priceByProduct.get(p.id) ?? "0",
    // Bucket 'products' harus PUBLIC READ agar URL langsung bisa diakses customer tanpa signed URL.
    imageUrl: p.imagePath
      ? `${supabaseUrl}/storage/v1/object/public/products/${p.imagePath}`
      : null,
    variants: variantsByProduct.get(p.id) ?? [],
    modifierGroups: groupsByProduct.get(p.id) ?? [],
  }));

  return {
    outlet,
    defaultPriceTierId: defaultTier.id,
    categories: categoryRows.map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      sortOrder: c.sortOrder,
    })),
    products: guestProducts,
  };
}

// ─── Submit draft order dari customer ────────────────────────────────────────

export const guestOrderLineSchema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullable(),
  modifierIds: z.array(z.string().uuid()),
  qty: z.number().int().positive().max(99),
  note: z.string().max(200),
});

export const submitGuestOrderSchema = z.object({
  token: z.string().min(1).max(80),
  lines: z.array(guestOrderLineSchema).min(1).max(30),
  tableLabel: z.string().max(50).optional(),
});

export type SubmitGuestOrderInput = z.infer<typeof submitGuestOrderSchema>;

export type SubmitGuestOrderResult =
  | { ok: true; queueNumber: number }
  | { ok: false; error: string };

/**
 * Buat draft order dari customer (tanpa shift, device, atau kasir).
 *
 * getAdminDb() -- tidak ada sesi customer. Draft order tidak punya
 * shiftId/deviceId/cashierId. Kasir mengambilnya lewat panel "Pesanan Masuk".
 * Angka harga dari client TIDAK dipercaya -- semua di-fetch ulang dari DB.
 */
export async function submitGuestOrderWithDb(
  input: unknown
): Promise<SubmitGuestOrderResult> {
  const parsed = submitGuestOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Input tidak valid." };
  const { token, lines, tableLabel } = parsed.data;

  const resolved = await resolveOutletToken(token);
  if (!resolved) return { ok: false, error: "Token tidak valid atau outlet tidak aktif." };
  const { outletId, businessId } = resolved;

  const db = getAdminDb();

  // Fetch produk
  const productIds = [...new Set(lines.map((l) => l.productId))];
  const productRows = await db
    .select({
      id: products.id,
      name: products.name,
      categoryId: products.categoryId,
      categoryName: categories.name,
    })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(
      and(
        inArray(products.id, productIds),
        eq(products.businessId, businessId),
        eq(products.isActive, true)
      )
    );
  const productMap = new Map(productRows.map((p) => [p.id, p]));

  // Tier default
  const [defaultTierRow] = await db
    .select({ id: priceTiers.id })
    .from(priceTiers)
    .where(
      and(
        eq(priceTiers.businessId, businessId),
        eq(priceTiers.isActive, true),
        eq(priceTiers.isDefault, true)
      )
    )
    .limit(1);
  if (!defaultTierRow) return { ok: false, error: "Belum ada tingkat harga aktif." };

  // Harga
  const priceRows = await db
    .select({ productId: productPrices.productId, price: productPrices.price })
    .from(productPrices)
    .where(
      and(
        inArray(productPrices.productId, productIds),
        eq(productPrices.priceTierId, defaultTierRow.id),
        isNull(productPrices.variantId)
      )
    );
  const priceMap = new Map(priceRows.map((p) => [p.productId, p.price]));

  // Varian
  const variantIds = lines
    .map((l) => l.variantId)
    .filter((id): id is string => id !== null);
  const variantRows = variantIds.length
    ? await db
        .select()
        .from(productVariants)
        .where(and(inArray(productVariants.id, variantIds), eq(productVariants.isActive, true)))
    : [];
  const variantMap = new Map(variantRows.map((v) => [v.id, v]));

  // Modifier
  const allModifierIds = lines.flatMap((l) => l.modifierIds);
  const modifierFetchRows = allModifierIds.length
    ? await db
        .select()
        .from(modifiers)
        .where(and(inArray(modifiers.id, allModifierIds), eq(modifiers.isActive, true)))
    : [];
  const modifierFetchMap = new Map(modifierFetchRows.map((m) => [m.id, m]));

  // Nomor antrian: total orders outlet ini hari ini + 1
  const today = new Date().toISOString().slice(0, 10);
  const allTodayOrders = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.outletId, outletId), eq(orders.businessDate, today)));
  const queueNumber = allTodayOrders.length + 1;

  const orderId = crypto.randomUUID();
  const orderNumber = `GUEST-${today.replace(/-/g, "")}-${String(queueNumber).padStart(3, "0")}`;

  let subtotal = 0;
  const orderItemsToInsert: Parameters<ReturnType<typeof getAdminDb>["insert"]>[0] extends never
    ? never
    : {
        id: string;
        orderId: string;
        productId: string;
        variantId: string | null;
        productName: string;
        variantName: string | null;
        categoryName: string | null;
        qty: string;
        unitPrice: string;
        modifierTotal: string;
        grossAmount: string;
        discountAmount: string;
        allocatedOrderDiscount: string;
        netAmount: string;
        unitCogs: string;
        cogsAmount: string;
        prepStation: null;
        kitchenStatus: "pending";
        isVoided: boolean;
        voidReason: null;
        note: string | null;
        sortOrder: number;
        barangId: null;
        pemilikId: null;
        pemilikBagiPercentAtSale: null;
        pemilikShareAmount: null;
        tokoShareAmount: null;
      }[] = [];
  const orderItemModifiersToInsert: {
    id: string;
    orderItemId: string;
    modifierId: string;
    name: string;
    price: string;
    qty: string;
  }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const product = productMap.get(line.productId);
    if (!product) return { ok: false, error: `Produk tidak ditemukan.` };

    const basePrice = parseFloat(priceMap.get(line.productId) ?? "0");
    const variant = line.variantId ? variantMap.get(line.variantId) : undefined;
    const priceDelta = variant ? parseFloat(variant.priceDelta) : 0;
    const unitPrice = basePrice + priceDelta;

    let modifierTotal = 0;
    const lineModifiers = line.modifierIds
      .map((mid) => modifierFetchMap.get(mid))
      .filter((m): m is NonNullable<typeof m> => m !== undefined);
    for (const mod of lineModifiers) {
      modifierTotal += parseFloat(mod.price);
    }

    const grossAmount = line.qty * (unitPrice + modifierTotal);
    subtotal += grossAmount;

    const orderItemId = crypto.randomUUID();
    orderItemsToInsert.push({
      id: orderItemId,
      orderId,
      productId: line.productId,
      variantId: line.variantId ?? null,
      productName: product.name,
      variantName: variant?.name ?? null,
      categoryName: product.categoryName ?? null,
      qty: String(line.qty),
      unitPrice: String(unitPrice),
      modifierTotal: String(modifierTotal),
      grossAmount: String(grossAmount),
      discountAmount: "0",
      allocatedOrderDiscount: "0",
      netAmount: String(grossAmount),
      unitCogs: "0",
      cogsAmount: "0",
      prepStation: null,
      kitchenStatus: "pending" as const,
      isVoided: false,
      voidReason: null,
      note: line.note || null,
      sortOrder: i,
      barangId: null,
      pemilikId: null,
      pemilikBagiPercentAtSale: null,
      pemilikShareAmount: null,
      tokoShareAmount: null,
    });

    for (const mod of lineModifiers) {
      orderItemModifiersToInsert.push({
        id: crypto.randomUUID(),
        orderItemId,
        modifierId: mod.id,
        name: mod.name,
        price: mod.price,
        qty: "1",
      });
    }
  }

  const noteField = [
    tableLabel ? `Meja: ${tableLabel}` : "",
    `Antrian: #${queueNumber}`,
  ]
    .filter(Boolean)
    .join(" | ");

  await db.insert(orders).values({
    id: orderId,
    businessId,
    outletId,
    shiftId: null,
    deviceId: null,
    number: orderNumber,
    status: "draft",
    channel: "dine_in",
    priceTierId: defaultTierRow.id,
    tableId: null,
    customerId: null,
    guestCount: 1,
    waiterId: null,
    cashierId: null,
    subtotal: String(subtotal),
    itemDiscount: "0",
    orderDiscount: "0",
    discountTotal: "0",
    netSales: String(subtotal),
    serviceCharge: "0",
    taxAmount: "0",
    rounding: "0",
    total: String(subtotal),
    cogsTotal: "0",
    grossProfit: "0",
    commissionPercent: "0",
    commissionAmount: "0",
    externalRef: null,
    businessDate: today,
    openedAt: new Date(),
    paidAt: null,
    voidReason: null,
    note: noteField || null,
    syncedAt: null,
  });

  if (orderItemsToInsert.length > 0) {
    await db.insert(orderItems).values(
      orderItemsToInsert.map((item) => ({
        ...item,
        barangId: null,
        pemilikId: null,
        pemilikBagiPercentAtSale: null,
        pemilikShareAmount: null,
        tokoShareAmount: null,
      }))
    );
  }

  if (orderItemModifiersToInsert.length > 0) {
    await db.insert(orderItemModifiers).values(orderItemModifiersToInsert);
  }

  return { ok: true, queueNumber };
}

// ─── Query pending orders untuk kasir ────────────────────────────────────────

export type PendingOrderSummary = {
  id: string;
  number: string;
  queueNumber: string;
  openedAt: Date;
  note: string | null;
  itemCount: number;
  total: string;
  items: { name: string; qty: string; note: string | null }[];
};

/**
 * Ambil semua draft order di outlet ini yang belum diambil kasir.
 *
 * getAdminDb() -- caller (Route Handler) WAJIB memverifikasi session kasir
 * dan memastikan outletId milik businessId mereka SEBELUM memanggil ini.
 */
export async function getPendingGuestOrders(
  outletId: string
): Promise<PendingOrderSummary[]> {
  const db = getAdminDb();

  const pendingOrders = await db
    .select({
      id: orders.id,
      number: orders.number,
      openedAt: orders.openedAt,
      note: orders.note,
      total: orders.total,
    })
    .from(orders)
    .where(and(eq(orders.outletId, outletId), eq(orders.status, "draft")));

  if (pendingOrders.length === 0) return [];

  const orderIds = pendingOrders.map((o) => o.id);
  const itemRows = await db
    .select({
      orderId: orderItems.orderId,
      productName: orderItems.productName,
      qty: orderItems.qty,
      note: orderItems.note,
    })
    .from(orderItems)
    .where(and(inArray(orderItems.orderId, orderIds), eq(orderItems.isVoided, false)));

  const itemsByOrder = new Map<string, typeof itemRows>();
  for (const item of itemRows) {
    const list = itemsByOrder.get(item.orderId) ?? [];
    list.push(item);
    itemsByOrder.set(item.orderId, list);
  }

  return pendingOrders.map((o) => {
    const items = itemsByOrder.get(o.id) ?? [];
    const queueMatch = o.note?.match(/Antrian:\s*#?(\d+)/);
    return {
      id: o.id,
      number: o.number,
      queueNumber: queueMatch?.[1] ?? "?",
      openedAt: o.openedAt,
      note: o.note,
      total: o.total,
      itemCount: items.length,
      items: items.map((i) => ({
        name: i.productName,
        qty: i.qty,
        note: i.note,
      })),
    };
  });
}
