"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { submitClosingReport } from "@/app/(pos)/pos/shift/actions";
import { CameraCapture } from "@/components/camera-capture";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { id as strings } from "@/lib/i18n/id";

const PHOTO_MAX_DIMENSION = 1280;
const PHOTO_MAX_BYTES = 600_000;

/**
 * Rencana Revisi 24 September 2026 -- laporan Closing, DITEMPEL di layar
 * tutup shift yang sudah ada (close-shift-form.tsx / close-cashless-
 * shift-form.tsx), SESUDAH bagian opname (kalau ada) dan SEBELUM bagian
 * kas -- bukan langkah/halaman terpisah. Disimpan lewat
 * submitClosingReport dipanggil LANGSUNG (bukan lewat useActionState,
 * sama alasan pola PrepareReportForm) SETIAP kali foto dikonfirmasi atau
 * catatan kehilangan fokus (autosave, pola sama handleBlurSave di
 * shift-opname-form.tsx) -- TERPISAH dari tombol tutup shift itu sendiri.
 * lib/pos/shift.ts (submitCountedCashWithDb dkk) memvalidasi ULANG lewat
 * isClosingReportComplete() sebelum shift benar-benar closed, jadi
 * urutan yang benar (isi laporan dulu, baru tutup) ditegakkan di server.
 */
export function ClosingReportForm({ shiftId }: { shiftId: string }) {
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [photoBlob, setPhotoBlobState] = useState<Blob | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [photoMissingReason, setPhotoMissingReason] = useState<string | null>(null);
  const [cameraUnavailable, setCameraUnavailable] = useState<"denied" | "failed" | "not_supported" | null>(null);
  const photoPreviewUrlRef = useRef<string | null>(null);
  const [cleanlinessNote, setCleanlinessNote] = useState("");

  useEffect(() => {
    return () => {
      if (photoPreviewUrlRef.current) URL.revokeObjectURL(photoPreviewUrlRef.current);
    };
  }, []);

  async function save(photo: { blob: Blob | null; missingReason: string | null }, note: string) {
    if (!(photo.blob || photo.missingReason) || note.trim() === "") return;
    setIsSaving(true);
    try {
      const formData = new FormData();
      formData.set("shiftId", shiftId);
      if (photo.blob) {
        formData.append("photoFile", photo.blob, "closing.jpg");
      } else if (photo.missingReason) {
        formData.append("photoMissingReason", photo.missingReason);
      }
      formData.set("cleanlinessNote", note.trim());
      const result = await submitClosingReport({}, formData);
      if (result.error) {
        toast.error(result.error);
        setSaved(false);
        return;
      }
      setSaved(true);
    } catch (err) {
      console.error("Submit laporan closing gagal:", err);
      toast.error(err instanceof Error ? err.message : strings.common.unexpectedError);
      setSaved(false);
    } finally {
      setIsSaving(false);
    }
  }

  function setPhotoBlob(blob: Blob) {
    if (photoPreviewUrlRef.current) URL.revokeObjectURL(photoPreviewUrlRef.current);
    const url = URL.createObjectURL(blob);
    photoPreviewUrlRef.current = url;
    setPhotoMissingReason(null);
    setCameraUnavailable(null);
    setPhotoBlobState(blob);
    setPhotoPreviewUrl(url);
    void save({ blob, missingReason: null }, cleanlinessNote);
  }

  function retakePhoto() {
    if (photoPreviewUrlRef.current) {
      URL.revokeObjectURL(photoPreviewUrlRef.current);
      photoPreviewUrlRef.current = null;
    }
    setPhotoBlobState(null);
    setPhotoPreviewUrl(null);
    setCameraUnavailable(null);
    setSaved(false);
  }

  function continueWithoutPhoto() {
    if (!window.confirm(strings.shiftReport.closingPhotoContinueWithoutConfirm)) return;
    if (photoPreviewUrlRef.current) {
      URL.revokeObjectURL(photoPreviewUrlRef.current);
      photoPreviewUrlRef.current = null;
    }
    setPhotoBlobState(null);
    setPhotoPreviewUrl(null);
    const reason = strings.stockTransfers.photoMissingAutoReason.replace(
      "{step}",
      strings.shiftReport.photoMissingReasonStepClosing
    );
    setPhotoMissingReason(reason);
    void save({ blob: null, missingReason: reason }, cleanlinessNote);
  }

  function handleNoteBlur() {
    void save({ blob: photoBlob, missingReason: photoMissingReason }, cleanlinessNote);
  }

  const hasPhotoOrReason = Boolean(photoBlob || photoMissingReason);

  return (
    <div className="flex w-full max-w-sm flex-col gap-2">
      <h2 className="text-base font-semibold">{strings.shiftReport.closingTitle}</h2>
      <p className="text-sm text-muted-foreground">{strings.shiftReport.closingHint}</p>

      <div className="flex flex-col gap-2 rounded-lg border p-3">
        <Label>{strings.shiftReport.closingPhotoLabel}</Label>
        {photoBlob && photoPreviewUrl ? (
          <div className="flex flex-col gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- pratinjau lokal dari blob kamera */}
            <img
              src={photoPreviewUrl}
              alt={strings.stockTransfers.photoPreviewAlt}
              className="w-full max-w-sm rounded-md border object-cover"
            />
            <Button type="button" variant="outline" size="sm" className="w-fit" onClick={retakePhoto}>
              {strings.stockTransfers.photoRetakeButton}
            </Button>
          </div>
        ) : photoMissingReason ? (
          <div className="flex flex-col gap-2 rounded-md border border-amber-500/50 bg-amber-500/5 p-2 text-sm">
            <p>{photoMissingReason}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => {
                setPhotoMissingReason(null);
                setSaved(false);
              }}
            >
              {strings.stockTransfers.photoCameraFailedRetry}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <CameraCapture
              facingMode="environment"
              maxDimension={PHOTO_MAX_DIMENSION}
              maxBytes={PHOTO_MAX_BYTES}
              onCaptured={setPhotoBlob}
              onUnavailable={setCameraUnavailable}
            />
            {cameraUnavailable ? (
              <Button type="button" variant="outline" size="sm" className="w-fit" onClick={continueWithoutPhoto}>
                {strings.stockTransfers.photoContinueWithoutButton}
              </Button>
            ) : null}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="cleanlinessNote">{strings.shiftReport.closingCleanlinessLabel}</Label>
        <Textarea
          id="cleanlinessNote"
          value={cleanlinessNote}
          onChange={(e) => {
            setCleanlinessNote(e.target.value);
            setSaved(false);
          }}
          onBlur={handleNoteBlur}
          placeholder={strings.shiftReport.closingCleanlinessPlaceholder}
          required
        />
      </div>

      {isSaving ? (
        <p className="text-xs text-muted-foreground">{strings.shiftReport.closingSaving}</p>
      ) : saved ? (
        <p className="text-xs text-muted-foreground">{strings.shiftReport.closingSaved}</p>
      ) : !hasPhotoOrReason || cleanlinessNote.trim() === "" ? (
        <p className="text-xs text-muted-foreground">{strings.shiftReport.closingReportRequiredError}</p>
      ) : null}
    </div>
  );
}
