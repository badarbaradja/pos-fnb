import Decimal from "decimal.js";
import { Badge } from "@/components/ui/badge";
import { formatIDR } from "@/lib/utils/money";
import { id as strings } from "@/lib/i18n/id";
import { ReviewDialog } from "./review-dialog";
import type { AuditFlag, AuditOpnameSection, AuditOutletReport, AuditShiftReport } from "@/lib/audit/report";

function PhotoBlock({ label, path, missingReason, url }: { label: string; path: string | null; missingReason: string | null; url: string | null }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {path && url ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed URL Supabase Storage, bukan aset Next static
        <img src={url} alt={label} className="w-full max-w-xs rounded-md border object-cover" />
      ) : missingReason ? (
        <p className="text-sm text-amber-600 dark:text-amber-500">
          {strings.audit.photoFailedLabel.replace("{reason}", missingReason)}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">{strings.audit.photoNoneLabel}</p>
      )}
    </div>
  );
}

/**
 * "Yang selisihnya nol diringkas jadi satu baris, jangan ditampilkan
 * satu-satu" (instruksi eksplisit CEO) -- baseline BEDA per jenis:
 * 'buka' pakai previousClosingBalance (bisa null = tidak ada pembanding,
 * bucket TERPISAH dari "nol"), 'tutup' pakai systemQty (selalu ada).
 */
