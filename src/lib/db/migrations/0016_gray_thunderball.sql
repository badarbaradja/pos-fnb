CREATE POLICY "categories_delete" ON "categories" AS PERMISSIVE FOR DELETE TO public USING ("categories"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "modifier_groups_delete" ON "modifier_groups" AS PERMISSIVE FOR DELETE TO public USING ("modifier_groups"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "modifiers_delete" ON "modifiers" AS PERMISSIVE FOR DELETE TO public USING (exists (
        select 1 from modifier_groups mg
        where mg.id = "modifiers"."modifier_group_id"
          and mg.business_id = any(auth_business_ids())
      ));--> statement-breakpoint
CREATE POLICY "payment_methods_delete" ON "payment_methods" AS PERMISSIVE FOR DELETE TO public USING ("payment_methods"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "price_tiers_delete" ON "price_tiers" AS PERMISSIVE FOR DELETE TO public USING ("price_tiers"."business_id" = any(auth_business_ids()));