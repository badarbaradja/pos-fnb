"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { id as strings } from "@/lib/i18n/id";
import type { OpnameItemRow } from "@/lib/stock-opnames/manage";
import {
  createOpnameAction,
  getActiveDraftsAction,
  getOpnameItemsAction,
  submitOpnameAction,
  upsertOpnameItemAction,
  type ActiveDraft,
  type OpnameOutletOption,
} from "./actions";

type DraftLine = {
  physicalQty: string; // "" = belum diisi lokal
  unitCost: string;
  varianceReason: string;
  saved: boolean;
};

function toDraftLine(item: OpnameItemRow): DraftLine {
  return {
    physicalQty: item.physicalQty ?? "",
    unitCost: item.unitCost,
    varianceReason: item.varianceReason ?? "",
    saved: item.physicalQty !== null,
  };
}

export function StockOpnameWorkspace({ outletOptions }: { outletOptions: OpnameOutletOption[] }) {
  const [outletId, setOutletId] = useState<string>(outletOptions[0]?.id ?? "");
  const [drafts, setDrafts] = useState<ActiveDraft[]>([]);
  const [opnameId, setOpnameId] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [items, setItems] = useState<OpnameItemRow[] | null>(null);
  const [lines, setLines] = useState<Record<string, DraftLine>>({});
  const [submitted, setSubmitted] = useState(false);
  const [submitDialogOpen, setSubmitDialogOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const outletItems = useMemo(() => {
    const map: Record<string, string> = {};
    for (const o of outletOptions) map[o.id] = `${o.name} (${o.code})`;
    return map;
  }, [outletOptions]);

  // Muat draft untuk outlet default SEKALI saat mount -- reset state saat
  // GANTI outlet ditangani di handleOutletChange (event, bukan efek
  // turunan), supaya tidak ada setState sinkron di dalam body efek
  // (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!outletId) return;
    getActiveDraftsAction(outletId).then((result) => {
      if (Array.isArray(result)) setDrafts(result);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sengaja cuma sekali saat mount
  }, []);

  function handleOutletChange(nextOutletId: string) {
    setOutletId(nextOutletId);
    setOpnameId(null);
    setItems(null);
    setSubmitted(false);
    getActiveDraftsAction(nextOutletId).then((result) => {
      if (Array.isArray(result)) setDrafts(result);
    });
  }

  async function loadItems(id: string) {
    const result = await getOpnameItemsAction(id, outletId);
    if (result.error || !result.items) {
      toast.error(result.error ?? strings.common.unexpectedError);
      return;
    }
    setItems(result.items);
    const nextLines: Record<string, DraftLine> = {};
    for (const item of result.items) {
      nextLines[item.ingredientId] = toDraftLine(item);
    }
    setLines(nextLines);
  }

  function handleCreateSession() {
    startTransition(async () => {
      const result = await createOpnameAction(outletId, label.trim() || undefined);
      if (result.error || !result.opnameId) {
        toast.error(result.error ?? strings.common.unexpectedError);
        return;
      }
      setOpnameId(result.opnameId);
      setSubmitted(false);
      await loadItems(result.opnameId);
    });
  }

  function handleResume(id: string) {
    startTransition(async () => {
      setOpnameId(id);
      setSubmitted(false);
      await loadItems(id);
    });
  }

  function updateLine(ingredientId: string, patch: Partial<DraftLine>) {
    setLines((prev) => ({
      ...prev,
      [ingredientId]: { ...prev[ingredientId]!, ...patch, saved: false },
    }));
  }

  function handleSaveLine(ingredientId: string) {
    if (!opnameId) return;
    const line = lines[ingredientId];
    if (!line || line.physicalQty.trim() === "") return;
    startTransition(async () => {
      const result = await upsertOpnameItemAction(opnameId, outletId, {
        ingredientId,
        physicalQty: line.physicalQty,
        unitCost: line.unitCost || "0",
        varianceReason: line.varianceReason.trim() || undefined,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setLines((prev) => ({ ...prev, [ingredientId]: { ...prev[ingredientId]!, saved: true } }));
    });
  }

  function handleSubmit() {
    if (!opnameId) return;
    startTransition(async () => {
      const result = await submitOpnameAction(opnameId, outletId);
      setSubmitDialogOpen(false);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      if (result.data) {
        toast.success(
          strings.stockOpnames.submitSuccess
            .replace("{count}", String(result.data.movementsCreated))
            .replace("{skipped}", String(result.data.itemsSkipped))
        );
      }
      setSubmitted(true);
      await loadItems(opnameId);
    });
  }

  const countedCount = Object.values(lines).filter((l) => l.saved).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:max-w-xs">
        <Label>{strings.stockOpnames.selectOutlet}</Label>
        <Select value={outletId} onValueChange={(v) => handleOutletChange(v as string)} items={outletItems}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {outletOptions.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.name} ({o.code})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!opnameId ? (
        <div className="flex flex-col gap-3">
          {drafts.length > 0 ? (
            <div className="rounded-md border p-3">
              <p className="text-sm font-medium">{strings.stockOpnames.resumeDraftTitle}</p>
              <p className="text-xs text-muted-foreground">{strings.stockOpnames.resumeDraftHint}</p>
              <div className="mt-2 flex flex-col gap-1">
                {drafts.map((d) => (
                  <div key={d.id} className="flex items-center justify-between text-sm">
                    <span>{d.label || d.businessDate}</span>
                    <Button size="sm" variant="outline" onClick={() => handleResume(d.id)}>
                      {strings.stockOpnames.resumeButton}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-2 sm:max-w-md sm:flex-row">
            <Input
              placeholder={strings.stockOpnames.labelPlaceholder}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <Button type="button" disabled={isPending || !outletId} onClick={handleCreateSession}>
              {strings.stockOpnames.newSessionButton}
            </Button>
          </div>
        </div>
      ) : items === null ? (
        <p className="text-sm text-muted-foreground">{strings.common.loading}</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {strings.stockOpnames.itemsCountedOf
                .replace("{counted}", String(countedCount))
                .replace("{total}", String(items.length))}
            </p>
            {submitted ? (
              <Badge variant="secondary">{strings.stockOpnames.submittedBadge}</Badge>
            ) : (
              <Dialog open={submitDialogOpen} onOpenChange={setSubmitDialogOpen}>
                <DialogTrigger render={<Button type="button">{strings.stockOpnames.submitButton}</Button>} />
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{strings.stockOpnames.submitConfirmTitle}</DialogTitle>
                  </DialogHeader>
                  <p className="text-sm text-muted-foreground">
                    {strings.stockOpnames.submitConfirmHint}
                  </p>
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setSubmitDialogOpen(false)}>
                      {strings.common.cancel}
                    </Button>
                    <Button type="button" disabled={isPending} onClick={handleSubmit}>
                      {isPending ? strings.common.saving : strings.stockOpnames.submitButton}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{strings.stockOpnames.colIngredient}</TableHead>
                <TableHead>{strings.stockOpnames.colSystemQty}</TableHead>
                <TableHead>{strings.stockOpnames.colPhysicalQty}</TableHead>
                <TableHead>{strings.stockOpnames.colUnitCost}</TableHead>
                <TableHead>{strings.stockOpnames.colVariance}</TableHead>
                <TableHead>{strings.stockOpnames.colReason}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const line = lines[item.ingredientId];
                if (!line) return null;
                return (
                  <TableRow key={item.ingredientId}>
                    <TableCell>{item.ingredientName}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {item.systemQty} {item.baseUnit}
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.0001"
                        min="0"
                        placeholder={strings.stockOpnames.notCountedYet}
                        value={line.physicalQty}
                        disabled={submitted}
                        onChange={(e) =>
                          updateLine(item.ingredientId, { physicalQty: e.target.value })
                        }
                        className="w-28"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={line.unitCost}
                        disabled={submitted}
                        onChange={(e) => updateLine(item.ingredientId, { unitCost: e.target.value })}
                        className="w-28"
                      />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {item.variance ?? "-"}
                    </TableCell>
                    <TableCell>
                      <Input
                        placeholder={strings.stockOpnames.reasonPlaceholder}
                        value={line.varianceReason}
                        disabled={submitted}
                        onChange={(e) =>
                          updateLine(item.ingredientId, { varianceReason: e.target.value })
                        }
                        className="w-48"
                      />
                    </TableCell>
                    <TableCell>
                      {submitted ? null : line.saved ? (
                        <Badge variant="default">{strings.stockOpnames.savedBadge}</Badge>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={isPending || line.physicalQty.trim() === ""}
                          onClick={() => handleSaveLine(item.ingredientId)}
                        >
                          {strings.stockOpnames.saveItemButton}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