function OpnameSectionView({ title, section }: { title: string; section: AuditOpnameSection | null }) {
  if (!section || section.items.length === 0) {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{strings.audit.opnameNoFlagged}</p>
      </div>
    );
  }

  const nonZero: { name: string; unit: string; physical: string; variance: string; reason: string | null }[] = [];
  let zeroCount = 0;
  let uncountedCount = 0;
  let noBaselineCount = 0;

  for (const item of section.items) {
    const baseline = item.previousClosingBalance ?? item.systemQty;
    if (item.physicalQty === null) {
      uncountedCount++;
      continue;
    }
    if (item.previousClosingBalance === null && item.systemQty === null) {
      noBaselineCount++;
      continue;
    }
    const variance = new Decimal(item.physicalQty).minus(new Decimal(baseline));
    if (variance.isZero()) {
      zeroCount++;
      continue;
    }
    nonZero.push({
      name: item.ingredientName,
      unit: item.baseUnit,
      physical: item.physicalQty,
      variance: variance.toFixed(2),
      reason: item.varianceReason,
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm font-medium">{title}</p>
      {section.isFirstShiftAtOutlet ? (
        <p className="text-xs text-muted-foreground">{strings.audit.opnameFirstShiftNote}</p>
      ) : null}
      {nonZero.length === 0 ? (
        <p className="text-sm text-muted-foreground">{strings.common.empty}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {nonZero.map((row) => (
            <li key={row.name} className="rounded-md border border-amber-500/40 bg-amber-500/5 px-2 py-1 text-sm">
              <p>
                {strings.audit.opnameVarianceLine
                  .replace("{ingredient}", row.name)
                  .replace("{physical}", row.physical)
                  .replace("{unit}", row.unit)
                  .replace("{variance}", row.variance)}
              </p>
              {row.reason ? (
                <p className="text-xs text-muted-foreground">
                  {strings.audit.opnameReasonLine.replace("{reason}", row.reason)}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {zeroCount > 0 ? (
        <p className="text-xs text-muted-foreground">
          {strings.audit.opnameZeroVarianceSummary.replace("{count}", String(zeroCount))}
        </p>
      ) : null}
      {uncountedCount > 0 ? (
        <p className="text-xs text-muted-foreground">
          {strings.audit.opnameUncountedSummary.replace("{count}", String(uncountedCount))}
        </p>
      ) : null}
      {noBaselineCount > 0 ? (
        <p className="text-xs text-muted-foreground">{strings.audit.opnameFirstShiftNote}</p>
      ) : null}
    </div>
  );
}

function flagLabel(flag: AuditFlag): string {
  switch (flag.kind) {
    case "prepare_photo_failed":
      return strings.audit.flagPrepareCameraFailed.replace("{reason}", flag.detail ?? "");
    case "closing_photo_failed":
      return strings.audit.flagClosingCameraFailed.replace("{reason}", flag.detail ?? "");
    case "force_closed":
      return strings.audit.flagForceClosed;
    case "cash_variance_out_of_tolerance":
      return strings.audit.flagCashVarianceOutOfTolerance.replace(
        "{variance}",
        flag.detail ? formatIDR(new Decimal(flag.detail)) : ""
      );
  }
}

function ShiftBlock({
  shift,
  preparePhotoUrl,
  closingPhotoUrl,
}: {
  shift: AuditShiftReport;
  preparePhotoUrl: string | null;
  closingPhotoUrl: string | null;
}) {
  const timeRange = strings.audit.shiftTimeRange
    .replace("{opened}", new Date(shift.openedAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }))
    .replace(
      "{closed}",
      shift.closedAt
        ? new Date(shift.closedAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })
        : strings.audit.shiftStillOpen
    );

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <p className="font-medium">{strings.audit.shiftLabel.replace("{employee}", shift.employeeName)}</p>
        <span className="text-xs text-muted-foreground">{timeRange}</span>
      </div>

      <div>
        <p className="text-sm font-medium">{strings.audit.sectionPrepare}</p>
        <PhotoBlock
          label={strings.audit.sectionPrepare}
          path={shift.prepare.photoPath}
          missingReason={shift.prepare.photoMissingReason}
          url={preparePhotoUrl}
        />
        <p className="mt-1 text-sm">
          {shift.prepare.hasEvent === null
            ? strings.audit.prepareEventUnanswered
            : shift.prepare.hasEvent
              ? `${strings.audit.prepareEventYes}${shift.prepare.eventNote ? ` -- ${shift.prepare.eventNote}` : ""}`
              : strings.audit.prepareEventNo}
        </p>
      </div>

      <OpnameSectionView title={strings.audit.sectionOpnameBuka} section={shift.opnameBuka} />

      <div>
        <p className="text-sm font-medium">{strings.audit.sectionSales}</p>
        <p className="text-sm">
          {strings.audit.salesSummaryLine
            .replace("{count}", String(shift.sales.orderCount))
            .replace("{total}", formatIDR(new Decimal(shift.sales.netTotal)))}
        </p>
      </div>

      <OpnameSectionView title={strings.audit.sectionOpnameTutup} section={shift.opnameTutup} />

      <div>
        <p className="text-sm font-medium">{strings.audit.sectionClosing}</p>
        <PhotoBlock
          label={strings.audit.sectionClosing}
          path={shift.closing.photoPath}
          missingReason={shift.closing.photoMissingReason}
          url={closingPhotoUrl}
        />
        <p className="mt-1 text-sm">
          {shift.closing.cleanlinessNote ? (
            <>
              <span className="text-xs text-muted-foreground">{strings.audit.cleanlinessNoteLabel}: </span>
              {shift.closing.cleanlinessNote}
            </>
          ) : (
            <span className="text-muted-foreground">{strings.audit.cleanlinessNoteNone}</span>
          )}
        </p>
      </div>

      <div>
        <p className="text-sm font-medium">{strings.audit.sectionFlags}</p>
        {shift.flags.length === 0 ? (
          <p className="text-sm text-muted-foreground">{strings.audit.noFlags}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {shift.flags.map((flag, i) => (
              <li key={i}>
                <Badge variant="destructive">{flagLabel(flag)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function AuditOutletCard({
  outlet,
  businessDate,
  photoUrls,
}: {
  outlet: AuditOutletReport;
  businessDate: string;
  photoUrls: Map<string, { preparePhotoUrl: string | null; closingPhotoUrl: string | null }>;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading text-lg font-semibold">{outlet.outletName}</h2>
        <ReviewDialog
          outletId={outlet.outletId}
          outletName={outlet.outletName}
          businessDate={businessDate}
          alreadyReviewed={outlet.review !== null}
        />
      </div>

      {outlet.review ? (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-2 text-sm">
          <p>
            {strings.audit.reviewedByLine
              .replace("{name}", outlet.review.reviewedByName)
              .replace("{at}", new Date(outlet.review.reviewedAt).toLocaleString("id-ID"))}
          </p>
          {outlet.review.note ? <p className="text-muted-foreground">{outlet.review.note}</p> : null}
        </div>
      ) : null}

      {outlet.shifts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{strings.audit.noShiftsToday}</p>
      ) : (
        outlet.shifts.map((shift) => (
          <ShiftBlock
            key={shift.shiftId}
            shift={shift}
            preparePhotoUrl={photoUrls.get(shift.shiftId)?.preparePhotoUrl ?? null}
            closingPhotoUrl={photoUrls.get(shift.shiftId)?.closingPhotoUrl ?? null}
          />
        ))
      )}
    </section>
  );
}
