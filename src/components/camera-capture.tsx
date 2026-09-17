"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { compressImageToJpeg } from "@/lib/utils/compress-image";
import { id as strings } from "@/lib/i18n/id";

type Status = "requesting" | "ready" | "denied" | "failed" | "not_supported" | "preview";

/**
 * components/camera-capture.tsx — Langkah D (17 September 2026).
 *
 * Konsep dan tiga perbaikan bug di bawah PORTED (ditulis ulang, bukan
 * disalin) dari components/CameraCapture.tsx di repo reportkoperumnasgroup
 * -- repo TERPISAH, styling terpisah (inline style + CSS custom property,
 * bukan Tailwind/shadcn), jadi tidak bisa diimpor langsung (lihat
 * docs/RENCANA-PEMBANGUNAN-KASIR-THRIFTING.md §40). Yang dipakai ulang
 * adalah POLA-nya -- tiga hal ini adalah perbaikan bug produksi nyata di
 * sana, bukan spekulasi, jadi diikuti apa adanya:
 *
 * 1. `getUserMedia({facingMode})`, BUKAN `<input type=file capture>` --
 *    cuma getUserMedia yang benar-benar MENJAMIN kamera live, bukan
 *    galeri (itu yang membuat foto ini jadi bukti, instruksi CEO).
 * 2. `srcObject` disambungkan di EFEK TERPISAH setelah `status='ready'`
 *    -- elemen <video> belum ada di DOM saat `.then()` getUserMedia
 *    pertama kali jalan (masih render status 'requesting').
 * 3. Balik kamera = `getUserMedia` BARU (stream dari sensor lain
 *    sungguhan), bukan `transform: scaleX(-1)` CSS -- itu cuma
 *    mencerminkan gambar yang sama, bukan mengganti kamera.
 *
 * TIDAK ADA jalur pilih dari galeri sama sekali -- itu prinsip, bukan
 * kelalaian.
 */
