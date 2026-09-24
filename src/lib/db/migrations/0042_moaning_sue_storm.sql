CREATE TABLE "audit_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"reviewed_by" uuid NOT NULL,
	"reviewed_by_name" text NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	CONSTRAINT "audit_reviews_outlet_date_unique" UNIQUE("outlet_id","business_date")
);
--> statement-breakpoint
ALTER TABLE "audit_reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "audit_all_outlets" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_reviews" ADD CONSTRAINT "audit_reviews_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_reviews" ADD CONSTRAINT "audit_reviews_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_reviews" ADD CONSTRAINT "audit_reviews_reviewed_by_profiles_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "audit_reviews_select" ON "audit_reviews" AS PERMISSIVE FOR SELECT TO public USING ("audit_reviews"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "audit_reviews_insert" ON "audit_reviews" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("audit_reviews"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "audit_reviews_update" ON "audit_reviews" AS PERMISSIVE FOR UPDATE TO public USING ("audit_reviews"."business_id" = any(auth_business_ids())) WITH CHECK ("audit_reviews"."business_id" = any(auth_business_ids()));--> statement-breakpoint
-- Halaman Auditor (24 September 2026) -- SATU-SATUNYA jalur baca lintas
-- outlet baru di seluruh sistem. Pola PERSIS sama auth_business_ids()/
-- auth_outlet_ids() (migrasi 0000/0033): LANGUAGE sql STABLE SECURITY
-- DEFINER SET search_path = public, dipanggil lewat koneksi getUserDb()
-- (RLS user biasa) -- BUKAN getAdminDb(). Kolom shifts/orders/payments/
-- outlets TIDAK disentuh, RLS-nya TIDAK diubah sama sekali -- fungsi ini
-- cuma "pintu baru", bukan "kunci lama dicabut".
--
-- auth_can_audit(): true kalau membership caller di bisnis ini adalah
-- owner/akuntan (sudah unrestricted lewat auth_outlet_ids() juga) ATAU
-- audit_all_outlets=true (grant sempit, HANYA dipakai di sini).
CREATE OR REPLACE FUNCTION auth_can_audit(p_business_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.user_id = auth.uid()
      AND m.business_id = p_business_id
      AND m.is_active = true
      AND (m.role IN ('owner', 'accountant') OR m.audit_all_outlets = true)
  )
$$;--> statement-breakpoint
-- audit_shifts_for_business_date() -- satu baris per shift, SEMUA outlet
-- bisnis ini, untuk SATU business_date. Menggabungkan shift + nama outlet
-- + toleransi kas outlet + ringkasan penjualan (join orders/payments
-- SENDIRI di dalam fungsi -- boleh, karena SECURITY DEFINER, tidak lewat
-- RLS user pemanggil untuk join internal ini) -- satu panggilan cukup
-- untuk seluruh bagian Prepare/Closing/Penjualan/Shift-ditandai laporan
-- auditor. Opname (buka/tutup) SENGAJA TIDAK di sini -- stock_opnames/
-- stock_opname_items RLS-nya business-scoped saja (bukan outlet-scoped),
-- jadi dibaca langsung lewat koneksi user biasa, tidak butuh fungsi ini.
-- RAISE EXCEPTION (bukan diam-diam kosong) kalau caller tidak lolos
-- auth_can_audit() -- requireAuditAccess() (lib/audit/access.ts) SUDAH
-- menolak di app layer lebih dulu; ini jaring KEDUA, bukan satu-satunya.
CREATE OR REPLACE FUNCTION audit_shifts_for_business_date(p_business_id uuid, p_business_date date)
RETURNS TABLE (
  shift_id uuid,
  outlet_id uuid,
  outlet_name text,
  employee_name text,
  status text,
  opened_at timestamptz,
  closed_at timestamptz,
  business_date date,
  opening_cash numeric,
  counted_cash numeric,
  expected_cash numeric,
  cash_variance numeric,
  cash_variance_tolerance numeric,
  force_closed_at timestamptz,
  prepare_photo_path text,
  prepare_photo_missing_reason text,
  prepare_has_event boolean,
  prepare_event_note text,
  closing_photo_path text,
  closing_photo_missing_reason text,
  closing_cleanliness_note text,
  sales_order_count integer,
  sales_net_total numeric
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT auth_can_audit(p_business_id) THEN
    RAISE EXCEPTION 'audit_shifts_for_business_date: caller tidak punya izin audit lintas outlet untuk bisnis ini';
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.outlet_id,
    o.name,
    COALESCE(s.served_by_name, e.full_name),
    s.status::text,
    s.opened_at,
    s.closed_at,
    s.business_date,
    s.opening_cash,
    s.counted_cash,
    s.expected_cash,
    s.cash_variance,
    o.cash_variance_tolerance,
    s.force_closed_at,
    s.prepare_photo_path,
    s.prepare_photo_missing_reason,
    s.prepare_has_event,
    s.prepare_event_note,
    s.closing_photo_path,
    s.closing_photo_missing_reason,
    s.closing_cleanliness_note,
    COALESCE(sales.order_count, 0)::integer,
    COALESCE(sales.net_total, 0)::numeric
  FROM shifts s
  JOIN outlets o ON o.id = s.outlet_id
  JOIN employees e ON e.id = s.employee_id
  LEFT JOIN LATERAL (
    SELECT
      COUNT(DISTINCT ord.id) AS order_count,
      SUM(p.amount - p.change_amount) AS net_total
    FROM orders ord
    JOIN payments p ON p.order_id = ord.id
    WHERE ord.shift_id = s.id AND ord.status = 'paid'
  ) sales ON true
  WHERE s.business_id = p_business_id
    AND s.business_date = p_business_date
  ORDER BY o.name, s.opened_at;
END;
$$;