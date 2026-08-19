ALTER TYPE "public"."movement_type" ADD VALUE 'transfer_cancel';--> statement-breakpoint
CREATE TABLE "stock_transfer_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transfer_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"entered_unit" text NOT NULL,
	"entered_qty" numeric(16, 4) NOT NULL,
	"entered_unit_cost" numeric(20, 8) NOT NULL,
	"qty" numeric(16, 4) NOT NULL,
	"unit_cost" numeric(20, 8) NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_transfer_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stock_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"from_outlet_id" uuid NOT NULL,
	"to_outlet_id" uuid NOT NULL,
	"number" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"sent_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	"received_by" uuid,
	"cancel_reason" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_transfers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_transfer_id_stock_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."stock_transfers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_created_by_employees_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_from_outlet_id_outlets_id_fk" FOREIGN KEY ("from_outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_to_outlet_id_outlets_id_fk" FOREIGN KEY ("to_outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_received_by_employees_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_cancelled_by_employees_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "stock_transfer_items_select" ON "stock_transfer_items" AS PERMISSIVE FOR SELECT TO public USING ("stock_transfer_items"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "stock_transfer_items_insert" ON "stock_transfer_items" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("stock_transfer_items"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "stock_transfers_select" ON "stock_transfers" AS PERMISSIVE FOR SELECT TO public USING ("stock_transfers"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "stock_transfers_insert" ON "stock_transfers" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("stock_transfers"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "stock_transfers_update" ON "stock_transfers" AS PERMISSIVE FOR UPDATE TO public USING ("stock_transfers"."business_id" = any(auth_business_ids()) and "stock_transfers"."status" = 'received') WITH CHECK ("stock_transfers"."business_id" = any(auth_business_ids()));--> statement-breakpoint
-- T22 -- pola sama check_ingredient_outlet_business_id (migration 0017):
-- stock_transfers punya DUA FK ke outlets (from/to), stock_transfer_items
-- punya business_id + ingredient_id. RLS yang cuma memeriksa business_id
-- literal tidak menutup celah user anggota lebih dari satu bisnis
-- (auth_business_ids() array) memasangkan baris lintas-bisnis. Ditulis
-- manual karena tidak bisa diekspresikan di schema.ts (CLAUDE.md §3.6).
CREATE OR REPLACE FUNCTION check_transfer_outlet_business_id()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  from_business_id uuid;
  to_business_id uuid;
BEGIN
  SELECT business_id INTO from_business_id FROM outlets WHERE id = NEW.from_outlet_id;
  IF from_business_id IS NULL OR from_business_id != NEW.business_id THEN
    RAISE EXCEPTION 'business_id % tidak cocok dengan business_id from_outlet %', NEW.business_id, NEW.from_outlet_id;
  END IF;

  SELECT business_id INTO to_business_id FROM outlets WHERE id = NEW.to_outlet_id;
  IF to_business_id IS NULL OR to_business_id != NEW.business_id THEN
    RAISE EXCEPTION 'business_id % tidak cocok dengan business_id to_outlet %', NEW.business_id, NEW.to_outlet_id;
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE TRIGGER stock_transfers_check_business_id
BEFORE INSERT OR UPDATE ON stock_transfers
FOR EACH ROW EXECUTE FUNCTION check_transfer_outlet_business_id();--> statement-breakpoint
-- Dua lapis: ingredient_id vs business_id (sama pola tabel lain) DITAMBAH
-- transfer_id vs business_id -- karena business_id di tabel ini murni
-- denormalisasi dari header (stock_transfers), bukan sumber independen.
-- Tanpa cek kedua ini, kode aplikasi yang keliru menulis business_id item
-- beda dari business_id transfer induknya akan lolos tanpa error.
CREATE OR REPLACE FUNCTION check_transfer_item_business_id()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  ingredient_business_id uuid;
  transfer_business_id uuid;
BEGIN
  SELECT business_id INTO ingredient_business_id FROM ingredients WHERE id = NEW.ingredient_id;
  IF ingredient_business_id IS NULL OR ingredient_business_id != NEW.business_id THEN
    RAISE EXCEPTION 'business_id % tidak cocok dengan business_id bahan %', NEW.business_id, NEW.ingredient_id;
  END IF;

  SELECT business_id INTO transfer_business_id FROM stock_transfers WHERE id = NEW.transfer_id;
  IF transfer_business_id IS NULL OR transfer_business_id != NEW.business_id THEN
    RAISE EXCEPTION 'business_id % tidak cocok dengan business_id transfer induk %', NEW.business_id, NEW.transfer_id;
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE TRIGGER stock_transfer_items_check_business_id
BEFORE INSERT OR UPDATE ON stock_transfer_items
FOR EACH ROW EXECUTE FUNCTION check_transfer_item_business_id();--> statement-breakpoint
-- Menegakkan "cuma kolom pembatalan yang boleh berubah" -- RLS USING/WITH
-- CHECK tidak bisa membandingkan NEW vs OLD untuk kolom arbitrer (lihat
-- komentar policy stock_transfers_update di schema.ts). Trigger ini yang
-- menutup celahnya: kalau ada kolom LAIN yang ikut berubah dalam UPDATE
-- yang sama, ditolak jelas -- bukan diam-diam lolos lewat RLS yang cuma
-- memeriksa business_id/status.
CREATE OR REPLACE FUNCTION check_stock_transfer_cancel_only()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.business_id != OLD.business_id
     OR NEW.from_outlet_id != OLD.from_outlet_id
     OR NEW.to_outlet_id != OLD.to_outlet_id
     OR NEW.number != OLD.number
     OR NEW.sent_at IS DISTINCT FROM OLD.sent_at
     OR NEW.received_at != OLD.received_at
     OR NEW.note IS DISTINCT FROM OLD.note
     OR NEW.received_by IS DISTINCT FROM OLD.received_by
     OR NEW.created_at != OLD.created_at
  THEN
    RAISE EXCEPTION 'Penerimaan barang tidak bisa diubah setelah dibuat -- cuma status pembatalan (status/cancel_reason/cancelled_at/cancelled_by) yang boleh berubah, koreksi = pembatalan baru bukan edit di tempat';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE TRIGGER stock_transfers_cancel_only
BEFORE UPDATE ON stock_transfers
FOR EACH ROW EXECUTE FUNCTION check_stock_transfer_cancel_only();