-- Pembatasan akses per outlet, Tahap 5 (13 September 2026, §31) --
-- auth_outlet_ids(business_id) SUDAH ADA (migrasi 0033, dibuat untuk
-- orders) -- dipakai ulang APA ADANYA di sini, TIDAK ADA fungsi SQL baru.
--
-- Tabel TERAKHIR Tahap 5. addBarangFromShiftWithDb ("Ita super kasir")
-- menulis lewat sesi tablet (authenticated) -- sama kelas risiko dengan
-- shifts (migrasi 0034). order_items TIDAK diubah -- policy-nya tidak
-- pernah merujuk barang sama sekali (cuma EXISTS ke orders), dibuktikan
-- empiris tidak terpengaruh di
-- src/lib/db/__tests__/rls-barang-outlet-scope.test.ts.
ALTER POLICY "barang_select" ON "barang" TO public USING ("barang"."business_id" = any(auth_business_ids()) and (auth_outlet_ids("barang"."business_id") is null or "barang"."outlet_id" = any(auth_outlet_ids("barang"."business_id"))));--> statement-breakpoint
ALTER POLICY "barang_insert" ON "barang" TO public WITH CHECK ("barang"."business_id" = any(auth_business_ids()) and (auth_outlet_ids("barang"."business_id") is null or "barang"."outlet_id" = any(auth_outlet_ids("barang"."business_id"))));--> statement-breakpoint
ALTER POLICY "barang_update" ON "barang" TO public USING ("barang"."business_id" = any(auth_business_ids()) and (auth_outlet_ids("barang"."business_id") is null or "barang"."outlet_id" = any(auth_outlet_ids("barang"."business_id")))) WITH CHECK ("barang"."business_id" = any(auth_business_ids()) and (auth_outlet_ids("barang"."business_id") is null or "barang"."outlet_id" = any(auth_outlet_ids("barang"."business_id"))));
