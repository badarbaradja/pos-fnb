-- Pembatasan akses per outlet, Tahap 5 (13 September 2026, §29) --
-- auth_outlet_ids() BARU, terpisah total dari auth_business_ids() (fungsi
-- itu TIDAK diubah, lihat migrasi 0000). Diberi PARAMETER business_id
-- (BUKAN tanpa argumen seperti auth_business_ids()) -- seorang user bisa
-- punya membership di lebih dari satu bisnis (constraint memberships cuma
-- unique per (business_id, user_id)), dan role/outlet_ids-nya bisa BEDA
-- di tiap bisnis. Fungsi tanpa konteks bisnis tidak bisa tahu NULL
-- (unrestricted) itu milik membership yang mana -- bisa salah menembus ke
-- bisnis lain tempat user itu justru dibatasi. Dipanggil dengan kolom
-- baris itu sendiri (auth_outlet_ids(orders.business_id)), jadi SELALU
-- mengambil membership yang cocok untuk bisnis baris yang sedang diperiksa.
--
-- Harus dibuat SETELAH memberships ada (sudah, sejak 0000) dan SEBELUM
-- policy manapun yang memanggilnya (di bawah).
CREATE OR REPLACE FUNCTION auth_outlet_ids(p_business_id uuid)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    CASE
      WHEN m.role IN ('owner', 'accountant') THEN NULL
      ELSE m.outlet_ids
    END
  FROM memberships m
  WHERE m.user_id = auth.uid()
    AND m.business_id = p_business_id
    AND m.is_active = true
  LIMIT 1
$$;--> statement-breakpoint
ALTER POLICY "orders_select" ON "orders" TO public USING ("orders"."business_id" = any(auth_business_ids()) and (auth_outlet_ids("orders"."business_id") is null or "orders"."outlet_id" = any(auth_outlet_ids("orders"."business_id"))));--> statement-breakpoint
ALTER POLICY "orders_insert" ON "orders" TO public WITH CHECK ("orders"."business_id" = any(auth_business_ids()) and (auth_outlet_ids("orders"."business_id") is null or "orders"."outlet_id" = any(auth_outlet_ids("orders"."business_id"))));--> statement-breakpoint
ALTER POLICY "orders_update" ON "orders" TO public USING ("orders"."business_id" = any(auth_business_ids()) and (auth_outlet_ids("orders"."business_id") is null or "orders"."outlet_id" = any(auth_outlet_ids("orders"."business_id")))) WITH CHECK ("orders"."business_id" = any(auth_business_ids()) and (auth_outlet_ids("orders"."business_id") is null or "orders"."outlet_id" = any(auth_outlet_ids("orders"."business_id"))));
