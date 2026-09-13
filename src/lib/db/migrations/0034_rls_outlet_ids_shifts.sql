-- Pembatasan akses per outlet, Tahap 5 (13 September 2026, §30) --
-- auth_outlet_ids(business_id) SUDAH ADA (migrasi 0033, dibuat untuk
-- orders) -- dipakai ulang APA ADANYA di sini, TIDAK ADA fungsi SQL baru.
--
-- shifts adalah gerbang identitas kasir: akun yang login di browser
-- tablet POS (bukan kasir yang PIN, employees tidak wajib punya akun
-- auth) yang di-cek auth_outlet_ids()-nya. cash_movements TIDAK diubah
-- di migrasi ini -- policy-nya (EXISTS ke shifts, cek business_id saja)
-- terwarisi otomatis begitu shifts_select diperketat, dibuktikan
-- empiris di src/lib/db/__tests__/rls-shifts-outlet-scope.test.ts.
ALTER POLICY "shifts_select" ON "shifts" TO public USING ("shifts"."business_id" = any(auth_business_ids()) and (auth_outlet_ids("shifts"."business_id") is null or "shifts"."outlet_id" = any(auth_outlet_ids("shifts"."business_id"))));--> statement-breakpoint
ALTER POLICY "shifts_insert" ON "shifts" TO public WITH CHECK ("shifts"."business_id" = any(auth_business_ids()) and (auth_outlet_ids("shifts"."business_id") is null or "shifts"."outlet_id" = any(auth_outlet_ids("shifts"."business_id"))));--> statement-breakpoint
ALTER POLICY "shifts_update" ON "shifts" TO public USING ("shifts"."business_id" = any(auth_business_ids()) and (auth_outlet_ids("shifts"."business_id") is null or "shifts"."outlet_id" = any(auth_outlet_ids("shifts"."business_id")))) WITH CHECK ("shifts"."business_id" = any(auth_business_ids()) and (auth_outlet_ids("shifts"."business_id") is null or "shifts"."outlet_id" = any(auth_outlet_ids("shifts"."business_id"))));
