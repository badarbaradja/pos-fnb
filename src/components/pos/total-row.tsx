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
          ? "flex items-center justify-between border-t pt-1 text-base font-semibold"
          : "flex items-center justify-between text-muted-foreground"
      }
    >
      <span>{label}</span>
      <span>{formatIDR(value)}</span>
    </div>
  );
}
