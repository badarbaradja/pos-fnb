import { Decimal } from "decimal.js";
import type { CartLine } from "@/lib/store/cart-store";
import type { CalcResult } from "@/lib/calc/order-calculator";
import { formatIDR } from "@/lib/utils/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { id as strings } from "@/lib/i18n/id";

export function CartLineRow({
  line,
  result,
  onRemove,
  onQtyChange,
  onItemDiscountChange,
  onNoteChange,
}: {
  line: CartLine;
  result: CalcResult["lines"][number] | undefined;
  onRemove: () => void;
  onQtyChange: (qty: Decimal) => void;
  onItemDiscountChange: (amount: Decimal) => void;
  onNoteChange: (note: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-medium">
            {line.productName}
            {line.variantName ? ` — ${line.variantName}` : ""}
          </div>
          {line.modifiers.length > 0 ? (
            <div className="text-xs text-muted-foreground">
              {line.modifiers.map((m) => m.name).join(", ")}
            </div>
          ) : null}
        </div>
        {/* h-11 -- target sentuh 44px, semua tombol /pos (T18b) */}
        <Button variant="ghost" size="sm" className="h-11" onClick={onRemove}>
          {strings.pos.removeLine}
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className="size-11"
          onClick={() => onQtyChange(Decimal.max(new Decimal(1), line.qty.minus(1)))}
        >
          -
        </Button>
        <span className="w-8 text-center text-sm">{line.qty.toString()}</span>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className="size-11"
          onClick={() => onQtyChange(line.qty.plus(1))}
        >
          +
        </Button>
        <span className="ml-auto text-sm font-medium">
          {result ? formatIDR(result.netAmount) : null}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <Label className="text-xs">{strings.pos.itemDiscountLabel}</Label>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={line.itemDiscount.toString()}
            onChange={(e) =>
              onItemDiscountChange(
                e.target.value === "" ? new Decimal(0) : new Decimal(e.target.value)
              )
            }
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">{strings.pos.noteLabel}</Label>
          <Input
            value={line.note}
            placeholder={strings.pos.notePlaceholder}
            onChange={(e) => onNoteChange(e.target.value)}
          />
        </div>
      </div>

      {result && !result.allocatedOrderDiscount.isZero() ? (
        <div className="text-xs text-muted-foreground">
          {strings.pos.lineDiscountAllocated}: -{formatIDR(result.allocatedOrderDiscount)}
        </div>
      ) : null}
    </div>
  );
}
