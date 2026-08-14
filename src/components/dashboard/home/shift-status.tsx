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
      <h2 className="text-sm font-semibold text-muted-foreground">
        {strings.dashboardHome.shiftStatusTitle}
      </h2>
      {shifts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{strings.dashboardHome.shiftStatusEmpty}</p>
      ) : (
        <ul className="flex flex-col gap-2 rounded-lg border p-3">
          {shifts.map((shift) => (
            <li key={shift.id} className="flex items-center justify-between text-sm">
              <span className="font-medium">
                {shift.employeeName}
                {multiOutlet ? (
                  <span className="ml-2 text-xs text-muted-foreground">{shift.outletName}</span>
                ) : null}
              </span>
              <span className="text-xs text-muted-foreground">
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