export function CameraCapture({
  facingMode,
  maxDimension,
  maxBytes,
  onCaptured,
  onUnavailable,
}: {
  /** WAJIB eksplisit, sama alasan komponen referensi -- pemanggil harus sadar memilih. */
  facingMode: "user" | "environment";
  maxDimension: number;
  maxBytes: number;
  onCaptured: (blob: Blob) => void;
  /** Dipanggil saat status jadi denied/failed/not_supported -- parent memutuskan UI "lanjut tanpa foto". */
  onUnavailable?: (status: "denied" | "failed" | "not_supported") => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<Status>("requesting");
  const [facingActive, setFacingActive] = useState<"user" | "environment">(facingMode);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [isCompressing, setIsCompressing] = useState(false);
  const [isFlipping, setIsFlipping] = useState(false);

  useEffect(() => {
    let cancelled = false;

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        Promise.resolve().then(() => {
          if (!cancelled) setStatus("not_supported");
        });
        return;
      }
      navigator.mediaDevices
        .getUserMedia({ video: { facingMode }, audio: false })
        .then((stream) => {
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          streamRef.current = stream;
          setStatus("ready");
        })
        .catch((err) => {
          if (cancelled) return;
          setStatus(err?.name === "NotAllowedError" ? "denied" : "failed");
        });
    } catch {
      Promise.resolve().then(() => {
        if (!cancelled) setStatus("failed");
      });
    }

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    // facingMode: nilai TETAP per pemakaian (pemanggil tidak pernah
    // mengubahnya di tengah satu sesi kamera terbuka).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (status !== "ready" || !videoRef.current || !streamRef.current) return;
    const video = videoRef.current;
    video.srcObject = streamRef.current;
    video.play().catch(() => {
      // gagal play() tidak fatal -- browser lain kadang menolak play()
      // terprogram tapi tetap menampilkan frame pertama lewat autoplay.
    });
  }, [status]);

  useEffect(() => {
    if (status === "denied" || status === "failed" || status === "not_supported") {
      onUnavailable?.(status);
    }
    // Sengaja cuma bereaksi ke perubahan status -- onUnavailable dari
    // parent tidak stabil identitasnya antar render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  function retry() {
    setStatus("requesting");
  }

  async function flipCamera() {
    if (!navigator.mediaDevices?.getUserMedia || isFlipping) return;
    const nextFacing = facingActive === "user" ? "environment" : "user";
    setIsFlipping(true);
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: nextFacing },
        audio: false,
      });
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = newStream;
      if (videoRef.current) {
        videoRef.current.srcObject = newStream;
        videoRef.current.play().catch(() => {});
      }
      const reported = newStream.getVideoTracks()[0]?.getSettings().facingMode;
      setFacingActive(reported === "environment" ? "environment" : reported === "user" ? "user" : nextFacing);
    } catch {
      // Kamera lain tidak tersedia -- tetap pakai yang sekarang, diam-diam
      // gagal di sini tidak berbahaya (pengguna tetap punya kamera aktif).
    } finally {
      setIsFlipping(false);
    }
  }

  async function capture() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    setIsCompressing(true);
    try {
      canvas.toBlob(
        async (rawBlob) => {
          if (!rawBlob) {
            setIsCompressing(false);
            return;
          }
          const compressed = await compressImageToJpeg(rawBlob, maxDimension, maxBytes);
          setCapturedBlob(compressed);
          setPreviewUrl(URL.createObjectURL(compressed));
          setStatus("preview");
          setIsCompressing(false);
        },
        "image/jpeg",
        0.92
      );
    } catch {
      setIsCompressing(false);
    }
  }

  function retake() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setCapturedBlob(null);
    setStatus("ready");
  }

  function confirmUse() {
    if (capturedBlob) onCaptured(capturedBlob);
  }

  if (status === "requesting") {
    return <p className="text-sm text-muted-foreground">{strings.stockTransfers.photoRequestingPermission}</p>;
  }

  if (status === "denied") {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-destructive/50 bg-destructive/5 p-3">
        <p className="text-sm text-destructive">{strings.stockTransfers.photoPermissionDenied}</p>
        <Button type="button" variant="outline" size="sm" onClick={retry} className="w-fit">
          {strings.stockTransfers.photoCameraFailedRetry}
        </Button>
      </div>
    );
  }

  if (status === "failed" || status === "not_supported") {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-destructive/50 bg-destructive/5 p-3">
        <p className="text-sm font-medium text-destructive">{strings.stockTransfers.photoCameraFailedTitle}</p>
        <p className="text-sm text-muted-foreground">
          {status === "not_supported"
            ? strings.stockTransfers.photoNotSupported
            : strings.stockTransfers.photoPermissionDenied}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={retry} className="w-fit">
          {strings.stockTransfers.photoCameraFailedRetry}
        </Button>
      </div>
    );
  }

  if (status === "preview" && previewUrl) {
    return (
      <div className="flex flex-col gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- pratinjau lokal dari blob kamera, bukan aset Next */}
        <img
          src={previewUrl}
          alt={strings.stockTransfers.photoPreviewAlt}
          className="w-full max-w-sm rounded-md border object-cover"
        />
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={retake}>
            {strings.stockTransfers.photoRetakeButton}
          </Button>
          <Button type="button" size="sm" onClick={confirmUse}>
            {strings.stockTransfers.photoUseButton}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative max-w-sm">
        <video ref={videoRef} autoPlay playsInline muted className="w-full rounded-md border" />
        <button
          type="button"
          onClick={() => void flipCamera()}
          disabled={isFlipping}
          aria-label={strings.stockTransfers.photoFlipCameraLabel}
          title={strings.stockTransfers.photoFlipCameraLabel}
          className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M17 2.1l4 4-4 4" />
            <path d="M3 12.2v-2a4 4 0 0 1 4-4h14" />
            <path d="M7 21.9l-4-4 4-4" />
            <path d="M21 11.8v2a4 4 0 0 1-4 4H3" />
          </svg>
        </button>
      </div>
      <Button type="button" size="sm" disabled={isCompressing} onClick={() => void capture()} className="w-fit">
        {isCompressing ? strings.common.saving : strings.stockTransfers.photoTakeButton}
      </Button>
    </div>
  );
}
