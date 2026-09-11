"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { addBarangFromPos } from "@/app/(pos)/pos/thrift/actions";
import {
  BarangImageField,
  type BarangImageFieldHandle,
} from "@/components/dashboard/barang/barang-image-field";
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
import { cn } from "@/lib/utils";
import { getUkuranPresets, KONDISI_PRESETS } from "@/lib/barang/ukuran-presets";
import { id as strings } from "@/lib/i18n/id";

type CategoryOption = { id: string; name: string };
type PemilikOption = { id: string; nama: string };

function Chip({
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
 * thrift-add-barang-dialog.tsx — "Ita super kasir" (11 September 2026).
 * Versi RINGKAS layar /barang, dipanggil LANGSUNG dari /pos/thrift --
 * dirender HANYA kalau ThriftPosScreen tahu shift ini manager/owner
 * (lihat page.tsx). Sesudah tersimpan, kode barang baru diteruskan ke
 * `onAdded` supaya kasir bisa langsung memindainya (barang baru selalu
 * siap_jual, lihat lib/pos/pos-add-barang.ts) -- tanpa keluar dari kasir
 * sama sekali.
 */
export function ThriftAddBarangDialog({
  outletId,
  shiftId,
  categories,
  pemilikList,
  onAdded,
}: {
  outletId: string;
  shiftId: string;
  categories: CategoryOption[];
  pemilikList: PemilikOption[];
  onAdded: (kode: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [categoryId, setCategoryId] = useState("");
  const [pemilikId, setPemilikId] = useState("");
  const [ukuran, setUkuran] = useState("");
  const [ukuranCustom, setUkuranCustom] = useState(false);
  const [kondisi, setKondisi] = useState("");
  const [kondisiCustom, setKondisiCustom] = useState(false);
  const [hargaModal, setHargaModal] = useState("0");
  const [hargaJual, setHargaJual] = useState("");
  const [hargaJualEdited, setHargaJualEdited] = useState(false);
  const imageFieldRef = useRef<BarangImageFieldHandle>(null);

  const ukuranPresets = getUkuranPresets(categories.find((c) => c.id === categoryId)?.name ?? null);

  function resetFields() {
    setCategoryId("");
    setPemilikId("");
    setUkuran("");
    setUkuranCustom(false);
    setKondisi("");
    setKondisiCustom(false);
    setHargaModal("0");
    setHargaJual("");
    setHargaJualEdited(false);
  }

  function handleHargaModalChange(value: string) {
    setHargaModal(value);
    if (!hargaJualEdited) {
      const modal = Number(value);
      setHargaJual(Number.isFinite(modal) && modal > 0 ? String(modal * 2) : "");
    }
  }

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      // Dibungkus try/catch (11 September 2026, instruksi CEO) -- CEO
      // sempat melihat "Terjadi kesalahan, coba lagi" dari dialog ini
      // tanpa pesan sungguhan yang bisa ditelusuri. Kalau addBarangFromPos
      // MELEMPAR exception (bukan mengembalikan {error}) -- mis. sesi
      // Supabase device kedaluwarsa di tengah pemakaian, atau galat
      // jaringan -- sebelumnya exception itu lolos begitu saja dari
      // startTransition tanpa toast APA PUN (silent failure). Sekarang
      // pesan exception sungguhan yang ditampilkan, bukan cuma fallback
      // generik, supaya lain kali penyebabnya langsung kelihatan di toast
      // tanpa perlu buka console browser.
      try {
        const result = await addBarangFromPos(shiftId, {
          outletId,
          categoryId: categoryId || undefined,
          nama: formData.get("nama"),
          merek: formData.get("merek") || undefined,
          ukuran: ukuran || undefined,
          warna: formData.get("warna") || undefined,
          kondisi: kondisi || undefined,
          hargaModal: hargaModal || 0,
          hargaJual: hargaJual,
          pemilikId: pemilikId || undefined,
        });
        if (result.error || !result.success) {
          toast.error(result.error ?? strings.common.unexpectedError);
          return;
        }
        const barangId = result.success.barangId;
        toast.success(strings.barang.intakeSavedToast.replace("{kode}", result.success.kode), {
          action: {
            label: strings.barang.printLabelButton,
            onClick: () => window.open(`/pos/thrift/label/${barangId}`, "_blank"),
          },
        });
        setOpen(false);
        resetFields();
        imageFieldRef.current?.reset();
        onAdded(result.success.kode);
      } catch (err) {
        console.error("addBarangFromPos gagal:", err);
        toast.error(err instanceof Error ? err.message : strings.common.unexpectedError);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button type="button" variant="outline" size="sm">
            {strings.pos.addBarangFromPosButton}
          </Button>
        }
      />
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <form action={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{strings.barang.intakeTitle}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label>{strings.barang.category}</Label>
            <div className="flex flex-wrap gap-2">
              <Chip selected={categoryId === ""} onClick={() => setCategoryId("")}>
                {strings.barang.noCategoryOption}
              </Chip>
              {categories.map((c) => (
                <Chip key={c.id} selected={categoryId === c.id} onClick={() => setCategoryId(c.id)}>
                  {c.name}
                </Chip>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label>{strings.barang.pemilik}</Label>
            <div className="flex flex-wrap gap-2">
              <Chip selected={pemilikId === ""} onClick={() => setPemilikId("")}>
                {strings.barang.pemilikTokoSendiri}
              </Chip>
              {pemilikList.map((p) => (
                <Chip key={p.id} selected={pemilikId === p.id} onClick={() => setPemilikId(p.id)}>
                  {p.nama}
                </Chip>
              ))}
            </div>
          </div>

          <BarangImageField ref={imageFieldRef} barangName="" />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="pos-add-nama">{strings.barang.nama}</Label>
              <Input id="pos-add-nama" name="nama" required autoFocus />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="pos-add-merek">{strings.barang.merek}</Label>
              <Input id="pos-add-merek" name="merek" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="pos-add-warna">{strings.barang.warna}</Label>
              <Input id="pos-add-warna" name="warna" />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label>{strings.barang.ukuran}</Label>
            <div className="flex flex-wrap gap-2">
              {ukuranPresets.map((u) => (
                <Chip
                  key={u}
                  selected={!ukuranCustom && ukuran === u}
                  onClick={() => {
                    setUkuranCustom(false);
                    setUkuran(u);
                  }}
                >
                  {u}
                </Chip>
              ))}
              <Chip selected={ukuranCustom} onClick={() => setUkuranCustom(true)}>
                {strings.barang.otherOption}
              </Chip>
            </div>
            {ukuranCustom ? (
              <Input
                value={ukuran}
                onChange={(e) => setUkuran(e.target.value)}
                placeholder={strings.barang.ukuranPlaceholder}
                autoFocus
              />
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label>{strings.barang.kondisi}</Label>
            <div className="flex flex-wrap gap-2">
              {KONDISI_PRESETS.map((k) => (
                <Chip
                  key={k}
                  selected={!kondisiCustom && kondisi === k}
                  onClick={() => {
                    setKondisiCustom(false);
                    setKondisi(k);
                  }}
                >
                  {k}
                </Chip>
              ))}
              <Chip selected={kondisiCustom} onClick={() => setKondisiCustom(true)}>
                {strings.barang.otherOption}
              </Chip>
            </div>
            {kondisiCustom ? (
              <Input
                value={kondisi}
                onChange={(e) => setKondisi(e.target.value)}
                placeholder={strings.barang.kondisiPlaceholder}
                autoFocus
              />
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="pos-add-modal">{strings.barang.hargaModal}</Label>
              <Input
                id="pos-add-modal"
                type="number"
                min={0}
                step="1"
                value={hargaModal}
                onChange={(e) => handleHargaModalChange(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="pos-add-jual">{strings.barang.hargaJual}</Label>
              <Input
                id="pos-add-jual"
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

          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? strings.common.saving : strings.barang.intakeSaveButton}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
