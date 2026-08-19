import { z } from "zod";
import type { UserDbHandle } from "@/lib/db/client";
import { brands } from "@/lib/db/schema";
import { isUniqueViolation } from "@/lib/db/errors";
import { id as strings } from "@/lib/i18n/id";

/**
 * lib/brands/manage.ts — T22a. Cuma createBrandWithDb (dipanggil inline dari
 * form outlet, docs/05-RENCANA-FASE-2.md §8.b) -- BELUM ada halaman kelola
 * brand tersendiri (list/ubah/nonaktifkan). Sengaja diminimalkan supaya
 * pemilik bisa membuat brand baru (mis. "Indosteak") tepat saat menambah
 * outlet pertamanya, tanpa memblokir di belakang halaman terpisah yang
 * belum dibangun. Halaman kelola penuh menyusul kalau kebutuhannya nyata
 * (pola sama seperti T22b menyusul dari kebutuhan T22).
 */

type Db = UserDbHandle["db"];

const createBrandSchema = z.object({
  name: z.string().trim().min(1, strings.common.requiredField),
});

export type BrandActionResult = {
  error?: string;
  success?: { brandId: string; name: string };
};

export async function createBrandWithDb(
  db: Db,
  businessId: string,
  rawInput: unknown
): Promise<BrandActionResult> {
  const parsed = createBrandSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? strings.common.unexpectedError };
  }
  const data = parsed.data;

  try {
    const [row] = await db
      .insert(brands)
      .values({ businessId, name: data.name })
      .returning({ id: brands.id, name: brands.name });
    return { success: { brandId: row!.id, name: row!.name } };
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { error: strings.brands.duplicateName };
    }
    throw err;
  }
}
