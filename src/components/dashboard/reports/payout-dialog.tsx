"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Decimal } from "decimal.js";
import { toast } from "sonner";
import { fetchPayoutHistory, recordPemilikPayout, type PemilikPayoutHistoryRow } from "@/app/(dashboard)/reports/bagi-hasil/actions";
import { calculateSisaDibayar } from "@/lib/calc/bagi-hasil-payout";
import { formatIDR } from "@/lib/utils/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { id as strings } from "@/lib/i18n/id";

/**
 * components/dashboard/reports/payout-dialog.tsx — TT11, "Tandai sudah
 * dibayar". Terkunci (tombol disabled) selama outlet.dayCutoffConfirmed
 * false -- pertahanan lapis UI, server (recordPemilikPayoutWithDb) TETAP
 * menolak juga kalau ada yang memaksa lewat jalur lain (CLAUDE.md §3.4).
 *
 * Terkunci JUGA (13 September 2026, temuan CEO) kalau sisa dibayar PERSIS
 * nol -- mencatat pembayaran nol tidak berarti apa-apa, cuma mengotori
 * tabel pemilik_payouts. SENGAJA CUMA nol persis (isZero()), BUKAN "nol
 * atau kurang" -- sisa NEGATIF (kelebihan bayar) harus TETAP bisa dicatat
 * (calculateSisaDibayar sengaja tidak meng-clamp negatif ke nol, lihat
 * __tests__/bagi-hasil-payout.test.ts), supaya jalur koreksi kelebihan
 * bayar tidak pernah tertutup.
 */
export function PayoutDialog({
  outletId,
  pemilikId,
  pemilikNama,
  startDate,
  endDate,
  cutoffConfirmed,
  bagianPemilik,
  sudahDibayar,
}: {
  outletId: string;
  pemilikId: string;
  pemilikNama: string;
  startDate: string;
  endDate: string;
  cutoffConfirmed: boolean;
  bagianPemilik: string;
  sudahDibayar: string;
}) {
  const sisa = calculateSisaDibayar(new Decimal(bagianPemilik), new Decimal(sudahDibayar));
  const isZeroSisa = sisa.isZero();
  const isTriggerDisabled = !cutoffConfirmed || isZeroSisa;
  const triggerDisabledReason = !cutoffConfirmed
    ? strings.bagiHasil.cutoffBelumDikonfirmasiError
    : isZeroSisa
      ? strings.bagiHasil.payoutBlockedZeroSisaHint
      : undefined;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [history, setHistory] = useState<PemilikPayoutHistoryRow[]>([]);
  const [jumlah, setJumlah] = useState("");
  const [tanggalBayar, setTanggalBayar] = useState(() => new Date().toISOString().slice(0, 10));
  const [catatan, setCatatan] = useState("");
  const [isPending, setIsPending] = useState(false);

  async function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setJumlah("");
      setCatatan("");
      return;
    }
    setIsLoadingHistory(true);
    try {
      const result = await fetchPayoutHistory({ outletId, pemilikId, startDate, endDate });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setHistory(result.success ?? []);
    } catch (err) {
      console.error("Ambil riwayat pembayaran gagal:", err);
      toast.error(err instanceof Error ? err.message : strings.common.unexpectedError);
    } finally {
      setIsLoadingHistory(false);
    }
  }

  async function handleSubmit() {
    setIsPending(true);
    try {
      const result = await recordPemilikPayout({
        outletId,
        pemilikId,
        startDate,
        endDate,
        jumlah,
        tanggalBayar,
        catatan,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(strings.bagiHasil.payoutSuccess);
      setOpen(false);
      setJumlah("");
      setCatatan("");
      router.refresh();
    } catch (err) {
      console.error("Catat pembayaran bagi hasil gagal:", err);
      toast.error(err instanceof Error ? err.message : strings.common.unexpectedError);
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            disabled={isTriggerDisabled}
            title={triggerDisabledReason}
          >
            {strings.bagiHasil.tandaiSudahDibayarButton}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {strings.bagiHasil.payoutDialogTitle.replace("{pemilik}", pemilikNama)}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">{strings.bagiHasil.riwayatPembayaranTitle}</Label>
            {isLoadingHistory ? (
              <p className="text-sm text-muted-foreground">{strings.common.loading}</p>
            ) : history.length === 0 ? (
              <p className="text-sm text-muted-foreground">{strings.bagiHasil.riwayatPembayaranEmpty}</p>
            ) : (
              <div className="flex flex-col gap-1 rounded-lg border p-2 text-sm">
                {history.map((h) => (
                  <div key={h.id} className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      {h.tanggalBayar}
                      {h.catatan ? ` · ${h.catatan}` : ""}
                    </span>
                    <span className="font-medium">{formatIDR(new Decimal(h.jumlah))}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="payoutJumlah">{strings.bagiHasil.payoutJumlahLabel}</Label>
            <Input
              id="payoutJumlah"
              type="number"
              min={0}
              step="0.01"
              value={jumlah}
              onChange={(e) => setJumlah(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="payoutTanggal">{strings.bagiHasil.payoutTanggalLabel}</Label>
            <Input
              id="payoutTanggal"
              type="date"
              value={tanggalBayar}
              onChange={(e) => setTanggalBayar(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="payoutCatatan">{strings.bagiHasil.payoutCatatanLabel}</Label>
            <Textarea
              id="payoutCatatan"
              value={catatan}
              onChange={(e) => setCatatan(e.target.value)}
              placeholder={strings.bagiHasil.payoutCatatanPlaceholder}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            {strings.common.cancel}
          </Button>
          <Button onClick={handleSubmit} disabled={isPending || !jumlah || Number(jumlah) <= 0}>
            {isPending ? strings.common.saving : strings.bagiHasil.payoutSubmitButton}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
