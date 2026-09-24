import Link from "next/link";
import { eq } from "drizzle-orm";
import { subDays, addDays, format, parseISO } from "date-fns";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { requireAuditAccessDb } from "@/lib/audit/access";
import { getAuditDailyReport } from "@/lib/audit/report";
import { businesses } from "@/lib/db/schema";
import { businessDate as computeBusinessDate } from "@/lib/utils/business-date";
import { AuditOutletCard } from "@/components/dashboard/audit/audit-outlet-card";
import { id as strings } from "@/lib/i18n/id";

/**
 * Halaman Auditor (24 September 2026) -- SATU halaman, SEMUA outlet,
 * SATU hari bisnis. Dirancang untuk HP (Ita membukanya di tablet/HP tiap
 * pagi) -- satu kolom, kartu per outlet, bukan tabel lebar.
 *
 * Kalau requireAuditAccessDb() melempar (bukan owner/akuntan DAN
 * audit_all_outlets belum diaktifkan), halaman ini SENGAJA menampilkan
 * pesan "tidak punya akses" alih-alih membiarkan Next.js melempar error
 * generik -- ini gerbang yang DIHARAPKAN dipakai orang biasa (Ita),
 * bukan cuma jalur developer.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createServerSupabaseClient();

  let access;
  try {
    access = await requireAuditAccessDb(supabase);
  } catch {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">{strings.audit.title}</h1>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <p className="font-medium text-destructive">{strings.audit.noAccessTitle}</p>
          <p className="text-sm text-muted-foreground">{strings.audit.noAccessBody}</p>
        </div>
      </div>
    );
  }

  const { db, closeDb, businessId } = access;

  try {
    const [business] = await db
      .select({ timezone: businesses.timezone })
      .from(businesses)
      .where(eq(businesses.id, businessId));
    const timezone = business?.timezone ?? "Asia/Jakarta";

    // Default: HARI SEBELUMNYA (Ita meninjau hari sebelumnya tiap pagi) --
    // dihitung dari kalender lokal bisnis, cutoff tengah malam (00:00:00)
    // murni untuk "tanggal kalender hari ini di zona waktu bisnis", BUKAN
    // menduplikasi logika cutoff per outlet (businessDate per shift sudah
    // benar tersimpan sendiri-sendiri di kolom shifts.business_date).
    const todayLocal = computeBusinessDate(new Date(), timezone, "00:00:00");
    const defaultDate = format(subDays(parseISO(todayLocal), 1), "yyyy-MM-dd");
    const businessDateParam = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : defaultDate;

    const report = await getAuditDailyReport(db, businessId, businessDateParam);

    // Signed URL SEKALI per foto (bukan di komponen -- komponen server
    // tidak punya akses supabase client, dan tidak boleh membuat request
    // storage sendiri-sendiri per render).
    const photoUrls = new Map<string, { preparePhotoUrl: string | null; closingPhotoUrl: string | null }>();
    for (const outlet of report.outlets) {
      for (const shift of outlet.shifts) {
        let preparePhotoUrl: string | null = null;
        let closingPhotoUrl: string | null = null;
        if (shift.prepare.photoPath) {
          const { data } = await supabase.storage
            .from("shift-reports")
            .createSignedUrl(shift.prepare.photoPath, 3600);
          preparePhotoUrl = data?.signedUrl ?? null;
        }
        if (shift.closing.photoPath) {
          const { data } = await supabase.storage
            .from("shift-reports")
            .createSignedUrl(shift.closing.photoPath, 3600);
          closingPhotoUrl = data?.signedUrl ?? null;
        }
        photoUrls.set(shift.shiftId, { preparePhotoUrl, closingPhotoUrl });
      }
    }

    const prevDate = format(subDays(parseISO(businessDateParam), 1), "yyyy-MM-dd");
    const nextDate = format(addDays(parseISO(businessDateParam), 1), "yyyy-MM-dd");

    return (
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">{strings.audit.title}</h1>
          <div className="flex items-center justify-between text-sm">
            <Link href={`/audit?date=${prevDate}`} className="text-primary underline">
              {strings.audit.prevDay}
            </Link>
            <span className="font-medium">{businessDateParam}</span>
            <Link href={`/audit?date=${nextDate}`} className="text-primary underline">
              {strings.audit.nextDay}
            </Link>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          {report.outlets.map((outlet) => (
            <AuditOutletCard
              key={outlet.outletId}
              outlet={outlet}
              businessDate={businessDateParam}
              photoUrls={photoUrls}
            />
          ))}
        </div>
      </div>
    );
  } finally {
    await closeDb();
  }
}
