CREATE POLICY "categories_update" ON "categories" AS PERMISSIVE FOR UPDATE TO public USING ("categories"."business_id" = any(auth_business_ids())) WITH CHECK ("categories"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "modifier_groups_update" ON "modifier_groups" AS PERMISSIVE FOR UPDATE TO public USING ("modifier_groups"."business_id" = any(auth_business_ids())) WITH CHECK ("modifier_groups"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "modifiers_update" ON "modifiers" AS PERMISSIVE FOR UPDATE TO public USING (exists (
        select 1 from modifier_groups mg
        where mg.id = "modifiers"."modifier_group_id"
          and mg.business_id = any(auth_business_ids())
      )) WITH CHECK (exists (
        select 1 from modifier_groups mg
        where mg.id = "modifiers"."modifier_group_id"
          and mg.business_id = any(auth_business_ids())
      ));--> statement-breakpoint
CREATE POLICY "price_tiers_update" ON "price_tiers" AS PERMISSIVE FOR UPDATE TO public USING ("price_tiers"."business_id" = any(auth_business_ids())) WITH CHECK ("price_tiers"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "product_modifier_groups_delete" ON "product_modifier_groups" AS PERMISSIVE FOR DELETE TO public USING (exists (
        select 1 from products p
        where p.id = "product_modifier_groups"."product_id"
          and p.business_id = any(auth_business_ids())
      ));--> statement-breakpoint
CREATE POLICY "product_prices_update" ON "product_prices" AS PERMISSIVE FOR UPDATE TO public USING (exists (
        select 1 from products p
        where p.id = "product_prices"."product_id"
          and p.business_id = any(auth_business_ids())
      )) WITH CHECK (exists (
        select 1 from products p
        where p.id = "product_prices"."product_id"
          and p.business_id = any(auth_business_ids())
      ));--> statement-breakpoint
CREATE POLICY "product_variants_update" ON "product_variants" AS PERMISSIVE FOR UPDATE TO public USING (exists (
        select 1 from products p
        where p.id = "product_variants"."product_id"
          and p.business_id = any(auth_business_ids())
      )) WITH CHECK (exists (
        select 1 from products p
        where p.id = "product_variants"."product_id"
          and p.business_id = any(auth_business_ids())
      ));--> statement-breakpoint
CREATE POLICY "products_update" ON "products" AS PERMISSIVE FOR UPDATE TO public USING ("products"."business_id" = any(auth_business_ids())) WITH CHECK ("products"."business_id" = any(auth_business_ids()));