import { Decimal } from "decimal.js";
import { formatIDR } from "@/lib/utils/money";

export function TotalRow({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: Decimal;
  emphasize?: boolean;
}) {
  return (
    <div
      className={
        emphasize
          ? "flex items-center justify-between border-t pt-2 mt-1 text-lg font-bold text-primary"
          : "flex items-center justify-between text-muted-foreground"
      }
    >
      <span>{label}</span>
      <span className="tabular-nums">{formatIDR(value)}</span>
    </div>
  );
}
