import { eq } from "drizzle-orm";
import type { UserDbHandle } from "@/lib/db/client";
import { businesses, outlets } from "@/lib/db/schema";
import { id as strings } from "@/lib/i18n/id";

type Db = UserDbHandle["db"];

export type UpdateBusinessTimezoneResult = {
  error?: string;
  success?: { businessId: string };
};

function isValidIanaTimezone(timezone: string): boolean {
  try {
    // Cuma dipakai untuk efek validasinya (melempar RangeError kalau zona
    // tidak dikenal ICU), bukan hasilnya.
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * lib/businesses/manage.ts — TT11 koreksi (12 September 2026, atas
 * temuan CEO). BELUM ADA halaman pengaturan bisnis mana pun di proyek
 * ini yang mengubah businesses.timezone sekarang -- fungsi ini
 * dibangun sebagai MEKANISME AMAN yang siap dipakai begitu halaman itu
 * (atau skrip admin) dibangun, BUKAN fitur UI baru. Ditulis terpisah,
 * bukan bagian lib/outlets/manage.ts, karena timezone properti BISNIS
 * (satu nilai untuk semua outlet), bukan properti per-outlet.
 *
 * Kenapa reset ini penting: batas periode laporan bagi hasil (TT11)
 * ditentukan DUA nilai bersama -- dayCutoffTime outlet DAN
 * businesses.timezone. Begitu timezone berubah, SEMUA konfirmasi
 * dayCutoffTime outlet yang sudah ada tidak lagi bisa dipercaya ("04:00"
 * di WIB dan "04:00" di WITA adalah momen yang berbeda) -- WAJIB
 * direset ke belum-dikonfirmasi, pola sama persis yang sudah dibangun
 * untuk perubahan dayCutoffTime itu sendiri (lib/outlets/manage.ts,
 * updateOutletWithDb).
 */
export async function updateBusinessTimezoneWithDb(
  db: Db,
  businessId: string,
  newTimezone: string
): Promise<UpdateBusinessTimezoneResult> {
  if (!isValidIanaTimezone(newTimezone)) {
    return { error: strings.businesses.timezoneInvalid.replace("{timezone}", newTimezone) };
  }

  const [current] = await db
    .select({ timezone: businesses.timezone })
    .from(businesses)
    .where(eq(businesses.id, businessId));
  if (!current) {
    return { error: strings.businesses.notFound };
  }

  if (current.timezone === newTimezone) {
    // Sama nilainya -- tidak ada yang berubah, tidak perlu mereset
    // konfirmasi siapa pun (sejajar dengan perbandingan by-value
    // parseCutoffSeconds di updateOutletWithDb, bukan string mentah).
    return { success: { businessId } };
  }

  await db.update(businesses).set({ timezone: newTimezone }).where(eq(businesses.id, businessId));

  // SEMUA outlet bisnis ini sekaligus -- zona waktu bukan properti satu
  // outlet, jadi perubahannya mempengaruhi perhitungan cutoff SETIAP
  // outlet bisnis ini, bukan cuma yang sedang dibuka di UI saat ini.
  await db
    .update(outlets)
    .set({ dayCutoffConfirmed: false })
    .where(eq(outlets.businessId, businessId));

  return { success: { businessId } };
}
