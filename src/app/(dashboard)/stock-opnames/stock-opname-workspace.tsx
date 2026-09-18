"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
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
  upsertOpnameItemsBulkAction,
  type ActiveDraft,
  type OpnameOutletOption,
} from "./actions";

// Auto-save berjalan AUTO_SAVE_DELAY_MS setelah keystroke TERAKHIR (bukan
// tiap keystroke) -- 225 baris tidak boleh memicu 225 request beruntun.
// "Simpan Semua" (tombol eksplisit) melewati jeda ini, langsung menyimpan
// semua baris yang berubah SEKARANG juga.
const AUTO_SAVE_DELAY_MS = 2500;

type DraftLine = {
  physicalQty: string; // "" = belum diisi lokal
  unitCost: string;
  saved: boolean;
};

function toDraftLine(item: OpnameItemRow): DraftLine {
  return {
    physicalQty: item.physicalQty ?? "",
    unitCost: item.unitCost,
    saved: item.physicalQty !== null,
  };
}

/** Selisih DIHITUNG LANGSUNG dari isian lokal (physicalQty) dikurangi
 * stok sistem -- BUKAN dibaca dari kolom `variance` di database, yang
 * SENGAJA null sebelum submit (dihitung server di titik submit). Sebelum
 * perbaikan ini, kolom Selisih di layar selalu menampilkan "-" untuk
 * SEMUA baris yang belum disubmit -- bug tampilan murni, ditemukan lewat
 * uji sungguhan 18 September 2026 (bukan bug hitungan: stock_movements
 * yang ditulis submitOpnameWithDb() sudah benar dari awal, dihitung fresh
 * dari physicalQty-systemQty di titik submit, tidak pernah bergantung
 * pada kolom tampilan ini). */
