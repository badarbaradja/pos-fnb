CREATE TYPE "public"."stock_opname_status" AS ENUM('draft', 'submitted');--> statement-breakpoint
CREATE TABLE "stock_opname_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opname_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"system_qty" numeric(16, 4) DEFAULT '0' NOT NULL,
	"physical_qty" numeric(16, 4),
	"unit_cost" numeric(20, 8) DEFAULT '0' NOT NULL,
	"variance" numeric(16, 4),
	"variance_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_opname_items_opname_id_ingredient_id_unique" UNIQUE("opname_id","ingredient_id")
);
--> statement-breakpoint
ALTER TABLE "stock_opname_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stock_opnames" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"status" "stock_opname_status" DEFAULT 'draft' NOT NULL,
	"business_date" date NOT NULL,
	"label" text,
	"note" text,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_opnames" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_opname_items" ADD CONSTRAINT "stock_opname_items_opname_id_stock_opnames_id_fk" FOREIGN KEY ("opname_id") REFERENCES "public"."stock_opnames"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_opname_items" ADD CONSTRAINT "stock_opname_items_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_opname_items" ADD CONSTRAINT "stock_opname_items_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_opnames" ADD CONSTRAINT "stock_opnames_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_opnames" ADD CONSTRAINT "stock_opnames_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_opnames" ADD CONSTRAINT "stock_opnames_submitted_by_employees_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_opnames" ADD CONSTRAINT "stock_opnames_created_by_employees_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_opnames_outlet_date_idx" ON "stock_opnames" USING btree ("outlet_id","business_date");--> statement-breakpoint
CREATE POLICY "stock_opname_items_select" ON "stock_opname_items" AS PERMISSIVE FOR SELECT TO public USING ("stock_opname_items"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "stock_opname_items_insert" ON "stock_opname_items" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("stock_opname_items"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "stock_opname_items_update" ON "stock_opname_items" AS PERMISSIVE FOR UPDATE TO public USING ("stock_opname_items"."business_id" = any(auth_business_ids())) WITH CHECK ("stock_opname_items"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "stock_opnames_select" ON "stock_opnames" AS PERMISSIVE FOR SELECT TO public USING ("stock_opnames"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "stock_opnames_insert" ON "stock_opnames" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("stock_opnames"."business_id" = any(auth_business_ids()));--> statement-breakpoint
-- FORCE ROW LEVEL SECURITY: mencegah getAdminDb() (BYPASSRLS) menulis
-- baris ke tabel ini tanpa melewati pengecekan tenancy secara tidak sengaja.
-- Pola dari migration 0001/0003/0005 -- tidak bisa diekspresikan di
-- schema.ts, jadi ditulis manual di sini (CLAUDE.md §3.6).
ALTER TABLE "stock_opnames" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_opname_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- Trigger cross-check business_id: pola sama check_ingredient_outlet_business_id
-- (migration 0017) dan check_recipe_item_business_id (migration 0037).
-- RLS memeriksa business_id kolom literal, TIDAK memeriksa bahwa outlet_id /
-- ingredient_id / opname_id yang direferensikan sungguh milik business_id itu.
CREATE OR REPLACE FUNCTION check_opname_business_id()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  outlet_business_id uuid;
BEGIN
  SELECT business_id INTO outlet_business_id FROM outlets WHERE id = NEW.outlet_id;
  IF outlet_business_id IS NULL OR outlet_business_id != NEW.business_id THEN
    RAISE EXCEPTION 'business_id % tidak cocok dengan business_id outlet %', NEW.business_id, NEW.outlet_id;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE TRIGGER stock_opnames_check_business_id
BEFORE INSERT ON stock_opnames
FOR EACH ROW EXECUTE FUNCTION check_opname_business_id();--> statement-breakpoint
CREATE OR REPLACE FUNCTION check_opname_item_business_id()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  opname_business_id uuid;
  ingredient_business_id uuid;
BEGIN
  SELECT business_id INTO opname_business_id FROM stock_opnames WHERE id = NEW.opname_id;
  IF opname_business_id IS NULL OR opname_business_id != NEW.business_id THEN
    RAISE EXCEPTION 'business_id % tidak cocok dengan business_id opname %', NEW.business_id, NEW.opname_id;
  END IF;

  SELECT business_id INTO ingredient_business_id FROM ingredients WHERE id = NEW.ingredient_id;
  IF ingredient_business_id IS NULL OR ingredient_business_id != NEW.business_id THEN
    RAISE EXCEPTION 'business_id % tidak cocok dengan business_id bahan %', NEW.business_id, NEW.ingredient_id;
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE TRIGGER stock_opname_items_check_business_id
BEFORE INSERT ON stock_opname_items
FOR EACH ROW EXECUTE FUNCTION check_opname_item_business_id();