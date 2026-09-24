ALTER TABLE "shifts" ADD COLUMN "prepare_photo_path" text;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "prepare_photo_missing_reason" text;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "prepare_has_event" boolean;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "prepare_event_note" text;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "closing_photo_path" text;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "closing_photo_missing_reason" text;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "closing_cleanliness_note" text;--> statement-breakpoint
-- Laporan Prepare/Closing (24 September 2026) -- bucket Storage
-- 'shift-reports', pola PERSIS sama 'stock-transfers' (migration 0039):
-- privat + RLS berbasis segmen pertama path = business_id.
-- Path objek: {business_id}/{shift_id}/{prepare|closing}.jpg
-- (lib/pos/shift-report-photo.ts#getShiftReportPhotoPath).
insert into storage.buckets (id, name, public)
values ('shift-reports', 'shift-reports', false)
on conflict (id) do nothing;--> statement-breakpoint
create policy "shift_reports_storage_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'shift-reports' and (storage.foldername(name))[1]::uuid = any(public.auth_business_ids()));--> statement-breakpoint
create policy "shift_reports_storage_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'shift-reports' and (storage.foldername(name))[1]::uuid = any(public.auth_business_ids()));--> statement-breakpoint
create policy "shift_reports_storage_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'shift-reports' and (storage.foldername(name))[1]::uuid = any(public.auth_business_ids()))
  with check (bucket_id = 'shift-reports' and (storage.foldername(name))[1]::uuid = any(public.auth_business_ids()));--> statement-breakpoint
create policy "shift_reports_storage_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'shift-reports' and (storage.foldername(name))[1]::uuid = any(public.auth_business_ids()));