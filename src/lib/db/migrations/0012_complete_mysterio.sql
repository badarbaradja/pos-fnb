ALTER TABLE "products" DROP COLUMN "image_url";
--> statement-breakpoint
-- T09c: bucket Storage 'products' + RLS di storage.objects -- Drizzle
-- tidak punya builder untuk ini (pola sama seperti FORCE ROW LEVEL
-- SECURITY di migration 0001/0003/0005/0010). Bucket PRIVAT (public =
-- false) -- akses gambar lewat signed URL yang di-generate server-side
-- per request, bukan URL publik permanen (CLAUDE.md §3.4, RLS-nya
-- tegak, bukan cuma mengandalkan UUID yang susah ditebak).
--
-- Konvensi path objek: {business_id}/{product_id}.jpg (deterministik,
-- lihat lib/products/image.ts#getProductImagePath) -- upload ulang pakai
-- upsert:true ke path yang sama, jadi tidak pernah ada file lama
-- tertinggal saat gambar diganti.
insert into storage.buckets (id, name, public)
values ('products', 'products', false)
on conflict (id) do nothing;
--> statement-breakpoint
-- (storage.foldername(name))[1] = segmen path pertama objek (business_id
-- kita taruh sebagai folder pertama) -- dicocokkan ke auth_business_ids()
-- (BLUEPRINT §9.5), pola RLS yang identik dengan tabel Postgres biasa,
-- cuma diterapkan ke storage.objects. public.auth_business_ids()
-- dikualifikasi eksplisit karena storage.objects ada di skema lain.
create policy "products_storage_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'products' and (storage.foldername(name))[1]::uuid = any(public.auth_business_ids()));
--> statement-breakpoint
create policy "products_storage_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'products' and (storage.foldername(name))[1]::uuid = any(public.auth_business_ids()));
--> statement-breakpoint
create policy "products_storage_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'products' and (storage.foldername(name))[1]::uuid = any(public.auth_business_ids()))
  with check (bucket_id = 'products' and (storage.foldername(name))[1]::uuid = any(public.auth_business_ids()));
--> statement-breakpoint
create policy "products_storage_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'products' and (storage.foldername(name))[1]::uuid = any(public.auth_business_ids()));