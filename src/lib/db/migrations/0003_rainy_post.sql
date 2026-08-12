CREATE TYPE "public"."product_type" AS ENUM('simple', 'recipe', 'bundle', 'service', 'open_price');--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"parent_id" uuid
);
--> statement-breakpoint
ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "modifier_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"min_select" integer DEFAULT 0 NOT NULL,
	"max_select" integer DEFAULT 1 NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "modifier_groups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "modifiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"modifier_group_id" uuid NOT NULL,
	"name" text NOT NULL,
	"price" numeric(16, 2) DEFAULT '0' NOT NULL,
	"ingredient_id" uuid,
	"ingredient_qty" numeric(16, 4),
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "modifiers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "price_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"channel" text,
	"markup_percent" numeric(7, 4) DEFAULT '0',
	"is_default" boolean DEFAULT false NOT NULL,
	CONSTRAINT "price_tiers_business_id_code_unique" UNIQUE("business_id","code")
);
--> statement-breakpoint
ALTER TABLE "price_tiers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_bundle_items" (
	"bundle_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"qty" numeric(16, 4) DEFAULT '1' NOT NULL,
	CONSTRAINT "product_bundle_items_bundle_id_product_id_variant_id_pk" PRIMARY KEY("bundle_id","product_id","variant_id")
);
--> statement-breakpoint
ALTER TABLE "product_bundle_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_modifier_groups" (
	"product_id" uuid NOT NULL,
	"modifier_group_id" uuid NOT NULL,
	CONSTRAINT "product_modifier_groups_product_id_modifier_group_id_pk" PRIMARY KEY("product_id","modifier_group_id")
);
--> statement-breakpoint
ALTER TABLE "product_modifier_groups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"price_tier_id" uuid NOT NULL,
	"outlet_id" uuid,
	"price" numeric(16, 2) NOT NULL,
	"valid_from" date,
	"valid_to" date,
	CONSTRAINT "product_prices_product_id_variant_id_price_tier_id_outlet_id_valid_from_unique" UNIQUE NULLS NOT DISTINCT("product_id","variant_id","price_tier_id","outlet_id","valid_from")
);
--> statement-breakpoint
ALTER TABLE "product_prices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sku" text,
	"price_delta" numeric(16, 2) DEFAULT '0' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_variants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"category_id" uuid,
	"sku" text,
	"barcode" text,
	"name" text NOT NULL,
	"description" text,
	"image_url" text,
	"product_type" "product_type" DEFAULT 'recipe' NOT NULL,
	"track_stock" boolean DEFAULT true NOT NULL,
	"is_favorite" boolean DEFAULT false NOT NULL,
	"is_taxable" boolean DEFAULT true NOT NULL,
	"prep_station" text,
	"prep_minutes" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modifier_groups" ADD CONSTRAINT "modifier_groups_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modifiers" ADD CONSTRAINT "modifiers_modifier_group_id_modifier_groups_id_fk" FOREIGN KEY ("modifier_group_id") REFERENCES "public"."modifier_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_tiers" ADD CONSTRAINT "price_tiers_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_bundle_items" ADD CONSTRAINT "product_bundle_items_bundle_id_products_id_fk" FOREIGN KEY ("bundle_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_bundle_items" ADD CONSTRAINT "product_bundle_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_bundle_items" ADD CONSTRAINT "product_bundle_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_modifier_groups" ADD CONSTRAINT "product_modifier_groups_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_modifier_groups" ADD CONSTRAINT "product_modifier_groups_modifier_group_id_modifier_groups_id_fk" FOREIGN KEY ("modifier_group_id") REFERENCES "public"."modifier_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_price_tier_id_price_tiers_id_fk" FOREIGN KEY ("price_tier_id") REFERENCES "public"."price_tiers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "categories_select" ON "categories" AS PERMISSIVE FOR SELECT TO public USING ("categories"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "categories_insert" ON "categories" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("categories"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "modifier_groups_select" ON "modifier_groups" AS PERMISSIVE FOR SELECT TO public USING ("modifier_groups"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "modifier_groups_insert" ON "modifier_groups" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("modifier_groups"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "modifiers_select" ON "modifiers" AS PERMISSIVE FOR SELECT TO public USING (exists (
        select 1 from modifier_groups mg
        where mg.id = "modifiers"."modifier_group_id"
          and mg.business_id = any(auth_business_ids())
      ));--> statement-breakpoint
CREATE POLICY "modifiers_insert" ON "modifiers" AS PERMISSIVE FOR INSERT TO public WITH CHECK (exists (
        select 1 from modifier_groups mg
        where mg.id = "modifiers"."modifier_group_id"
          and mg.business_id = any(auth_business_ids())
      ));--> statement-breakpoint
CREATE POLICY "price_tiers_select" ON "price_tiers" AS PERMISSIVE FOR SELECT TO public USING ("price_tiers"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "price_tiers_insert" ON "price_tiers" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("price_tiers"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "product_bundle_items_select" ON "product_bundle_items" AS PERMISSIVE FOR SELECT TO public USING (exists (
        select 1 from products p
        where p.id = "product_bundle_items"."bundle_id"
          and p.business_id = any(auth_business_ids())
      ));--> statement-breakpoint
CREATE POLICY "product_bundle_items_insert" ON "product_bundle_items" AS PERMISSIVE FOR INSERT TO public WITH CHECK (exists (
        select 1 from products p
        where p.id = "product_bundle_items"."bundle_id"
          and p.business_id = any(auth_business_ids())
      ));--> statement-breakpoint
CREATE POLICY "product_modifier_groups_select" ON "product_modifier_groups" AS PERMISSIVE FOR SELECT TO public USING (exists (
        select 1 from products p
        where p.id = "product_modifier_groups"."product_id"
          and p.business_id = any(auth_business_ids())
      ));--> statement-breakpoint
CREATE POLICY "product_modifier_groups_insert" ON "product_modifier_groups" AS PERMISSIVE FOR INSERT TO public WITH CHECK (exists (
        select 1 from products p
        where p.id = "product_modifier_groups"."product_id"
          and p.business_id = any(auth_business_ids())
      ));--> statement-breakpoint
CREATE POLICY "product_prices_select" ON "product_prices" AS PERMISSIVE FOR SELECT TO public USING (exists (
        select 1 from products p
        where p.id = "product_prices"."product_id"
          and p.business_id = any(auth_business_ids())
      ));--> statement-breakpoint
CREATE POLICY "product_prices_insert" ON "product_prices" AS PERMISSIVE FOR INSERT TO public WITH CHECK (exists (
        select 1 from products p
        where p.id = "product_prices"."product_id"
          and p.business_id = any(auth_business_ids())
      ));--> statement-breakpoint
CREATE POLICY "product_variants_select" ON "product_variants" AS PERMISSIVE FOR SELECT TO public USING (exists (
        select 1 from products p
        where p.id = "product_variants"."product_id"
          and p.business_id = any(auth_business_ids())
      ));--> statement-breakpoint
CREATE POLICY "product_variants_insert" ON "product_variants" AS PERMISSIVE FOR INSERT TO public WITH CHECK (exists (
        select 1 from products p
        where p.id = "product_variants"."product_id"
          and p.business_id = any(auth_business_ids())
      ));--> statement-breakpoint
CREATE POLICY "products_select" ON "products" AS PERMISSIVE FOR SELECT TO public USING ("products"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "products_insert" ON "products" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("products"."business_id" = any(auth_business_ids()));--> statement-breakpoint
-- T08: FORCE ROW LEVEL SECURITY -- Drizzle tidak punya builder untuk ini
-- (sama seperti T07 migration 0001). Tanpa ini, role "postgres" (pemilik
-- tabel, dipakai getAdminDb()/DATABASE_URL) tetap kena atribut BYPASSRLS-nya
-- sendiri regardless (lihat docs/04-CATATAN-TEKNIS.md #2) -- FORCE di sini
-- tetap dipasang untuk menutup celah bypass-karena-kepemilikan-tabel pada
-- role LAIN yang bukan postgres, konsisten dengan kebijakan semua tabel.
ALTER TABLE "categories" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "products" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_variants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "price_tiers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_prices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "modifier_groups" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "modifiers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_modifier_groups" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_bundle_items" FORCE ROW LEVEL SECURITY;