"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Decimal } from "decimal.js";
import { toast } from "sonner";
import { useThriftCartStore } from "@/lib/store/thrift-cart-store";
import { lookupBarangByKode } from "@/app/(pos)/pos/thrift/actions";
import { calculateOrder, type CalcLine } from "@/lib/calc/order-calculator";
import type { ThriftOutlet, ThriftPaymentMethod } from "@/app/(pos)/pos/thrift/get-thrift-catalog";
import { formatIDR } from "@/lib/utils/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ThriftPaymentDialog } from "./thrift-payment-dialog";
import { ThriftAddBarangDialog } from "./thrift-add-barang-dialog";
import { id as strings } from "@/lib/i18n/id";

type CategoryOption = { id: string; name: string };
type PemilikOption = { id: string; nama: string };

/**
 * components/pos/thrift/thrift-pos-screen.tsx — TT06. SATU LAYAR, bukan dua
 * kolom grid+keranjang seperti F&B (pos-screen.tsx) -- thrifting tidak
 * punya katalog untuk di-grid, alurnya barcode-first: pindai/ketik kode →
 * langsung masuk keranjang → bayar. Kesederhanaan layar INI SENDIRI adalah
 * fitur kecepatan (§5 SPESIFIKASI-THRIFTING.md), bukan cuma kebetulan
 * belum sempat dipercantik.
 */
export function ThriftPosScreen({
  outlet,
  device,
  paymentMethods,
  shift,
  canAddBarang,
  categories,
  pemilikList,
}: {
  outlet: ThriftOutlet;
  device: { id: string; name: string };
  paymentMethods: ThriftPaymentMethod[];
  shift: { id: string; employeeName: string };
  canAddBarang: boolean;
  categories: CategoryOption[];
  pemilikList: PemilikOption[];
}) {
  const lines = useThriftCartStore((s) => s.lines);
  const addLine = useThriftCartStore((s) => s.addLine);
  const removeLine = useThriftCartStore((s) => s.removeLine);
  const [kode, setKode] = useState("");
  const [isLooking, setIsLooking] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const calcResult = useMemo(() => {
    const calcLines: CalcLine[] = lines.map((l) => ({
      id: l.barangId,
      qty: new Decimal(1),
      unitPrice: l.hargaJual,
      modifierTotal: new Decimal(0),
      itemDiscount: new Decimal(0),
      isTaxable: true,
    }));
    return calculateOrder(calcLines, {
      discountType: "none",
      orderDiscountPercent: new Decimal(0),
      orderDiscountAmount: new Decimal(0),
      maxDiscount: null,
      serviceChargePercent: new Decimal(outlet.serviceChargePercent).dividedBy(100),
      taxPercent: new Decimal(outlet.taxPercent).dividedBy(100),
      taxInclusive: outlet.taxInclusive,
      serviceChargeInTaxBase: outlet.serviceChargeInTaxBase,
      roundingTo: outlet.roundingTo,
      roundingMode: "nearest",
    });
  }, [lines, outlet]);

  async function performLookup(kodeToLookup: string) {
    if (!kodeToLookup.trim() || isLooking) return;
    setIsLooking(true);
    try {
      const result = await lookupBarangByKode(kodeToLookup);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      if (result.success) {
        const { added } = addLine({
          barangId: result.success.id,
          kode: result.success.kode,
          nama: result.success.nama,
          ukuran: result.success.ukuran,
          warna: result.success.warna,
          hargaJual: new Decimal(result.success.hargaJual),
          pemilikId: result.success.pemilikId,
          pemilikNama: result.success.pemilikNama,
        });
        if (!added) {
          toast.error(strings.pos.barangDuplikatDiKeranjangError);
        }
      }
    } finally {
      setIsLooking(false);
      setKode("");
      inputRef.current?.focus();
    }
  }

  function handleScan(e: React.FormEvent) {
    e.preventDefault();
    void performLookup(kode);
  }

  // "Ita super kasir" -- barang baru dari ThriftAddBarangDialog SELALU
  // siap_jual (lib/pos/pos-add-barang.ts), jadi bisa langsung "dipindai"
  // pakai kode yang baru saja dibuat -- Ita tidak perlu mengetik ulang
  // atau keluar dari kasir sama sekali untuk menjualnya.
  function handleBarangAdded(kodeBaru: string) {
    void performLookup(kodeBaru);
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
        <span className="text-sm font-medium text-muted-foreground">
          {strings.pos.outletDeviceLabel.replace("{outlet}", outlet.name).replace("{device}", device.name)}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {strings.shift.activeShiftLabel}: {shift.employeeName}
          </span>
          {canAddBarang ? (
            <>
              <ThriftAddBarangDialog
                outletId={outlet.id}
                shiftId={shift.id}
                categories={categories}
                pemilikList={pemilikList}
                onAdded={handleBarangAdded}
              />
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link href="/pos/thrift/statistik">{strings.statistikIta.buttonLabel}</Link>}
              />
            </>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href="/pos/shift/close">{strings.shift.closeShiftButton}</Link>}
          />
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 p-4">
        <form onSubmit={handleScan} className="flex gap-2">
          <Input
            ref={inputRef}
            value={kode}
            onChange={(e) => setKode(e.target.value)}
            placeholder={strings.pos.scanPlaceholder}
            autoFocus
            autoComplete="off"
            className="h-12 text-base"
          />
          <Button type="submit" disabled={isLooking} className="h-12">
            {isLooking ? strings.common.loading : strings.pos.scanButton}
          </Button>
        </form>

        <div className="flex flex-1 flex-col gap-2 overflow-auto">
          {lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">{strings.pos.thriftCartEmpty}</p>
          ) : (
            lines.map((line) => (
              <div
                key={line.barangId}
                className="flex items-center justify-between gap-2 rounded-lg border p-3"
              >
                <div className="flex flex-col">
                  <span className="text-sm font-medium">
                    {line.nama}
                    {line.ukuran ? ` · ${line.ukuran}` : ""}
                    {line.warna ? ` · ${line.warna}` : ""}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">{line.kode}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium">{formatIDR(line.hargaJual)}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeLine(line.barangId)}
                  >
                    {strings.pos.removeFromCart}
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="flex flex-col gap-2 border-t pt-3">
          <div className="flex items-center justify-between text-base font-semibold">
            <span>{strings.pos.totalDue}</span>
            <span>{formatIDR(calcResult.total)}</span>
          </div>
          <Button
            size="lg"
            disabled={lines.length === 0}
            onClick={() => setPaymentOpen(true)}
          >
            {strings.pos.payButton}
          </Button>
        </div>
      </div>

      <ThriftPaymentDialog
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        calcResult={calcResult}
        paymentMethods={paymentMethods}
        outletId={outlet.id}
        deviceId={device.id}
      />
    </div>
  );
}
