"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requirePermissionDb } from "@/lib/auth/permissions";
import {
  products,
  productVariants,
  productPrices,
  productModifierGroups,
  modifierGroups,
  priceTiers,
} from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";
import { getProductImagePath, validateProductImage } from "@/lib/products/image";
import { id as strings } from "@/lib/i18n/id";

const productTypeValues = [
  "simple",
  "recipe",
  "bundle",
  "service",
  "open_price",
] as const;

const productSchema = z.object({
  id: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  sku: z.string().trim().optional(),
  barcode: z.string().trim().optional(),
  name: z.string().trim().min(1, strings.common.requiredField),
  description: z.string().trim().optional(),
  productType: z.enum(productTypeValues),
  trackStock: z.boolean(),
  isFavorite: z.boolean(),
  isTaxable: z.boolean(),
  prepStation: z.string().trim().optional(),
  prepMinutes: z.coerce.number().int().optional(),
  sortOrder: z.coerce.number().int(),
  isActive: z.boolean(),
});

const variantRowSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1),
  sku: z.string().trim().optional(),
  priceDelta: z.coerce.number(),
  isDefault: z.boolean(),
  isActive: z.boolean(),
});

export type ProductFormState = {
  error?: string;
};

export async function saveProduct(
  _prevState: ProductFormState,
  formData: FormData
): Promise<ProductFormState> {
  const parsed = productSchema.safeParse({
    id: formData.get("id") || undefined,
    categoryId: formData.get("categoryId") || undefined,
    sku: formData.get("sku") || undefined,
    barcode: formData.get("barcode") || undefined,
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    productType: formData.get("productType"),
    trackStock: formData.get("trackStock") === "on",
    isFavorite: formData.get("isFavorite") === "on",
    isTaxable: formData.get("isTaxable") === "on",
    prepStation: formData.get("prepStation") || undefined,
    prepMinutes: formData.get("prepMinutes") || undefined,
    sortOrder: formData.get("sortOrder") || 0,
    isActive: formData.get("isActive") === "on",
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError,
    };
  }

  const variantCount = Number(formData.get("variantCount") ?? 0);
  const variantRows: z.infer<typeof variantRowSchema>[] = [];
  for (let i = 0; i < variantCount; i++) {
    const rowParsed = variantRowSchema.safeParse({
      id: formData.get(`variants.${i}.id`) || undefined,
      name: formData.get(`variants.${i}.name`),
      sku: formData.get(`variants.${i}.sku`) || undefined,
      priceDelta: formData.get(`variants.${i}.priceDelta`) || 0,
      isDefault: formData.get(`variants.${i}.isDefault`) === "on",
      isActive: formData.get(`variants.${i}.isActive`) === "on",
    });
    if (rowParsed.success && rowParsed.data.name) {
      variantRows.push(rowParsed.data);
    }
  }

  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "product.manage"
  );

  const isNewProduct = !parsed.data.id;
  const productId = parsed.data.id ?? generateId();

  try {
    // Grup modifier & tingkat harga milik bisnis lain tidak boleh ter-assign
    // ke produk ini -- diverifikasi eksplisit di sini, bukan cuma
    // mengandalkan RLS (CLAUDE.md §3.4).
    const [ownModifierGroups, ownPriceTiers] = await Promise.all([
      db
        .select({ id: modifierGroups.id })
        .from(modifierGroups)
        .where(eq(modifierGroups.businessId, businessId)),
      db
        .select({ id: priceTiers.id })
        .from(priceTiers)
        .where(eq(priceTiers.businessId, businessId)),
    ]);

    const selectedModifierGroupIds = ownModifierGroups
      .map((g) => g.id)
      .filter((groupId) => formData.get(`modifierGroup.${groupId}`) === "on");

    const priceEntries = ownPriceTiers
      .map((tier) => ({
        tierId: tier.id,
        price: formData.get(`price.${tier.id}`),
      }))
      .filter(
        (entry): entry is { tierId: string; price: string } =>
          typeof entry.price === "string" && entry.price.trim() !== ""
      );

    // --- Gambar produk (T09c) --- productId sudah pasti ada di titik ini
    // (baru digenerate di atas kalau produk baru), jadi path deterministik
    // {businessId}/{productId}.jpg sudah bisa dipakai SEBELUM transaction
    // DB. Validasi di sini adalah penegakan SUNGGUHAN (bukan cuma di
    // client) -- kompresi/resize client cuma kenyamanan.
    const imageFile = formData.get("imageFile");
    const imageRemoved = formData.get("imageRemoved") === "1";
    // undefined = kolom imagePath tidak disentuh sama sekali (tidak ada
    // file baru & tidak dihapus) -- beda dari null (dihapus).
    let imagePathUpdate: string | null | undefined;

    if (imageFile instanceof File && imageFile.size > 0) {
      const validationError = validateProductImage(imageFile);
      if (validationError) {
        return { error: validationError };
      }
      const path = getProductImagePath(businessId, productId);
      // upsert:true ke path DETERMINISTIK -- mengganti gambar = menimpa
      // langsung, tidak pernah ada file lama tertinggal (lihat komentar
      // getProductImagePath). Pakai `supabase` (sesi user), bukan admin
      // client, supaya RLS Storage yang baru dibuat benar-benar dilewati
      // jalur produksi (CLAUDE.md §3.4).
      const { error: uploadError } = await supabase.storage
        .from("products")
        .upload(path, imageFile, { upsert: true, contentType: "image/jpeg" });
      if (uploadError) {
        console.error("Upload gambar produk gagal:", uploadError);
        return { error: strings.common.unexpectedError };
      }
      imagePathUpdate = path;
    } else if (imageRemoved) {
      const path = getProductImagePath(businessId, productId);
      await supabase.storage.from("products").remove([path]);
      imagePathUpdate = null;
    }

    await db.transaction(async (tx) => {
      if (!isNewProduct) {
        await tx
          .update(products)
          .set({
            categoryId: parsed.data.categoryId ?? null,
            sku: parsed.data.sku ?? null,
            barcode: parsed.data.barcode ?? null,
            name: parsed.data.name,
            description: parsed.data.description ?? null,
            productType: parsed.data.productType,
            trackStock: parsed.data.trackStock,
            isFavorite: parsed.data.isFavorite,
            isTaxable: parsed.data.isTaxable,
            prepStation: parsed.data.prepStation ?? null,
            prepMinutes: parsed.data.prepMinutes ?? null,
            sortOrder: parsed.data.sortOrder,
            isActive: parsed.data.isActive,
            ...(imagePathUpdate !== undefined ? { imagePath: imagePathUpdate } : {}),
          })
          .where(and(eq(products.id, productId), eq(products.businessId, businessId)));
      } else {
        await tx.insert(products).values({
          id: productId,
          businessId,
          categoryId: parsed.data.categoryId ?? null,
          sku: parsed.data.sku ?? null,
          barcode: parsed.data.barcode ?? null,
          name: parsed.data.name,
          description: parsed.data.description ?? null,
          imagePath: imagePathUpdate ?? null,
          productType: parsed.data.productType,
          trackStock: parsed.data.trackStock,
          isFavorite: parsed.data.isFavorite,
          isTaxable: parsed.data.isTaxable,
          prepStation: parsed.data.prepStation ?? null,
          prepMinutes: parsed.data.prepMinutes ?? null,
          sortOrder: parsed.data.sortOrder,
          isActive: parsed.data.isActive,
        });
      }

      for (const variant of variantRows) {
        if (variant.id) {
          await tx
            .update(productVariants)
            .set({
              name: variant.name,
              sku: variant.sku ?? null,
              priceDelta: String(variant.priceDelta),
              isDefault: variant.isDefault,
              isActive: variant.isActive,
            })
            .where(
              and(
                eq(productVariants.id, variant.id),
                eq(productVariants.productId, productId)
              )
            );
        } else {
          await tx.insert(productVariants).values({
            id: generateId(),
            productId: productId,
            name: variant.name,
            sku: variant.sku ?? null,
            priceDelta: String(variant.priceDelta),
            isDefault: variant.isDefault,
            isActive: variant.isActive,
          });
        }
      }

      for (const entry of priceEntries) {
        await tx
          .insert(productPrices)
          .values({
            id: generateId(),
            productId: productId,
            variantId: null,
            priceTierId: entry.tierId,
            outletId: null,
            price: entry.price,
            validFrom: null,
            validTo: null,
          })
          .onConflictDoUpdate({
            target: [
              productPrices.productId,
              productPrices.variantId,
              productPrices.priceTierId,
              productPrices.outletId,
              productPrices.validFrom,
            ],
            set: { price: entry.price },
          });
      }

      const existingAssignments = await tx
        .select({ modifierGroupId: productModifierGroups.modifierGroupId })
        .from(productModifierGroups)
        .where(eq(productModifierGroups.productId, productId));
      const existingIds = new Set(existingAssignments.map((a) => a.modifierGroupId));
      const selectedIds = new Set(selectedModifierGroupIds);

      const toInsert = [...selectedIds].filter((gid) => !existingIds.has(gid));
      const toDelete = [...existingIds].filter((gid) => !selectedIds.has(gid));

      if (toInsert.length > 0) {
        await tx.insert(productModifierGroups).values(
          toInsert.map((modifierGroupId) => ({
            productId: productId,
            modifierGroupId,
          }))
        );
      }
      if (toDelete.length > 0) {
        await tx
          .delete(productModifierGroups)
          .where(
            and(
              eq(productModifierGroups.productId, productId),
              inArray(productModifierGroups.modifierGroupId, toDelete)
            )
          );
      }
    });
  } finally {
    await closeDb();
  }

  revalidatePath("/products");
  redirect(`/products/${productId}`);
}

export type SetProductActiveResult = { error?: string };

/**
 * Tombol nonaktifkan/aktifkan satu klik di daftar produk -- sebelumnya
 * cuma bisa lewat checkbox di dalam form edit lengkap, terlalu tersembunyi
 * untuk aksi sesering ini (audit kelengkapan master data). Produk TIDAK
 * PERNAH dihapus (master data, CLAUDE.md §3.2).
 */
export async function setProductActive(
  id: string,
  isActive: boolean
): Promise<SetProductActiveResult> {
  const parsed = z.object({ id: z.string().uuid(), isActive: z.boolean() }).safeParse({
    id,
    isActive,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }

  const supabase = await createServerSupabaseClient();
  const { db, closeDb, businessId } = await requirePermissionDb(
    supabase,
    "product.manage"
  );

  try {
    await db
      .update(products)
      .set({ isActive: parsed.data.isActive })
      .where(and(eq(products.id, parsed.data.id), eq(products.businessId, businessId)));
  } finally {
    await closeDb();
  }

  revalidatePath("/products");
  return {};
}
