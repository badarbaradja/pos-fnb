import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { addDays, format, parseISO, subDays } from "date-fns";

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

/**
 * §14 prasyarat shift, poin Indokopi 24 jam (13 September 2026) -- instant
 * UTC persis kapan hari bisnis SEKARANG akan berakhir (dayCutoffTime
 * berikutnya). Dipakai peringatan pergantian shift di layar kasir.
 *
 * businessDate(now) = X berarti hari bisnis X SEDANG berjalan, dan
 * berakhir di dayCutoffTime pada KALENDER besoknya X (bukan kalender
 * hari ini) -- businessDate() sendiri mundur satu hari kalender kalau
 * jam lokal < cutoff, jadi cutoff yang MENGAKHIRI hari bisnis X selalu
 * jatuh di X+1 pada kalender.
 */
export function nextCutoffInstant(
  now: Date,
  timezone: string,
  dayCutoffTime: string
): Date {
  const currentBusinessDate = businessDate(now, timezone, dayCutoffTime);
  const nextCalendarDate = format(addDays(parseISO(currentBusinessDate), 1), "yyyy-MM-dd");
  return fromZonedTime(`${nextCalendarDate}T${dayCutoffTime}`, timezone);
}

// Diekspor supaya lib/outlets/manage.ts bisa membandingkan dayCutoffTime
// SEBAGAI NILAI (detik), bukan string mentah -- "04:00" dan "04:00:00"
// sama nilainya tapi beda string, dan Postgres selalu menyimpan `time`
// dengan detik (TT11, 12 September 2026).
// Tiga zona waktu resmi Indonesia -- BUKAN tabel yang bisa berkembang bebas,
// ini standar negara (UU/Kepres zona waktu), aman dipetakan tetap. Zona di
// LUAR ketiga ini (kalau suatu saat ada bisnis di luar Indonesia) sengaja
// TIDAK ditebak singkatannya -- dikembalikan apa adanya (nama IANA) daripada
// mengarang singkatan yang salah (TT11, koreksi CEO 12 September 2026:
// "batas hari 04:00" tanpa zona waktu tidak berarti apa-apa untuk konfirmasi
// manusia).
const INDONESIA_TIMEZONE_LABELS: Record<string, string> = {
  "Asia/Jakarta": "WIB",
  "Asia/Pontianak": "WIB",
  "Asia/Makassar": "WITA",
  "Asia/Jayapura": "WIT",
};

export function formatTimezoneAbbreviation(timezone: string): string {
  return INDONESIA_TIMEZONE_LABELS[timezone] ?? timezone;
}

export function parseCutoffSeconds(dayCutoffTime: string): number {
  const match = CUTOFF_PATTERN.exec(dayCutoffTime);
  if (!match) {
    throw new Error(
      `dayCutoffTime tidak valid, harus format "HH:mm" atau "HH:mm:ss": ${dayCutoffTime}`
    );
  }
  const [, hh, mm, ss] = match;
  return Number(hh) * 3600 + Number(mm) * 60 + Number(ss ?? 0);
}
