"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { markAuditReviewed } from "@/app/(dashboard)/audit/actions";
import { Button } from "@/components/ui/button";
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
 * "Sudah ditinjau" per outlet per hari -- keluaran laporan auditor
 * (Rencana Revisi 24 September 2026). Menimpa tanda sebelumnya kalau
 * ditinjau ulang (lihat unique constraint audit_reviews_outlet_date_unique,
 * schema.ts) -- siapa+kapan+catatan SELALU yang terbaru, bukan riwayat.
 */
export function ReviewDialog({
  outletId,
  outletName,
  businessDate,
  alreadyReviewed,
}: {
  outletId: string;
  outletName: string;
  businessDate: string;
  alreadyReviewed: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit() {
    setIsPending(true);
    try {
      const result = await markAuditReviewed({ outletId, businessDate, note: note.trim() || undefined });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(strings.audit.reviewSuccess);
      setOpen(false);
      setNote("");
      router.refresh();
    } catch (err) {
      console.error("Tandai sudah ditinjau gagal:", err);
      toast.error(err instanceof Error ? err.message : strings.common.unexpectedError);
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant={alreadyReviewed ? "outline" : "default"} size="sm" className="w-full sm:w-auto">
            {alreadyReviewed ? strings.audit.reviewButtonUpdate : strings.audit.reviewButtonMark}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{strings.audit.reviewDialogTitle.replace("{outlet}", outletName)}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2 py-2">
          <Label htmlFor="reviewNote">{strings.audit.reviewNoteLabel}</Label>
          <Textarea
            id="reviewNote"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={strings.audit.reviewNotePlaceholder}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            {strings.common.cancel}
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? strings.audit.reviewSubmitting : strings.audit.reviewSubmitButton}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
