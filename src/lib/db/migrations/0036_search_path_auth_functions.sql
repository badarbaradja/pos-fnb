-- Utang dicatat §29/§31, dikerjakan sekalian setelah Tahap 5 tutup (13
-- September 2026, §33) -- keraskan search_path KEDUA fungsi RLS helper
-- (auth_business_ids(), dasar setiap policy di 30+ tabel sejak migrasi
-- 0000; auth_outlet_ids(), dasar policy orders/shifts/barang Tahap 5)
-- supaya SECURITY DEFINER tidak bisa dibajak lewat search_path sesi
-- pemanggil. `SET search_path = public` (BUKAN search_path kosong)
-- dipilih supaya body fungsi TIDAK PERLU diubah sama sekali (referensi
-- `memberships` tanpa skema tetap resolve ke public.memberships persis
-- seperti sebelumnya) -- perubahan sekecil mungkin untuk fungsi yang
-- jadi dasar hampir seluruh RLS proyek ini.
--
-- Kill-switch: scripts/rls-rollback-search-path.sql -- diverifikasi
-- jalan sungguhan di dev SEBELUM dan SESUDAH migrasi ini dipasang.
CREATE OR REPLACE FUNCTION public.auth_business_ids()
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
      SELECT COALESCE(ARRAY_AGG(business_id), '{}')
      FROM memberships
      WHERE user_id = auth.uid() AND is_active = true
    $$;

CREATE OR REPLACE FUNCTION public.auth_outlet_ids(p_business_id uuid)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
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
$$;