function computeVariance(physicalQtyText: string, systemQty: string): { text: string; className: string } | null {
  if (physicalQtyText.trim() === "") return null; // belum dihitung -- ditampilkan "-" oleh pemanggil
  const physical = Number(physicalQtyText);
  const system = Number(systemQty);
  if (Number.isNaN(physical) || Number.isNaN(system)) return null;
  const diff = Math.round((physical - system) * 10000) / 10000; // presisi sama kolom DB (4 desimal)
  if (diff === 0) return { text: "0", className: "text-muted-foreground" };
  const text = diff > 0 ? `+${diff}` : `${diff}`;
  return { text, className: diff > 0 ? "text-blue-600 dark:text-blue-400" : "text-red-600 dark:text-red-400" };
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
  const [isSavingAll, setIsSavingAll] = useState(false);

  // Ref, BUKAN state -- dibaca dari dalam timer/callback async yang tidak
  // boleh menutup atas nilai lama (stale closure). Disinkronkan lewat
  // useEffect (di LUAR render, bukan ditulis langsung di badan komponen --
  // react-hooks/refs melarang itu), berjalan tiap render selesai.
  const linesRef = useRef(lines);
  const dirtyRef = useRef<Set<string>>(new Set());
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const opnameIdRef = useRef<string | null>(null);
  const outletIdRef = useRef(outletId);
  // dirtyCount TETAP state (bukan ref) -- ref tidak boleh dibaca saat
  // render (react-hooks/refs), dan hint "menyimpan otomatis" memang perlu
  // ikut me-render ulang saat berubah.
  const [dirtyCount, setDirtyCount] = useState(0);

  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);
  useEffect(() => {
    opnameIdRef.current = opnameId;
  }, [opnameId]);
  useEffect(() => {
    outletIdRef.current = outletId;
  }, [outletId]);

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
    // Bersihkan timer auto-save kalau komponen dilepas di tengah jeda.
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sengaja cuma sekali saat mount
  }, []);

  function handleOutletChange(nextOutletId: string) {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    dirtyRef.current.clear();
    setDirtyCount(0);
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
    dirtyRef.current.clear();
    setDirtyCount(0);
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

  /**
   * Simpan semua baris DIRTY (berubah sejak simpan terakhir) yang sudah
   * diisi -- baris yang masih kosong DILEWATI, bukan dikirim sebagai nol
   * (aturan lama, tidak berubah). Dipakai auto-save (dipanggil timer) DAN
   * tombol "Simpan Semua" (dipanggil langsung, melewati jeda).
   *
   * Snapshot nilai SAAT panggilan dimulai -- kalau baris berubah LAGI
   * sebelum request ini selesai, baris itu TETAP ditandai belum tersimpan
   * (bukan ditimpa status "tersimpan" yang sudah basi); auto-save
   * berikutnya (sudah terjadwal ulang dari edit yang lebih baru) yang
   * akan mengirim versi terbarunya.
   */
  async function saveDirtyLines(): Promise<{ saved: number } | null> {
    const currentOpnameId = opnameIdRef.current;
    if (!currentOpnameId) return null;

    const idsToSave = Array.from(dirtyRef.current).filter((id) => {
      const l = linesRef.current[id];
      return l && l.physicalQty.trim() !== "";
    });
    if (idsToSave.length === 0) {
      dirtyRef.current.clear();
      setDirtyCount(0);
      return { saved: 0 };
    }

    const snapshot = new Map(idsToSave.map((id) => [id, { ...linesRef.current[id]! }]));
    const payload = idsToSave.map((id) => ({
      ingredientId: id,
      physicalQty: snapshot.get(id)!.physicalQty,
      unitCost: snapshot.get(id)!.unitCost || "0",
    }));

    const result = await upsertOpnameItemsBulkAction(currentOpnameId, outletIdRef.current, payload);
    if (result.error) {
      toast.error(result.error);
      return null;
    }

    // Baris yang TIDAK berubah lagi sejak snapshot diambil -- inilah yang
    // sungguh boleh ditandai tersimpan. Dihitung DI LUAR updater setLines
    // (updater harus murni, tidak boleh punya efek samping seperti mengubah
    // ref) -- lihat komentar saveDirtyLines di atas soal race ini.
    const confirmedIds = idsToSave.filter((id) => {
      const current = linesRef.current[id];
      const snap = snapshot.get(id)!;
      return current && current.physicalQty === snap.physicalQty && current.unitCost === snap.unitCost;
    });

    setLines((prev) => {
      const next = { ...prev };
      for (const id of confirmedIds) {
        if (next[id]) next[id] = { ...next[id], saved: true };
      }
      return next;
    });
    for (const id of confirmedIds) dirtyRef.current.delete(id);
    setDirtyCount(dirtyRef.current.size);

    return { saved: idsToSave.length };
  }

  function scheduleAutoSave() {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void saveDirtyLines();
    }, AUTO_SAVE_DELAY_MS);
  }

  function updateLine(ingredientId: string, patch: Partial<DraftLine>) {
    setLines((prev) => ({
      ...prev,
      [ingredientId]: { ...prev[ingredientId]!, ...patch, saved: false },
    }));
    dirtyRef.current.add(ingredientId);
    setDirtyCount(dirtyRef.current.size);
    scheduleAutoSave();
  }

  async function handleSaveAll() {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    setIsSavingAll(true);
    const result = await saveDirtyLines();
    setIsSavingAll(false);
    if (!result) return;
    if (result.saved > 0) {
      toast.success(strings.stockOpnames.saveAllSuccess.replace("{count}", String(result.saved)));
    } else {
      toast.info(strings.stockOpnames.saveAllNothing);
    }
  }

  function handleSubmit() {
    if (!opnameId) return;
    startTransition(async () => {
      // Pastikan semua yang masih tertunda tersimpan dulu SEBELUM submit --
      // kalau tidak, baris yang baru diketik tapi belum sempat auto-save
      // akan terlewat dianggap "belum dihitung" oleh submitOpnameWithDb().
      const pending = await saveDirtyLines();
      if (pending === null) {
        toast.error(strings.common.unexpectedError);
        return;
      }
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {strings.stockOpnames.itemsCountedOf
                .replace("{counted}", String(countedCount))
                .replace("{total}", String(items.length))}
              {!submitted && dirtyCount > 0 ? ` · ${strings.stockOpnames.autoSavingHint}` : ""}
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
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const line = lines[item.ingredientId];
                if (!line) return null;
                const variance = computeVariance(line.physicalQty, item.systemQty);
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
                    <TableCell className={`text-sm font-medium ${variance?.className ?? "text-muted-foreground"}`}>
                      {variance?.text ?? "-"}
                    </TableCell>
                    <TableCell>
                      {submitted ? null : line.saved ? (
                        <Badge variant="default">{strings.stockOpnames.savedBadge}</Badge>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {!submitted && (
            <div className="sticky bottom-0 flex justify-end border-t bg-background py-3">
              <Button type="button" onClick={handleSaveAll} disabled={isSavingAll}>
                {isSavingAll ? strings.stockOpnames.savingAllLabel : strings.stockOpnames.saveAllButton}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
