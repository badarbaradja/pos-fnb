"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { saveBarang, type BarangFormState } from "./actions";
import {
  BarangImageField,
  type BarangImageFieldHandle,
} from "@/components/dashboard/barang/barang-image-field";
import { QuickAddCategoryDialog } from "./quick-add-category-dialog";
import { QuickAddPemilikDialog } from "./quick-add-pemilik-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getUkuranPresets, KONDISI_PRESETS } from "@/lib/barang/ukuran-presets";
import { id as strings } from "@/lib/i18n/id";

type OutletOption = { id: string; name: string };
type CategoryOption = { id: string; name: string };
type PemilikOption = { id: string; nama: string };

// Nilai awal useActionState WAJIB didefinisikan di sini (klien), BUKAN
// diekspor dari actions.ts -- file "use server" cuma boleh mengekspor
// fungsi async, mengekspor objek biasa (walau lewat re-export) membuat
// SEMUA Server Action di file itu gagal dimuat saat form disubmit
// ("A 'use server' file can only export async functions, found object").
// Ini bug sungguhan yang ditemukan CEO 11 September 2026 -- pola yang
// benar sudah ada di pemilik-form-dialog.tsx, diikuti di sini.
const initialState: BarangFormState = {};

/**
 * Ukuran/kondisi/harga -- REMOUNT lewat `key={barangId terakhir tersimpan}`
 * di pemanggil, BUKAN direset lewat setState di dalam useEffect (react-hooks/
 * set-state-in-effect melarang itu -- "Avoid calling setState() directly
 * within an effect"). Key baru pada setiap sukses simpan otomatis memberi
 * instance baru komponen ini nilai awal useState yang bersih, tanpa efek
 * sama sekali.
 */
