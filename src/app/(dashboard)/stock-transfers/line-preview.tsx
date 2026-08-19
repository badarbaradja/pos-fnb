import { id as strings } from "@/lib/i18n/id";

/**
 * Preview dua baris "1 {unit} = {factor} {baseUnit}" / "{qty} {unit} ->
 * {result} {baseUnit}" -- dipakai di request/send/receive, pola dari T22
 * v1 dipertahankan (sudah terbukti lewat verifikasi browser).
 */
export function formatPreviewNumber(value: number): string {
  if (!Number.isFinite(value)) return "";
  return value.toFixed(8).replace(/\.?0+$/, "");
}

export function LinePreview({
  baseUnit,
  unit,
  factor,
  qty,
}: {
  baseUnit: string;
  unit: string;
  factor: number;
  qty: string;
}) {
  const qtyNum = Number(qty);
  const valid = Number.isFinite(qtyNum) && qtyNum > 0 && Number.isFinite(factor) && factor > 0;

  if (!valid) {
    return <p className="text-xs text-muted-foreground">{strings.ingredients.previewPlaceholder}</p>;
  }

  const line1 =
    factor === 1
      ? strings.stockTransfers.previewLine1Identity.replace(/\{unit\}/g, unit)
      : strings.stockTransfers.previewLine1Convert
          .replace("{unit}", unit)
          .replace("{factor}", formatPreviewNumber(factor))
          .replace("{baseUnit}", baseUnit);

  const line2 = strings.stockTransfers.previewLine2
    .replace("{qty}", qty)
    .replace("{unit}", unit)
    .replace("{result}", formatPreviewNumber(qtyNum * factor))
    .replace("{baseUnit}", baseUnit);

  return (
    <div className="rounded-lg border border-input bg-muted/40 px-3 py-2 text-sm">
      <p>{line1}</p>
      <p className="text-muted-foreground">{line2}</p>
    </div>
  );
}
