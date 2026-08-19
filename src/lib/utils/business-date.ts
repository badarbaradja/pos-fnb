import { toZonedTime } from "date-fns-tz";
import { format, subDays } from "date-fns";

// Diekspor supaya form outlet (T22b) bisa validasi format yang sama persis
// sebelum tersimpan, bukan cuma menduplikasi regex di tempat terpisah.
export const CUTOFF_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

/**
 * businessDate() — CALC-SPEC bagian F.
 *
 * local = konversi createdAt ke timezone outlet
 * kalau jam(local) < dayCutoffTime → tanggal(local) − 1 hari
 * selain itu                       → tanggal(local)
 *
 * @param createdAt instant UTC (mis. Date.now() atau dari DB timestamptz)
 * @param timezone IANA timezone outlet, mis. "Asia/Jakarta"
 * @param dayCutoffTime format "HH:mm" atau "HH:mm:ss", mis. outlet.day_cutoff_time
 * @returns tanggal bisnis dalam format "yyyy-MM-dd"
 */
export function businessDate(
  createdAt: Date,
  timezone: string,
  dayCutoffTime: string
): string {
  const cutoffSeconds = parseCutoffSeconds(dayCutoffTime);

  const zoned = toZonedTime(createdAt, timezone);
  const localSeconds =
    zoned.getHours() * 3600 + zoned.getMinutes() * 60 + zoned.getSeconds();
  const localDate = new Date(
    zoned.getFullYear(),
    zoned.getMonth(),
    zoned.getDate()
  );

  const businessDay =
    localSeconds < cutoffSeconds ? subDays(localDate, 1) : localDate;

  return format(businessDay, "yyyy-MM-dd");
}

function parseCutoffSeconds(dayCutoffTime: string): number {
  const match = CUTOFF_PATTERN.exec(dayCutoffTime);
  if (!match) {
    throw new Error(
      `dayCutoffTime tidak valid, harus format "HH:mm" atau "HH:mm:ss": ${dayCutoffTime}`
    );
  }
  const [, hh, mm, ss] = match;
  return Number(hh) * 3600 + Number(mm) * 60 + Number(ss ?? 0);
}