function BarangPricingFields({ categoryName }: { categoryName: string | null }) {
  const ukuranPresets = getUkuranPresets(categoryName);
  const [ukuran, setUkuran] = useState("");
  const [ukuranCustom, setUkuranCustom] = useState(false);
  const [kondisi, setKondisi] = useState("");
  const [kondisiCustom, setKondisiCustom] = useState(false);
  const [hargaModal, setHargaModal] = useState("0");
  const [hargaJual, setHargaJual] = useState("");
  const [hargaJualEdited, setHargaJualEdited] = useState(false);

  function handleHargaModalChange(value: string) {
    setHargaModal(value);
    if (!hargaJualEdited) {
      const modal = Number(value);
      setHargaJual(Number.isFinite(modal) && modal > 0 ? String(modal * 2) : "");
    }
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor="ukuran">{strings.barang.ukuran}</Label>
        <div className="flex flex-wrap gap-2">
          {ukuranPresets.map((u) => (
            <ChipButton
              key={u}
              selected={!ukuranCustom && ukuran === u}
              onClick={() => {
                setUkuranCustom(false);
                setUkuran(u);
              }}
            >
              {u}
            </ChipButton>
          ))}
          <ChipButton selected={ukuranCustom} onClick={() => setUkuranCustom(true)}>
            {strings.barang.otherOption}
          </ChipButton>
        </div>
        {ukuranCustom ? (
          <Input
            id="ukuran"
            name="ukuran"
            value={ukuran}
            onChange={(e) => setUkuran(e.target.value)}
            placeholder={strings.barang.ukuranPlaceholder}
            autoFocus
          />
        ) : (
          <input type="hidden" name="ukuran" value={ukuran} />
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="kondisi">{strings.barang.kondisi}</Label>
        <div className="flex flex-wrap gap-2">
          {KONDISI_PRESETS.map((k) => (
            <ChipButton
              key={k}
              selected={!kondisiCustom && kondisi === k}
              onClick={() => {
                setKondisiCustom(false);
                setKondisi(k);
              }}
            >
              {k}
            </ChipButton>
          ))}
          <ChipButton selected={kondisiCustom} onClick={() => setKondisiCustom(true)}>
            {strings.barang.otherOption}
          </ChipButton>
        </div>
        {kondisiCustom ? (
          <Input
            id="kondisi"
            name="kondisi"
            value={kondisi}
            onChange={(e) => setKondisi(e.target.value)}
            placeholder={strings.barang.kondisiPlaceholder}
            autoFocus
          />
        ) : (
          <input type="hidden" name="kondisi" value={kondisi} />
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="hargaModal">{strings.barang.hargaModal}</Label>
          <Input
            id="hargaModal"
            name="hargaModal"
            type="number"
            min={0}
            step="1"
            value={hargaModal}
            onChange={(e) => handleHargaModalChange(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="hargaJual">{strings.barang.hargaJual}</Label>
          <Input
            id="hargaJual"
            name="hargaJual"
            type="number"
            min={0}
            step="1"
            required
            value={hargaJual}
            onChange={(e) => {
              setHargaJual(e.target.value);
              setHargaJualEdited(true);
            }}
          />
          <p className="text-xs text-muted-foreground">{strings.barang.hargaJualAutoHint}</p>
        </div>
      </div>
    </>
  );
}

function ChipButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-9 min-w-11 rounded-lg border px-3 text-sm transition-colors",
        selected
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-transparent hover:bg-accent"
      )}
    >
      {children}
    </button>
  );
}

/**
 * app/(dashboard)/barang/barang-intake-form.tsx — TT04 (diupgrade 11
 * September 2026 sesuai instruksi CEO langsung, lihat §5 SPESIFIKASI:
 * kecepatan input adalah penentu dipakai/tidaknya sistem untuk sesi
 * 50-150 barang sekali datang). Form tambah barang SATU LAYAR permanen
 * (bukan dialog modal) supaya tidak terhambat buka-tutup dialog per
 * barang.
 *
 * Kategori, ukuran, kondisi, pemilik semua TOMBOL tap (ChipButton),
 * bukan menu jatuh -- satu ketukan, tidak perlu buka dropdown lalu
 * scroll cari opsi. Ukuran/kondisi TETAP kolom teks di database
 * (kondisi sengaja bukan enum, lihat schema.ts) -- tombol cuma mengisi
 * preset paling umum, admin masih bisa ketik manual untuk kasus di luar
 * preset (mis. ukuran sepatu angka).
 *
 * Field OUTLET, KATEGORI, PEMILIK sengaja CONTROLLED (React state) --
 * setelah satu barang tersimpan, `formRef.reset()` mengosongkan field lain
 * (nama, merek -- UNCONTROLLED, native defaultValue) tapi TIDAK menyentuh
 * field controlled ini sama sekali, jadi admin bisa langsung foto+isi
 * barang berikutnya dari pemilik yang sama tanpa memilih ulang (§7
 * SPESIFIKASI-THRIFTING.md: "penghematan waktu terbesar untuk sesi 150
 * barang").
 *
 * Harga jual OTOMATIS 2x harga modal (instruksi CEO) selama admin belum
 * mengubahnya sendiri sejak terakhir kali harga modal berubah -- begitu
 * diketik manual, auto-isi berhenti untuk barang itu (hargaJualEdited).
 */
export function BarangIntakeForm({
  outlets,
  categories: initialCategories,
  pemilikList: initialPemilikList,
}: {
  outlets: OutletOption[];
  categories: CategoryOption[];
  pemilikList: PemilikOption[];
}) {
  const [state, formAction, isPending] = useActionState(saveBarang, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const imageFieldRef = useRef<BarangImageFieldHandle>(null);
  const namaInputRef = useRef<HTMLInputElement>(null);

  const [outletId, setOutletId] = useState(outlets[0]?.id ?? "");
  // Kategori/pemilik BARU yang ditambah lewat "+ Kategori/Pemilik baru"
  // (instruksi CEO 11 September 2026) ditambahkan ke daftar LOKAL ini
  // langsung dari callback dialog (event handler, bukan efek) supaya
  // langsung terpilih dan tersedia untuk barang berikutnya TANPA reload
  // halaman -- sesi 150 barang tidak boleh terhenti untuk itu.
  const [categories, setCategories] = useState(initialCategories);
  const [pemilikList, setPemilikList] = useState(initialPemilikList);
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
      // (controlled, tidak tersentuh reset() native ini). Ukuran/kondisi/
      // harga direset lewat remount BarangPricingFields (key di bawah),
      // BUKAN setState di sini -- lihat komentar di komponen itu.
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
        </div>

        <div className="flex flex-col gap-2">
          <Label>{strings.barang.category}</Label>
          <input type="hidden" name="categoryId" value={categoryId} />
          <div className="flex flex-wrap gap-2">
            <ChipButton selected={categoryId === ""} onClick={() => setCategoryId("")}>
              {strings.barang.noCategoryOption}
            </ChipButton>
            {categories.map((c) => (
              <ChipButton
                key={c.id}
                selected={categoryId === c.id}
                onClick={() => setCategoryId(c.id)}
              >
                {c.name}
              </ChipButton>
            ))}
            <QuickAddCategoryDialog
              onCreated={(id, name) => {
                setCategories((prev) => [...prev, { id, name }]);
                setCategoryId(id);
              }}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label>{strings.barang.pemilik}</Label>
          <input type="hidden" name="pemilikId" value={pemilikId} />
          <div className="flex flex-wrap gap-2">
            <ChipButton selected={pemilikId === ""} onClick={() => setPemilikId("")}>
              {strings.barang.pemilikTokoSendiri}
            </ChipButton>
            {pemilikList.map((p) => (
              <ChipButton
                key={p.id}
                selected={pemilikId === p.id}
                onClick={() => setPemilikId(p.id)}
              >
                {p.nama}
              </ChipButton>
            ))}
            <QuickAddPemilikDialog
              onCreated={(id, nama) => {
                setPemilikList((prev) => [...prev, { id, nama }]);
                setPemilikId(id);
              }}
            />
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
            <Label htmlFor="warna">{strings.barang.warna}</Label>
            <Input id="warna" name="warna" />
          </div>
        </div>

        <BarangPricingFields
          key={state.success?.barangId ?? "belum-tersimpan"}
          categoryName={categories.find((c) => c.id === categoryId)?.name ?? null}
        />

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
