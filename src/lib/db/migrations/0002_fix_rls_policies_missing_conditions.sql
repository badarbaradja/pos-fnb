-- T07: perbaikan korektif. `drizzle-kit push` (dipakai sebelum dilarang di
-- CLAUDE.md §3.6) terbukti menerapkan CREATE POLICY tanpa klausa USING/WITH
-- CHECK-nya ke database sungguhan -- ditemukan lewat query pg_policies
-- (qual dan with_check NULL di semua 10 policy, padahal migration 0000.sql
-- di bawah ini sudah benar sejak awal). Policy ada, tapi tidak membatasi
-- apa pun.
--
-- Migration ini idempoten: DROP POLICY IF EXISTS lalu CREATE POLICY ulang
-- persis sesuai definisi asli di 0000_clumsy_sleeper.sql. Di database yang
-- SELALU dibangun lewat db:migrate (tidak pernah tersentuh push) -- misalnya
-- production nanti -- migration ini efeknya no-op: policy dihapus lalu
-- dibuat ulang dengan kondisi yang SAMA seperti yang sudah benar dari
-- migration 0000.

DROP POLICY IF EXISTS "businesses_select" ON "businesses";--> statement-breakpoint
DROP POLICY IF EXISTS "devices_select" ON "devices";--> statement-breakpoint
DROP POLICY IF EXISTS "devices_insert" ON "devices";--> statement-breakpoint
DROP POLICY IF EXISTS "employees_select" ON "employees";--> statement-breakpoint
DROP POLICY IF EXISTS "employees_insert" ON "employees";--> statement-breakpoint
DROP POLICY IF EXISTS "memberships_select" ON "memberships";--> statement-breakpoint
DROP POLICY IF EXISTS "outlets_select" ON "outlets";--> statement-breakpoint
DROP POLICY IF EXISTS "outlets_insert" ON "outlets";--> statement-breakpoint
DROP POLICY IF EXISTS "permissions_override_select" ON "permissions_override";--> statement-breakpoint
DROP POLICY IF EXISTS "profiles_select_own" ON "profiles";--> statement-breakpoint

CREATE POLICY "businesses_select" ON "businesses" AS PERMISSIVE FOR SELECT TO public USING ("businesses"."id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "devices_select" ON "devices" AS PERMISSIVE FOR SELECT TO public USING ("devices"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "devices_insert" ON "devices" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("devices"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "employees_select" ON "employees" AS PERMISSIVE FOR SELECT TO public USING ("employees"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "employees_insert" ON "employees" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("employees"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "memberships_select" ON "memberships" AS PERMISSIVE FOR SELECT TO public USING ("memberships"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "outlets_select" ON "outlets" AS PERMISSIVE FOR SELECT TO public USING ("outlets"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "outlets_insert" ON "outlets" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("outlets"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "permissions_override_select" ON "permissions_override" AS PERMISSIVE FOR SELECT TO public USING (exists (
        select 1 from employees e
        where e.id = "permissions_override"."employee_id"
          and e.business_id = any(auth_business_ids())
      ));--> statement-breakpoint
CREATE POLICY "profiles_select_own" ON "profiles" AS PERMISSIVE FOR SELECT TO public USING ("profiles"."id" = auth.uid());
