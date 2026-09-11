"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { saveBarang, barangFormInitialState } from "./actions";
import {
  BarangImageField,
  type BarangImageFieldHandle,
} from "@/components/dashboard/barang/barang-image-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { id as strings } from "@/lib/i18n/id";

type OutletOption = { id: string; name: string };
type CategoryOption = { id: string; name: string };
type PemilikOption = { id: string; nama: string };

/**
 * app/(dashboard)/barang/barang-intake-form.tsx — TT04. Form tambah barang
 * SATU LAYAR permanen (bukan dialog modal) supaya sesi 150 barang tidak
 * terhambat buka-tutup dialog per barang (jawaban CEO §5
 * SPESIFIKASI-THRIFTING.md: kecepatan input adalah penentu dipakai/
 * tidaknya sistem).
 *
 * Field OUTLET, KATEGORI, PEMILIK sengaja CONTROLLED (React state) --
 * setelah satu barang tersimpan, `formRef.reset()` mengosongkan field lain
 * (nama, merek, ukuran, dst -- UNCONTROLLED, native defaultValue) tapi
 * TIDAK menyentuh ketiga field controlled ini sama sekali, jadi admin bisa
 * langsung foto+isi barang berikutnya dari pemilik yang sama tanpa
 * memilih ulang (§7 SPESIFIKASI-THRIFTING.md: "penghematan waktu terbesar
 * untuk sesi 150 barang").
 */
export function BarangIntakeForm({
  outlets,
  categories,
  pemilikList,
}: {
  outlets: OutletOption[];
  categories: CategoryOption[];
  pemilikList: PemilikOption[];
}) {
  const [state, formAction, isPending] = useActionState(saveBarang, barangFormInitialState);
  const formRef = useRef<HTMLFormElement>(null);
  const imageFieldRef = useRef<BarangImageFieldHandle>(null);
  const namaInputRef = useRef<HTMLInputElement>(null);

  const [outletId, setOutletId] = useState(outlets[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState("");
  const [pemilikId, setPemilikId] = useState("");
  // Kode terakhir tersimpan ditampilkan langsung dari `state.success.kode`
  // (useActionState sudah menyimpannya di antar render) -- TIDAK disalin ke
  // state lokal terpisah, supaya tidak ada setState di dalam efek di bawah.
  const lastSavedKode = state.success?.kode ?? null;

  useEffect(() => {
    if (state.error) {
      toast.error(state.error);
    }
    if (state.success) {
      toast.success(strings.barang.intakeSavedToast.replace("{kode}", state.success.kode));
      // Kosongkan field per-barang, PERTAHANKAN outlet/kategori/pemilik
      // (controlled, tidak tersentuh reset() native ini).
      formRef.current?.reset();
      imageFieldRef.current?.reset();
      namaInputRef.current?.focus();
    }
  }, [state]);

  if (outlets.length === 0) {
    return <p className="text-sm text-muted-foreground">{strings.barang.noOutletHint}</p>;
  }

  return (
    <Card className="p-4">
      <form ref={formRef} action={formAction} className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold">{strings.barang.intakeTitle}</h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="outletId">{strings.barang.outlet}</Label>
            <select
              id="outletId"
              name="outletId"
              value={outletId}
              onChange={(e) => setOutletId(e.target.value)}
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
            >
              {outlets.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="categoryId">{strings.barang.category}</Label>
            <select
              id="categoryId"
              name="categoryId"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
            >
              <option value="">{strings.barang.noCategoryOption}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="pemilikId">{strings.barang.pemilik}</Label>
            <select
              id="pemilikId"
              name="pemilikId"
              value={pemilikId}
              onChange={(e) => setPemilikId(e.target.value)}
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
            >
              <option value="">{strings.barang.pemilikTokoSendiri}</option>
              {pemilikList.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nama}
                </option>
              ))}
            </select>
          </div>
        </div>

        <BarangImageField ref={imageFieldRef} barangName="" />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="nama">{strings.barang.nama}</Label>
            <Input id="nama" name="nama" ref={namaInputRef} required autoFocus />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="merek">{strings.barang.merek}</Label>
            <Input id="merek" name="merek" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ukuran">{strings.barang.ukuran}</Label>
            <Input id="ukuran" name="ukuran" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="warna">{strings.barang.warna}</Label>
            <Input id="warna" name="warna" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="kondisi">{strings.barang.kondisi}</Label>
            <Input id="kondisi" name="kondisi" placeholder={strings.barang.kondisiPlaceholder} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="hargaModal">{strings.barang.hargaModal}</Label>
            <Input id="hargaModal" name="hargaModal" type="number" min={0} step="1" defaultValue="0" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="hargaJual">{strings.barang.hargaJual}</Label>
            <Input id="hargaJual" name="hargaJual" type="number" min={0} step="1" required />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={isPending}>
            {isPending ? strings.common.saving : strings.barang.intakeSaveButton}
          </Button>
          {lastSavedKode ? (
            <span className="text-sm text-muted-foreground">
              {strings.barang.lastSavedKodeLabel}{" "}
              <span className="font-mono font-medium text-foreground">{lastSavedKode}</span>
            </span>
          ) : null}
        </div>
      </form>
    </Card>
  );
}
