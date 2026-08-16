CREATE TYPE "public"."movement_type" AS ENUM('purchase', 'sale', 'waste', 'opname_adjust', 'transfer_in', 'transfer_out', 'production_in', 'production_out', 'refund_in', 'initial', 'manual_adjust');--> statement-breakpoint
CREATE TABLE "ingredients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"category" text,
	"base_unit" text NOT NULL,
	"purchase_unit" text NOT NULL,
	"purchase_factor" numeric(20, 8) NOT NULL,
	"yield_percent" numeric(7, 4) DEFAULT '100' NOT NULL,
	"is_semi_finished" boolean DEFAULT false NOT NULL,
	"shelf_life_days" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingredients_business_id_code_unique" UNIQUE("business_id","code")
);
--> statement-breakpoint
ALTER TABLE "ingredients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stock_levels" (
	"business_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"qty_on_hand" numeric(16, 4) DEFAULT '0' NOT NULL,
	"avg_cost" numeric(20, 8) DEFAULT '0' NOT NULL,
	"min_stock" numeric(16, 4) DEFAULT '0' NOT NULL,
	"max_stock" numeric(16, 4),
	"last_counted_at" timestamp with time zone,
	CONSTRAINT "stock_levels_ingredient_id_outlet_id_pk" PRIMARY KEY("ingredient_id","outlet_id")
);
--> statement-breakpoint
ALTER TABLE "stock_levels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"movement_type" "movement_type" NOT NULL,
	"qty" numeric(16, 4) NOT NULL,
	"unit_cost" numeric(20, 8) NOT NULL,
	"total_cost" numeric(20, 2) NOT NULL,
	"balance_after" numeric(16, 4) NOT NULL,
	"avg_cost_after" numeric(20, 8) NOT NULL,
	"ref_type" text,
	"ref_id" uuid,
	"business_date" date NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"base_unit" text NOT NULL,
	"factor" numeric(20, 8) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "units_business_id_code_unique" UNIQUE("business_id","code")
);
--> statement-breakpoint
ALTER TABLE "units" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "outlets" ADD COLUMN "variance_alert_percent" numeric(7, 4) DEFAULT '3' NOT NULL;--> statement-breakpoint
ALTER TABLE "outlets" ADD COLUMN "variance_alert_value" numeric(16, 2) DEFAULT '100000' NOT NULL;--> statement-breakpoint
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_employees_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_movements_outlet_ingredient_idx" ON "stock_movements" USING btree ("outlet_id","ingredient_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_movements_business_date_idx" ON "stock_movements" USING btree ("business_date");--> statement-breakpoint
CREATE INDEX "stock_movements_ref_idx" ON "stock_movements" USING btree ("ref_type","ref_id");--> statement-breakpoint
CREATE POLICY "ingredients_select" ON "ingredients" AS PERMISSIVE FOR SELECT TO public USING ("ingredients"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "ingredients_insert" ON "ingredients" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("ingredients"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "ingredients_update" ON "ingredients" AS PERMISSIVE FOR UPDATE TO public USING ("ingredients"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "stock_levels_select" ON "stock_levels" AS PERMISSIVE FOR SELECT TO public USING ("stock_levels"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "stock_levels_insert" ON "stock_levels" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("stock_levels"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "stock_levels_update" ON "stock_levels" AS PERMISSIVE FOR UPDATE TO public USING ("stock_levels"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "stock_movements_select" ON "stock_movements" AS PERMISSIVE FOR SELECT TO public USING ("stock_movements"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "stock_movements_insert" ON "stock_movements" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("stock_movements"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "units_select" ON "units" AS PERMISSIVE FOR SELECT TO public USING ("units"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "units_insert" ON "units" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("units"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "units_update" ON "units" AS PERMISSIVE FOR UPDATE TO public USING ("units"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "units_delete" ON "units" AS PERMISSIVE FOR DELETE TO public USING ("units"."business_id" = any(auth_business_ids()));--> statement-breakpoint
-- Trigger lintas-tabel: RLS di atas hanya memeriksa business_id milik BARIS
-- ini, bukan bahwa ingredient_id & outlet_id yang direferensikan sungguh
-- milik business_id yang sama. Tanpa ini, satu baris stock_levels/
-- stock_movements bisa memasangkan ingredient bisnis A dengan outlet bisnis
-- B untuk user yang jadi anggota keduanya (auth_business_ids() adalah
-- array) -- saldo stok dua klien bisa tercampur, dan trigger jalan lepas
-- dari RLS jadi tetap menutupi getAdminDb() (BYPASSRLS, CLAUDE.md §3.4)
-- kalau suatu saat dipakai keliru di sini. Ditemukan saat review migration
-- T21, ditulis manual karena tidak bisa diekspresikan di schema.ts
-- (CLAUDE.md §3.6).
CREATE OR REPLACE FUNCTION check_ingredient_outlet_business_id()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  ingredient_business_id uuid;
  outlet_business_id uuid;
BEGIN
  SELECT business_id INTO ingredient_business_id FROM ingredients WHERE id = NEW.ingredient_id;
  IF ingredient_business_id IS NULL OR ingredient_business_id != NEW.business_id THEN
    RAISE EXCEPTION 'business_id % tidak cocok dengan business_id bahan %', NEW.business_id, NEW.ingredient_id;
  END IF;

  SELECT business_id INTO outlet_business_id FROM outlets WHERE id = NEW.outlet_id;
  IF outlet_business_id IS NULL OR outlet_business_id != NEW.business_id THEN
    RAISE EXCEPTION 'business_id % tidak cocok dengan business_id outlet %', NEW.business_id, NEW.outlet_id;
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE TRIGGER stock_levels_check_business_id
BEFORE INSERT OR UPDATE ON stock_levels
FOR EACH ROW EXECUTE FUNCTION check_ingredient_outlet_business_id();--> statement-breakpoint
CREATE OR REPLACE TRIGGER stock_movements_check_business_id
BEFORE INSERT OR UPDATE ON stock_movements
FOR EACH ROW EXECUTE FUNCTION check_ingredient_outlet_business_id();--> statement-breakpoint
COMMENT ON COLUMN "stock_movements"."total_cost" IS 'Presisi (20,2), BUKAN (16,2) seperti nilai transaksi lain -- ini nilai turunan qty(16,4) x unit_cost(20,8), bukan input transaksi langsung, jadi butuh lebih banyak digit agar tidak overflow di movement bervolume besar. Jangan "diperbaiki" balik ke (16,2).';