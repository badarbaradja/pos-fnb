import { toZonedTime } from "date-fns-tz";
import { format } from "date-fns";
import type { OpenShiftSummaryRow } from "@/lib/pos/shift";
import { id as strings } from "@/lib/i18n/id";

export function ShiftStatusList({
  shifts,
  multiOutlet,
  timezone,
}: {
  shifts: OpenShiftSummaryRow[];
  multiOutlet: boolean;
  timezone: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="font-heading text-sm font-semibold">
        {strings.dashboardHome.shiftStatusTitle}
      </h2>
      {shifts.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
          {strings.dashboardHome.shiftStatusEmpty}
        </p>
      ) : (
        <ul className="flex flex-col gap-1 rounded-xl border bg-card p-2 shadow-xs">
          {shifts.map((shift) => (
            <li key={shift.id} className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm">
              <span className="size-2 shrink-0 rounded-full bg-success" />
              <span className="flex-1 font-medium">
                {shift.employeeName}
                {multiOutlet ? (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">{shift.outletName}</span>
                ) : null}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {strings.dashboardHome.shiftSince.replace(
                  "{time}",
                  format(toZonedTime(shift.openedAt, timezone), "HH:mm")
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
