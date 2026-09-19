import { Decimal } from "decimal.js";
import { MinusIcon, PlusIcon, XIcon } from "lucide-react";
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
    <div className="flex flex-col gap-2.5 rounded-xl border bg-card p-3 shadow-xs min-w-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium leading-snug">
            {line.productName}
            {line.variantName ? ` — ${line.variantName}` : ""}
          </div>
          {line.modifiers.length > 0 ? (
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {line.modifiers.map((m) => m.name).join(", ")}
            </div>
          ) : null}
        </div>
        {/* Hapus -- secondary/destructive, TIDAK boleh mendominasi baris ini
            (instruksi eksplisit Phase 2). Ikon polos + target 44px, bukan
            tombol teks lebar. */}
        <Button
          variant="ghost"
          size="icon-touch"
          className="shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          onClick={onRemove}
          aria-label={strings.pos.removeLine}
        >
          <XIcon className="size-4" />
        </Button>
      </div>

      <div className="flex items-center gap-3">
        {/* Qty stepper -- aksi utama baris ini (instruksi eksplisit Phase
            2), target sentuh penuh 44px. */}
        <Button
          type="button"
          variant="outline"
          size="icon-touch"
          className="rounded-full shrink-0"
          onClick={() => onQtyChange(Decimal.max(new Decimal(1), line.qty.minus(1)))}
        >
          <MinusIcon className="size-4" />
        </Button>
        <span className="w-6 text-center text-base font-semibold tabular-nums">{line.qty.toString()}</span>
        <Button
          type="button"
          variant="outline"
          size="icon-touch"
          className="rounded-full shrink-0"
          onClick={() => onQtyChange(line.qty.plus(1))}
        >
          <PlusIcon className="size-4" />
        </Button>
        <span className="ml-auto text-sm font-semibold text-foreground tabular-nums">
          {result ? formatIDR(result.netAmount) : null}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <Label className="text-[11px] text-muted-foreground">{strings.pos.itemDiscountLabel}</Label>
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            inputSize="touch"
            className="text-sm"
            value={line.itemDiscount.toString()}
            onChange={(e) =>
              onItemDiscountChange(
                e.target.value === "" ? new Decimal(0) : new Decimal(e.target.value)
              )
            }
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[11px] text-muted-foreground">{strings.pos.noteLabel}</Label>
          <Input
            inputSize="touch"
            className="text-sm"
            value={line.note}
            placeholder={strings.pos.notePlaceholder}
            onChange={(e) => onNoteChange(e.target.value)}
          />
        </div>
      </div>

      {result && !result.allocatedOrderDiscount.isZero() ? (
        <div className="text-[11px] text-muted-foreground">
          {strings.pos.lineDiscountAllocated}: -{formatIDR(result.allocatedOrderDiscount)}
        </div>
      ) : null}
    </div>
  );
}
