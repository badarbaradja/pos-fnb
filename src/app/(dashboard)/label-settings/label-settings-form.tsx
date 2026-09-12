"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { saveLabelSettings, type LabelSettingsFormState } from "./actions";
import type { LabelSettingsValue } from "@/lib/labels/manage";
import { LabelView, type LabelBarangData } from "@/components/barang/label-view";
import { Code128DebugPanel } from "@/components/barcode/code128-debug-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { id as strings } from "@/lib/i18n/id";

const PRESETS: { widthMm: number; heightMm: number; label: string }[] = [
  { widthMm: 33, heightMm: 15, label: "33 × 15 mm" },
  { widthMm: 50, heightMm: 25, label: "50 × 25 mm" },
  { widthMm: 50, heightMm: 30, label: "50 × 30 mm" },
  { widthMm: 50, heightMm: 80, label: "50 × 80 mm" },
];

const SAMPLE_BARANG: LabelBarangData = {
  kode: "BTHR-7F3K9",
  nama: "Kemeja Flanel Uniqlo",
  ukuran: "L",
  hargaJual: "85000",
  pemilikKode: "Titipan · Sari",
};

const initialState: LabelSettingsFormState = {};

export function LabelSettingsForm({ initialSettings }: { initialSettings: LabelSettingsValue }) {
  const [state, formAction, isPending] = useActionState(saveLabelSettings, initialState);
  const [widthMm, setWidthMm] = useState(initialSettings.widthMm);
  const [heightMm, setHeightMm] = useState(initialSettings.heightMm);
  const [showBarcode, setShowBarcode] = useState(initialSettings.showBarcode);
  const [showName, setShowName] = useState(initialSettings.showName);
  const [showPrice, setShowPrice] = useState(initialSettings.showPrice);
  const [showPemilikKode, setShowPemilikKode] = useState(initialSettings.showPemilikKode);
  const [showUkuran, setShowUkuran] = useState(initialSettings.showUkuran);

  useEffect(() => {
    if (state.error) {
      toast.error(state.error);
    } else if (state.success) {
      toast.success(strings.labelSettings.saveSuccess);
    }
  }, [state]);

  const previewSettings: LabelSettingsValue = {
    widthMm,
    heightMm,
    showBarcode,
    showName,
    showPrice,
    showPemilikKode,
    showUkuran,
  };

  return (
    <div className="flex flex-col gap-6 sm:flex-row">
      <form action={formAction} className="flex w-full max-w-sm flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label className="text-xs">{strings.labelSettings.presetsLabel}</Label>
          <div className="flex flex-wrap gap-1">
            {PRESETS.map((p) => (
              <Button
                key={p.label}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setWidthMm(String(p.widthMm));
                  setHeightMm(String(p.heightMm));
                }}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor="widthMm">{strings.labelSettings.widthLabel}</Label>
            <Input
              id="widthMm"
              name="widthMm"
              type="number"
              min="1"
              step="0.1"
              value={widthMm}
              onChange={(e) => setWidthMm(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor="heightMm">{strings.labelSettings.heightLabel}</Label>
            <Input
              id="heightMm"
              name="heightMm"
              type="number"
              min="1"
              step="0.1"
              value={heightMm}
              onChange={(e) => setHeightMm(e.target.value)}
              required
            />
          </div>
        </div>

        <div className="flex flex-col gap-2 rounded-lg border p-3">
          <Label className="text-xs">{strings.labelSettings.elementsLabel}</Label>
          <div className="flex items-center gap-2">
            <Checkbox
              id="showBarcode"
              name="showBarcode"
              checked={showBarcode}
              onCheckedChange={(c) => setShowBarcode(c === true)}
            />
            <Label htmlFor="showBarcode" className="text-sm font-normal">
              {strings.labelSettings.showBarcode}
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="showName"
              name="showName"
              checked={showName}
              onCheckedChange={(c) => setShowName(c === true)}
            />
            <Label htmlFor="showName" className="text-sm font-normal">
              {strings.labelSettings.showName}
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="showPrice"
              name="showPrice"
              checked={showPrice}
              onCheckedChange={(c) => setShowPrice(c === true)}
            />
            <Label htmlFor="showPrice" className="text-sm font-normal">
              {strings.labelSettings.showPrice}
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="showUkuran"
              name="showUkuran"
              checked={showUkuran}
              onCheckedChange={(c) => setShowUkuran(c === true)}
            />
            <Label htmlFor="showUkuran" className="text-sm font-normal">
              {strings.labelSettings.showUkuran}
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="showPemilikKode"
              name="showPemilikKode"
              checked={showPemilikKode}
              onCheckedChange={(c) => setShowPemilikKode(c === true)}
            />
            <Label htmlFor="showPemilikKode" className="text-sm font-normal">
              {strings.labelSettings.showPemilikKode}
            </Label>
          </div>
        </div>

        <Button type="submit" disabled={isPending}>
          {isPending ? strings.common.saving : strings.common.save}
        </Button>
      </form>

      <div className="flex flex-col items-center gap-2">
        <Label className="text-xs">{strings.labelSettings.previewLabel}</Label>
        <div className="rounded-lg border-2 border-dashed p-4">
          <LabelView settings={previewSettings} barang={SAMPLE_BARANG} />
        </div>
        <p className="max-w-40 text-center text-xs text-muted-foreground">
          {strings.labelSettings.previewHint}
        </p>
        <Code128DebugPanel kode={SAMPLE_BARANG.kode} />
      </div>
    </div>
  );
}

