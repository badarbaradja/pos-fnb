CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "brands_business_id_name_unique" UNIQUE("business_id","name")
);
--> statement-breakpoint
ALTER TABLE "brands" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_outlets" (
	"product_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	CONSTRAINT "product_outlets_product_id_outlet_id_pk" PRIMARY KEY("product_id","outlet_id")
);
--> statement-breakpoint
ALTER TABLE "product_outlets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- brand_id NULLABLE dulu (bukan NOT NULL langsung seperti hasil generate
-- drizzle-kit) -- outlets sudah punya baris di produksi (Indokopi), ADD
-- COLUMN ... NOT NULL tanpa default akan gagal total terhadap tabel yang
-- tidak kosong. Diperketat jadi NOT NULL di akhir file ini SETELAH
-- backfill (T22a, docs/05-RENCANA-FASE-2.md §8.a/§8.b).
ALTER TABLE "outlets" ADD COLUMN "brand_id" uuid;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "brand_id" uuid;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_outlets" ADD CONSTRAINT "product_outlets_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_outlets" ADD CONSTRAINT "product_outlets_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outlets" ADD CONSTRAINT "outlets_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "brands_select" ON "brands" AS PERMISSIVE FOR SELECT TO public USING ("brands"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "brands_insert" ON "brands" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("brands"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "brands_update" ON "brands" AS PERMISSIVE FOR UPDATE TO public USING ("brands"."business_id" = any(auth_business_ids())) WITH CHECK ("brands"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "product_outlets_select" ON "product_outlets" AS PERMISSIVE FOR SELECT TO public USING (exists (
        select 1 from products p
        where p.id = "product_outlets"."product_id"
          and p.business_id = any(auth_business_ids())
      ));--> statement-breakpoint
CREATE POLICY "product_outlets_insert" ON "product_outlets" AS PERMISSIVE FOR INSERT TO public WITH CHECK (exists (
        select 1 from products p
        where p.id = "product_outlets"."product_id"
          and p.business_id = any(auth_business_ids())
      ));--> statement-breakpoint
CREATE POLICY "product_outlets_delete" ON "product_outlets" AS PERMISSIVE FOR DELETE TO public USING (exists (
        select 1 from products p
        where p.id = "product_outlets"."product_id"
          and p.business_id = any(auth_business_ids())
      ));--> statement-breakpoint
-- Backfill (T22a) -- satu brand default per business yang belum punya
-- brand sama sekali, dinamai sama seperti nama bisnisnya (pola sama
-- persis scripts/bootstrap-production.ts/seed-demo.ts). IF NOT EXISTS
-- (WHERE NOT EXISTS) supaya idempoten kalau migration ini pernah
-- terpotong di tengah jalan.
INSERT INTO brands (business_id, name)
SELECT b.id, b.name FROM businesses b
WHERE NOT EXISTS (SELECT 1 FROM brands br WHERE br.business_id = b.id);--> statement-breakpoint
UPDATE outlets SET brand_id = (
  SELECT id FROM brands WHERE brands.business_id = outlets.business_id LIMIT 1
) WHERE brand_id IS NULL;--> statement-breakpoint
ALTER TABLE "outlets" ALTER COLUMN "brand_id" SET NOT NULL;--> statement-breakpoint
-- T22a -- pola sama check_ingredient_outlet_business_id (migration 0017)/
-- check_transfer_outlet_business_id (migration 0019): brand_id dan
-- outlet_id/product_id masing-masing punya business_id sendiri, RLS yang
-- cuma memeriksa business_id literal tidak menutup celah memasangkan
-- brand/outlet/produk lintas-bisnis lewat user yang jadi anggota lebih
-- dari satu bisnis (auth_business_ids() array). Ditulis manual karena
-- tidak bisa diekspresikan di schema.ts (CLAUDE.md §3.6).
CREATE OR REPLACE FUNCTION check_outlet_brand_business_id()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  brand_business_id uuid;
BEGIN
  SELECT business_id INTO brand_business_id FROM brands WHERE id = NEW.brand_id;
  IF brand_business_id IS NULL OR brand_business_id != NEW.business_id THEN
    RAISE EXCEPTION 'business_id % tidak cocok dengan business_id brand %', NEW.business_id, NEW.brand_id;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE TRIGGER outlets_check_brand_business_id
BEFORE INSERT OR UPDATE ON outlets
FOR EACH ROW EXECUTE FUNCTION check_outlet_brand_business_id();--> statement-breakpoint
-- products.brand_id NULLABLE (beda dari outlets.brand_id) -- cek cuma
-- jalan kalau brand_id benar-benar diisi, NULL selalu lolos (state valid,
-- §8.b: "tidak dilabeli brand tertentu").
CREATE OR REPLACE FUNCTION check_product_brand_business_id()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  brand_business_id uuid;
BEGIN
  IF NEW.brand_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT business_id INTO brand_business_id FROM brands WHERE id = NEW.brand_id;
  IF brand_business_id IS NULL OR brand_business_id != NEW.business_id THEN
    RAISE EXCEPTION 'business_id % tidak cocok dengan business_id brand %', NEW.business_id, NEW.brand_id;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE TRIGGER products_check_brand_business_id
BEFORE INSERT OR UPDATE ON products
FOR EACH ROW EXECUTE FUNCTION check_product_brand_business_id();--> statement-breakpoint
-- product_outlets TIDAK punya kolom business_id sendiri (murni junction,
-- pola sama product_modifier_groups/product_bundle_items) -- jadi yang
-- dicek di sini BUKAN "cocok dengan business_id baris ini" (tidak ada),
-- tapi business_id product_id dan outlet_id harus SAMA satu sama lain.
CREATE OR REPLACE FUNCTION check_product_outlet_business_id()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  product_business_id uuid;
  outlet_business_id uuid;
BEGIN
  SELECT business_id INTO product_business_id FROM products WHERE id = NEW.product_id;
  SELECT business_id INTO outlet_business_id FROM outlets WHERE id = NEW.outlet_id;
  IF product_business_id IS NULL OR outlet_business_id IS NULL OR product_business_id != outlet_business_id THEN
    RAISE EXCEPTION 'business_id produk % (%) tidak cocok dengan business_id outlet % (%)', NEW.product_id, product_business_id, NEW.outlet_id, outlet_business_id;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE TRIGGER product_outlets_check_business_id
BEFORE INSERT OR UPDATE ON product_outlets
FOR EACH ROW EXECUTE FUNCTION check_product_outlet_business_id();
