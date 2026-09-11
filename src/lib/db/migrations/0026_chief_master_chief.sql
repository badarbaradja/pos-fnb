CREATE TYPE "public"."pos_mode" AS ENUM('fnb', 'thrifting');--> statement-breakpoint
ALTER TYPE "public"."order_channel" ADD VALUE 'retail';--> statement-breakpoint
ALTER TABLE "outlets" ADD COLUMN "pos_mode" "pos_mode" DEFAULT 'fnb' NOT NULL;
--> statement-breakpoint
-- TT04 (10 September 2026) -- bucket Storage 'barang' + RLS di
-- storage.objects, ditulis manual (Drizzle tidak punya builder untuk ini,
-- lihat migration 0012 soal bucket 'products' -- pola persis sama, cuma
-- bucket berbeda karena foto barang titipan bukan foto menu). Bucket
-- PRIVAT, akses lewat signed URL server-side, konvensi path
-- {business_id}/{barang_id}.jpg (lib/barang/image.ts#getBarangImagePath).
insert into storage.buckets (id, name, public)
values ('barang', 'barang', false)
on conflict (id) do nothing;
--> statement-breakpoint
create policy "barang_storage_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'barang' and (storage.foldername(name))[1]::uuid = any(public.auth_business_ids()));
--> statement-breakpoint
create policy "barang_storage_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'barang' and (storage.foldername(name))[1]::uuid = any(public.auth_business_ids()));
--> statement-breakpoint
create policy "barang_storage_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'barang' and (storage.foldername(name))[1]::uuid = any(public.auth_business_ids()))
  with check (bucket_id = 'barang' and (storage.foldername(name))[1]::uuid = any(public.auth_business_ids()));
--> statement-breakpoint
create policy "barang_storage_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'barang' and (storage.foldername(name))[1]::uuid = any(public.auth_business_ids()));