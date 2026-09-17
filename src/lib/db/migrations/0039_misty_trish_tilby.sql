ALTER TABLE "stock_transfers" ADD COLUMN "sent_photo_path" text;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD COLUMN "sent_photo_missing_reason" text;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD COLUMN "received_photo_path" text;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD COLUMN "received_photo_missing_reason" text;--> statement-breakpoint
-- Langkah D (17 September 2026) -- check_stock_transfer_transition
-- (migration 0024) diperluas mengenal 4 kolom foto baru: WAJIB SATU dari
-- {sent_photo_path, sent_photo_missing_reason} terisi tepat saat transisi
-- approved->sent (bukan sebelum/sesudahnya), begitu juga pasangan
-- received_* tepat saat sent->received -- foto/alasan tidak boleh
-- "menyusul" di transisi lain, dan tidak boleh dua-duanya kosong ATAU
-- dua-duanya terisi. Definisi fungsi diganti UTUH (bukan ALTER kolom per
-- kolom) supaya seluruh state machine tetap satu sumber kebenaran yang
-- bisa dibaca sekali jalan -- pola sama migration 0024 mengganti trigger
-- v1 secara utuh.
CREATE OR REPLACE FUNCTION check_stock_transfer_transition()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Field inti: TIDAK PERNAH berubah lewat transisi status apa pun, apa pun transisinya.
  IF NEW.business_id != OLD.business_id
     OR NEW.from_outlet_id != OLD.from_outlet_id
     OR NEW.to_outlet_id != OLD.to_outlet_id
     OR NEW.note IS DISTINCT FROM OLD.note
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.created_at != OLD.created_at
  THEN
    RAISE EXCEPTION 'Field inti transfer stok tidak boleh berubah lewat transisi status';
  END IF;

  IF OLD.status = 'requested' AND NEW.status = 'approved' THEN
    IF NEW.approved_by IS NULL OR NEW.approved_at IS NULL THEN
      RAISE EXCEPTION 'approved_by dan approved_at wajib diisi saat menyetujui';
    END IF;
    IF NEW.number IS DISTINCT FROM OLD.number
       OR NEW.rejected_by IS NOT NULL OR NEW.rejected_at IS NOT NULL OR NEW.rejected_reason IS NOT NULL
       OR NEW.sent_by IS NOT NULL OR NEW.sent_at IS NOT NULL
       OR NEW.sent_photo_path IS NOT NULL OR NEW.sent_photo_missing_reason IS NOT NULL
       OR NEW.received_by IS NOT NULL OR NEW.received_at IS NOT NULL
       OR NEW.received_photo_path IS NOT NULL OR NEW.received_photo_missing_reason IS NOT NULL
       OR NEW.cancel_reason IS NOT NULL OR NEW.cancelled_at IS NOT NULL OR NEW.cancelled_by IS NOT NULL
    THEN
      RAISE EXCEPTION 'Transisi requested->approved cuma boleh mengisi approved_by/approved_at';
    END IF;

  ELSIF OLD.status = 'requested' AND NEW.status = 'rejected' THEN
    IF NEW.rejected_by IS NULL OR NEW.rejected_at IS NULL OR NEW.rejected_reason IS NULL THEN
      RAISE EXCEPTION 'rejected_by, rejected_at, dan rejected_reason wajib diisi saat menolak';
    END IF;
    IF NEW.number IS DISTINCT FROM OLD.number
       OR NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL
       OR NEW.sent_by IS NOT NULL OR NEW.sent_at IS NOT NULL
       OR NEW.sent_photo_path IS NOT NULL OR NEW.sent_photo_missing_reason IS NOT NULL
       OR NEW.received_by IS NOT NULL OR NEW.received_at IS NOT NULL
       OR NEW.received_photo_path IS NOT NULL OR NEW.received_photo_missing_reason IS NOT NULL
       OR NEW.cancel_reason IS NOT NULL OR NEW.cancelled_at IS NOT NULL OR NEW.cancelled_by IS NOT NULL
    THEN
      RAISE EXCEPTION 'Transisi requested->rejected cuma boleh mengisi rejected_by/rejected_at/rejected_reason';
    END IF;

  ELSIF OLD.status = 'approved' AND NEW.status = 'sent' THEN
    IF NEW.sent_by IS NULL OR NEW.sent_at IS NULL THEN
      RAISE EXCEPTION 'sent_by dan sent_at wajib diisi saat mengirim';
    END IF;
    IF NOT (
      (NEW.sent_photo_path IS NOT NULL AND NEW.sent_photo_missing_reason IS NULL)
      OR (NEW.sent_photo_path IS NULL AND NEW.sent_photo_missing_reason IS NOT NULL)
    ) THEN
      RAISE EXCEPTION 'Saat mengirim wajib isi TEPAT SATU dari sent_photo_path atau sent_photo_missing_reason';
    END IF;
    IF NEW.received_by IS NOT NULL OR NEW.received_at IS NOT NULL
       OR NEW.received_photo_path IS NOT NULL OR NEW.received_photo_missing_reason IS NOT NULL
       OR NEW.cancel_reason IS NOT NULL OR NEW.cancelled_at IS NOT NULL OR NEW.cancelled_by IS NOT NULL
    THEN
      RAISE EXCEPTION 'Transisi approved->sent cuma boleh mengisi sent_by/sent_at/number/sent_photo_*';
    END IF;

  ELSIF OLD.status = 'sent' AND NEW.status = 'received' THEN
    IF NEW.received_by IS NULL OR NEW.received_at IS NULL THEN
      RAISE EXCEPTION 'received_by dan received_at wajib diisi saat menerima';
    END IF;
    IF NOT (
      (NEW.received_photo_path IS NOT NULL AND NEW.received_photo_missing_reason IS NULL)
      OR (NEW.received_photo_path IS NULL AND NEW.received_photo_missing_reason IS NOT NULL)
    ) THEN
      RAISE EXCEPTION 'Saat menerima wajib isi TEPAT SATU dari received_photo_path atau received_photo_missing_reason';
    END IF;
    IF NEW.number IS DISTINCT FROM OLD.number
       OR NEW.sent_photo_path IS DISTINCT FROM OLD.sent_photo_path
       OR NEW.sent_photo_missing_reason IS DISTINCT FROM OLD.sent_photo_missing_reason
       OR NEW.cancel_reason IS NOT NULL OR NEW.cancelled_at IS NOT NULL OR NEW.cancelled_by IS NOT NULL
    THEN
      RAISE EXCEPTION 'Transisi sent->received cuma boleh mengisi received_by/received_at/received_photo_*';
    END IF;

  ELSIF NEW.status = 'cancelled' AND OLD.status IN ('requested', 'approved', 'received') THEN
    IF NEW.cancel_reason IS NULL OR NEW.cancelled_at IS NULL OR NEW.cancelled_by IS NULL THEN
      RAISE EXCEPTION 'cancel_reason, cancelled_at, dan cancelled_by wajib diisi saat membatalkan';
    END IF;
    -- Kolom tahap lain (apa pun isinya dari sebelum dibatalkan) harus
    -- tetap sama seperti sebelum pembatalan -- cuma tiga kolom cancel_*
    -- yang boleh berubah, terlepas dari status asal pembatalan.
    IF NEW.number IS DISTINCT FROM OLD.number
       OR NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
       OR NEW.rejected_by IS DISTINCT FROM OLD.rejected_by OR NEW.rejected_at IS DISTINCT FROM OLD.rejected_at OR NEW.rejected_reason IS DISTINCT FROM OLD.rejected_reason
       OR NEW.sent_by IS DISTINCT FROM OLD.sent_by OR NEW.sent_at IS DISTINCT FROM OLD.sent_at
       OR NEW.sent_photo_path IS DISTINCT FROM OLD.sent_photo_path
       OR NEW.sent_photo_missing_reason IS DISTINCT FROM OLD.sent_photo_missing_reason
       OR NEW.received_by IS DISTINCT FROM OLD.received_by OR NEW.received_at IS DISTINCT FROM OLD.received_at
       OR NEW.received_photo_path IS DISTINCT FROM OLD.received_photo_path
       OR NEW.received_photo_missing_reason IS DISTINCT FROM OLD.received_photo_missing_reason
    THEN
      RAISE EXCEPTION 'Transisi ke cancelled cuma boleh mengisi cancel_reason/cancelled_at/cancelled_by';
    END IF;

  ELSE
    RAISE EXCEPTION 'Transisi status % -> % tidak diizinkan', OLD.status, NEW.status;
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
-- Bucket Storage 'stock-transfers' -- pola PERSIS sama 'products' (T09c,
-- migration 0012), privat + RLS berbasis segmen pertama path = business_id.
-- Path objek: {business_id}/{transfer_id}/{send|receive}.jpg
-- (lib/stock-transfers/photo.ts#getStockTransferPhotoPath).
insert into storage.buckets (id, name, public)
values ('stock-transfers', 'stock-transfers', false)
on conflict (id) do nothing;--> statement-breakpoint
create policy "stock_transfers_storage_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'stock-transfers' and (storage.foldername(name))[1]::uuid = any(public.auth_business_ids()));--> statement-breakpoint
create policy "stock_transfers_storage_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'stock-transfers' and (storage.foldername(name))[1]::uuid = any(public.auth_business_ids()));--> statement-breakpoint
create policy "stock_transfers_storage_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'stock-transfers' and (storage.foldername(name))[1]::uuid = any(public.auth_business_ids()))
  with check (bucket_id = 'stock-transfers' and (storage.foldername(name))[1]::uuid = any(public.auth_business_ids()));--> statement-breakpoint
create policy "stock_transfers_storage_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'stock-transfers' and (storage.foldername(name))[1]::uuid = any(public.auth_business_ids()));