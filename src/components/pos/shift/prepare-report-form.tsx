"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { submitPrepareReport } from "@/app/(pos)/pos/shift/actions";
import { CameraCapture } from "@/components/camera-capture";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { id as strings } from "@/lib/i18n/id";

const PHOTO_MAX_DIMENSION = 1280;
const PHOTO_MAX_BYTES = 600_000; // sama Langkah D (stock-transfers) -- foto bukti perlu detail

/**
 * Rencana Revisi 24 September 2026 -- gerbang sebelum kasir bisa jualan
 * (lib/pos/shift.ts checkShiftSellability -> 'prepare_required'). Satu
 * kali submit: foto (atau alasan kamera gagal) + jawaban event, TIDAK
 * ada draft bertahap seperti opname -- begitu berhasil, langsung ke /pos.
 *
 * Server Action dipanggil LANGSUNG sebagai fungsi async (bukan lewat
 * useActionState + <form action>) -- pola sama saveShiftOpnameItems/
 * submitShiftOpname (shift-opname-form.tsx). Hasil sukses/gagal dibaca
 * dari nilai AWAIT langsung, bukan dari state useActionState yang bisa
 * stale di closure `<form action>` (lihat komentar di manage.ts soal
 * kenapa itu tidak dipakai di sini) -- dan tidak ada setState di dalam
 * effect sama sekali (react-hooks/set-state-in-effect).
 */
export function PrepareReportForm({ shiftId }: { shiftId: string }) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  const [photoBlob, setPhotoBlobState] = useState<Blob | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [photoMissingReason, setPhotoMissingReason] = useState<string | null>(null);
  const [cameraUnavailable, setCameraUnavailable] = useState<"denied" | "failed" | "not_supported" | null>(null);
  const photoPreviewUrlRef = useRef<string | null>(null);

  const [hasEvent, setHasEvent] = useState<"yes" | "no" | null>(null);
  const [eventNote, setEventNote] = useState("");

  function setPhotoBlob(blob: Blob) {
    if (photoPreviewUrlRef.current) URL.revokeObjectURL(photoPreviewUrlRef.current);
    const url = URL.createObjectURL(blob);
    photoPreviewUrlRef.current = url;
    setPhotoMissingReason(null);
    setCameraUnavailable(null);
    setPhotoBlobState(blob);
    setPhotoPreviewUrl(url);
  }

  function retakePhoto() {
    if (photoPreviewUrlRef.current) {
      URL.revokeObjectURL(photoPreviewUrlRef.current);
      photoPreviewUrlRef.current = null;
    }
    setPhotoBlobState(null);
    setPhotoPreviewUrl(null);
    setCameraUnavailable(null);
  }

  function continueWithoutPhoto() {
    if (!window.confirm(strings.shiftReport.preparePhotoContinueWithoutConfirm)) return;
    if (photoPreviewUrlRef.current) {
      URL.revokeObjectURL(photoPreviewUrlRef.current);
      photoPreviewUrlRef.current = null;
    }
    setPhotoBlobState(null);
    setPhotoPreviewUrl(null);
    setPhotoMissingReason(
      strings.stockTransfers.photoMissingAutoReason.replace("{step}", strings.shiftReport.photoMissingReasonStepPrepare)
    );
  }

  useEffect(() => {
    return () => {
      if (photoPreviewUrlRef.current) URL.revokeObjectURL(photoPreviewUrlRef.current);
    };
  }, []);

  const hasEventAnswered = hasEvent !== null;
  const eventNoteOk = hasEvent === "no" || (hasEvent === "yes" && eventNote.trim() !== "");
  const hasPhotoOrReason = Boolean(photoBlob || photoMissingReason);
  const canSubmit = hasPhotoOrReason && hasEventAnswered && eventNoteOk;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsPending(true);
    try {
      const formData = new FormData();
      formData.set("shiftId", shiftId);
      if (photoBlob) {
        formData.append("photoFile", photoBlob, "prepare.jpg");
      } else if (photoMissingReason) {
        formData.append("photoMissingReason", photoMissingReason);
      }
      formData.set("hasEvent", hasEvent === "yes" ? "true" : "false");
      if (hasEvent === "yes") {
        formData.set("eventNote", eventNote.trim());
      }
      const result = await submitPrepareReport({}, formData);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      router.push("/pos");
      router.refresh();
    } catch (err) {
      console.error("Submit laporan prepare gagal:", err);
      toast.error(err instanceof Error ? err.message : strings.common.unexpectedError);
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">{strings.shiftReport.prepareTitle}</h1>
        <p className="text-sm text-muted-foreground">{strings.shiftReport.prepareHint}</p>
      </div>

      <div className="flex flex-col gap-2 rounded-lg border p-3">
        <Label>{strings.shiftReport.preparePhotoLabel}</Label>
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
              onClick={() => setPhotoMissingReason(null)}
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

      <div className="flex flex-col gap-2 rounded-lg border p-3">
        <Label>{strings.shiftReport.prepareEventQuestion}</Label>
        <div className="flex gap-2">
          <Button
            type="button"
            variant={hasEvent === "yes" ? "default" : "outline"}
            size="sm"
            onClick={() => setHasEvent("yes")}
          >
            {strings.shiftReport.prepareEventYes}
          </Button>
          <Button
            type="button"
            variant={hasEvent === "no" ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setHasEvent("no");
              setEventNote("");
            }}
          >
            {strings.shiftReport.prepareEventNo}
          </Button>
        </div>
        {hasEvent === "yes" ? (
          <Textarea
            value={eventNote}
            onChange={(e) => setEventNote(e.target.value)}
            placeholder={strings.shiftReport.prepareEventNotePlaceholder}
            required
          />
        ) : null}
      </div>

      <Button type="submit" disabled={isPending || !canSubmit} size="lg">
        {isPending ? strings.shiftReport.prepareSubmitting : strings.shiftReport.prepareSubmitButton}
      </Button>
    </form>
  );
}
