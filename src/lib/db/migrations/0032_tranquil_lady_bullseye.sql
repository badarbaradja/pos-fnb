CREATE POLICY "memberships_insert" ON "memberships" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("memberships"."business_id" = any(auth_business_ids()) and exists (
        select 1 from memberships owner_row
        where owner_row.business_id = "memberships"."business_id"
          and owner_row.user_id = auth.uid()
          and owner_row.role = 'owner'
          and owner_row.is_active = true
      ));--> statement-breakpoint
CREATE POLICY "memberships_update" ON "memberships" AS PERMISSIVE FOR UPDATE TO public USING ("memberships"."business_id" = any(auth_business_ids()) and exists (
        select 1 from memberships owner_row
        where owner_row.business_id = "memberships"."business_id"
          and owner_row.user_id = auth.uid()
          and owner_row.role = 'owner'
          and owner_row.is_active = true
      )) WITH CHECK ("memberships"."business_id" = any(auth_business_ids()) and exists (
        select 1 from memberships owner_row
        where owner_row.business_id = "memberships"."business_id"
          and owner_row.user_id = auth.uid()
          and owner_row.role = 'owner'
          and owner_row.is_active = true
      ));--> statement-breakpoint
CREATE POLICY "profiles_select_business_owner" ON "profiles" AS PERMISSIVE FOR SELECT TO public USING (exists (
        select 1 from memberships caller
        join memberships target on target.business_id = caller.business_id
        where caller.user_id = auth.uid()
          and caller.role = 'owner'
          and caller.is_active = true
          and target.user_id = "profiles"."id"
      ));