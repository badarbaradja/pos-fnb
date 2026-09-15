CREATE TABLE "recipe_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"qty" numeric(16, 4) NOT NULL,
	"is_optional" boolean DEFAULT false NOT NULL,
	"waste_percent" numeric(7, 4) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recipe_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"product_id" uuid,
	"variant_id" uuid,
	"output_ingredient_id" uuid,
	"output_qty" numeric(16, 4) DEFAULT '1' NOT NULL,
	"overhead_cost" numeric(20, 2) DEFAULT '0' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "recipes_product_or_output_ingredient" CHECK ("recipes"."product_id" is not null or "recipes"."output_ingredient_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "recipes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_output_ingredient_id_ingredients_id_fk" FOREIGN KEY ("output_ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "recipe_items_select" ON "recipe_items" AS PERMISSIVE FOR SELECT TO public USING ("recipe_items"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "recipe_items_insert" ON "recipe_items" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("recipe_items"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "recipe_items_update" ON "recipe_items" AS PERMISSIVE FOR UPDATE TO public USING ("recipe_items"."business_id" = any(auth_business_ids())) WITH CHECK ("recipe_items"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "recipe_items_delete" ON "recipe_items" AS PERMISSIVE FOR DELETE TO public USING ("recipe_items"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "recipes_select" ON "recipes" AS PERMISSIVE FOR SELECT TO public USING ("recipes"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "recipes_insert" ON "recipes" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("recipes"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "recipes_update" ON "recipes" AS PERMISSIVE FOR UPDATE TO public USING ("recipes"."business_id" = any(auth_business_ids())) WITH CHECK ("recipes"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "recipes_delete" ON "recipes" AS PERMISSIVE FOR DELETE TO public USING ("recipes"."business_id" = any(auth_business_ids()));--> statement-breakpoint
-- Trigger lintas-tabel, pola PERSIS sama check_ingredient_outlet_business_id
-- di migration 0017: RLS di atas hanya memeriksa business_id milik BARIS
-- ini, bukan bahwa product_id/variant_id/output_ingredient_id yang
-- direferensikan sungguh milik business_id yang sama. Tanpa ini, satu
-- baris resep bisa memasangkan produk bisnis A dengan business_id bisnis
-- B untuk user yang jadi anggota keduanya (auth_business_ids() adalah
-- array). Langkah B1, 15 September 2026.
CREATE OR REPLACE FUNCTION check_recipe_business_id()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  product_business_id uuid;
  variant_business_id uuid;
  output_ingredient_business_id uuid;
BEGIN
  IF NEW.product_id IS NOT NULL THEN
    SELECT business_id INTO product_business_id FROM products WHERE id = NEW.product_id;
    IF product_business_id IS NULL OR product_business_id != NEW.business_id THEN
      RAISE EXCEPTION 'business_id % tidak cocok dengan business_id produk %', NEW.business_id, NEW.product_id;
    END IF;
  END IF;

  IF NEW.variant_id IS NOT NULL THEN
    SELECT p.business_id INTO variant_business_id
    FROM product_variants v JOIN products p ON p.id = v.product_id
    WHERE v.id = NEW.variant_id;
    IF variant_business_id IS NULL OR variant_business_id != NEW.business_id THEN
      RAISE EXCEPTION 'business_id % tidak cocok dengan business_id varian %', NEW.business_id, NEW.variant_id;
    END IF;
  END IF;

  IF NEW.output_ingredient_id IS NOT NULL THEN
    SELECT business_id INTO output_ingredient_business_id FROM ingredients WHERE id = NEW.output_ingredient_id;
    IF output_ingredient_business_id IS NULL OR output_ingredient_business_id != NEW.business_id THEN
      RAISE EXCEPTION 'business_id % tidak cocok dengan business_id bahan output %', NEW.business_id, NEW.output_ingredient_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE TRIGGER recipes_check_business_id
BEFORE INSERT OR UPDATE ON recipes
FOR EACH ROW EXECUTE FUNCTION check_recipe_business_id();--> statement-breakpoint
CREATE OR REPLACE FUNCTION check_recipe_item_business_id()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  recipe_business_id uuid;
  ingredient_business_id uuid;
BEGIN
  SELECT business_id INTO recipe_business_id FROM recipes WHERE id = NEW.recipe_id;
  IF recipe_business_id IS NULL OR recipe_business_id != NEW.business_id THEN
    RAISE EXCEPTION 'business_id % tidak cocok dengan business_id resep %', NEW.business_id, NEW.recipe_id;
  END IF;

  SELECT business_id INTO ingredient_business_id FROM ingredients WHERE id = NEW.ingredient_id;
  IF ingredient_business_id IS NULL OR ingredient_business_id != NEW.business_id THEN
    RAISE EXCEPTION 'business_id % tidak cocok dengan business_id bahan %', NEW.business_id, NEW.ingredient_id;
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE TRIGGER recipe_items_check_business_id
BEFORE INSERT OR UPDATE ON recipe_items
FOR EACH ROW EXECUTE FUNCTION check_recipe_item_business_id();