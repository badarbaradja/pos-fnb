import { and, eq } from "drizzle-orm";
import type { UserDbHandle } from "@/lib/db/client";
import { employees, outlets } from "@/lib/db/schema";

type Db = UserDbHandle["db"];

export type KasirDestination = {
  outletId: string;
  outletName: string;
  href: "/pos" | "/pos/thrift";
};

/**
 * lib/pos/kasir-shortcut.ts — tombol "Buka Kasir" di dashboard (instruksi
 * CEO 12 September 2026): jangan suruh orang mengetik /pos atau /pos/thrift
 * manual. Ini MURNI jalan pintas navigasi, BUKAN lapisan otorisasi -- siapa
 * pun yang sudah login dashboard sudah bisa mengetik kedua URL itu sendiri,
 * jadi menampilkan outlet mana pun di sini tidak membuka apa pun yang
 * sebelumnya tertutup (lihat catatan di RENCANA-PEMBANGUNAN-KASIR-THRIFTING.md
 * soal pembatasan outlet yang DITUNDA -- fungsi ini sengaja tidak menunggu
 * itu).
 *
 * Pakai employees.userId (jembatan yang sudah ada di skema, sebelumnya cuma
 * dipakai untuk atribusi void/refund di lib/pos/void-refund.ts) untuk
 * mencocokkan akun dashboard yang login dengan baris employee PIN-nya.
 * Owner, atau siapa pun tanpa baris employees tertaut, dianggap berhak lihat
 * SEMUA outlet aktif -- supaya tombol ini tidak pernah kosong tanpa
 * penjelasan.
 */
export async function getKasirDestinationsForUser(
  db: Db,
  businessId: string,
  userId: string,
  role: string
): Promise<KasirDestination[]> {
  if (role !== "owner") {
    const linked = await db
      .select({ id: outlets.id, name: outlets.name, posMode: outlets.posMode })
      .from(employees)
      .innerJoin(outlets, eq(employees.outletId, outlets.id))
      .where(
        and(
          eq(employees.businessId, businessId),
          eq(employees.userId, userId),
          eq(employees.isActive, true),
          eq(outlets.isActive, true)
        )
      );
    if (linked.length > 0) {
      return dedupeByOutlet(linked);
    }
  }

  const allActive = await db
    .select({ id: outlets.id, name: outlets.name, posMode: outlets.posMode })
    .from(outlets)
    .where(and(eq(outlets.businessId, businessId), eq(outlets.isActive, true)));
  return dedupeByOutlet(allActive);
}

function dedupeByOutlet(
  rows: { id: string; name: string; posMode: "fnb" | "thrifting" }[]
): KasirDestination[] {
  const seen = new Map<string, KasirDestination>();
  for (const r of rows) {
    if (!seen.has(r.id)) {
      seen.set(r.id, {
        outletId: r.id,
        outletName: r.name,
        href: r.posMode === "thrifting" ? "/pos/thrift" : "/pos",
      });
    }
  }
  return [...seen.values()];
}
