CREATE TYPE "public"."barang_status" AS ENUM('baru_masuk', 'siap_jual', 'terjual', 'rusak');--> statement-breakpoint
CREATE TYPE "public"."category_scope" AS ENUM('fnb', 'thrifting');--> statement-breakpoint
CREATE TABLE "barang" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"kode" text NOT NULL,
	"category_id" uuid,
	"nama" text NOT NULL,
	"merek" text,
	"ukuran" text,
	"warna" text,
	"kondisi" text,
	"harga_modal" numeric(16, 2) DEFAULT '0' NOT NULL,
	"harga_jual" numeric(16, 2) NOT NULL,
	"status" "barang_status" DEFAULT 'baru_masuk' NOT NULL,
	"pemilik_id" uuid,
	"image_path" text,
	"masuk_pada" timestamp with time zone DEFAULT now() NOT NULL,
	"terjual_pada" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "barang_business_id_kode_unique" UNIQUE("business_id","kode")
);
--> statement-breakpoint
ALTER TABLE "barang" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "label_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"width_mm" numeric(5, 1) DEFAULT '50' NOT NULL,
	"height_mm" numeric(5, 1) DEFAULT '80' NOT NULL,
	"show_barcode" boolean DEFAULT true NOT NULL,
	"show_name" boolean DEFAULT true NOT NULL,
	"show_price" boolean DEFAULT true NOT NULL,
	"show_pemilik_kode" boolean DEFAULT false NOT NULL,
	"show_ukuran" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "label_settings_business_id_unique" UNIQUE("business_id")
);
--> statement-breakpoint
ALTER TABLE "label_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pemilik" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"kode" text,
	"nama" text NOT NULL,
	"kontak" text,
	"persen_bagi" numeric(5, 2) DEFAULT '60' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"catatan" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pemilik" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "scope" "category_scope" DEFAULT 'fnb' NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "is_shared_account" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "barang_id" uuid;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "pemilik_id" uuid;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "pemilik_bagi_percent_at_sale" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "pemilik_share_amount" numeric(16, 2);--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "toko_share_amount" numeric(16, 2);--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "served_by_name" text;--> statement-breakpoint
ALTER TABLE "barang" ADD CONSTRAINT "barang_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barang" ADD CONSTRAINT "barang_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barang" ADD CONSTRAINT "barang_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barang" ADD CONSTRAINT "barang_pemilik_id_pemilik_id_fk" FOREIGN KEY ("pemilik_id") REFERENCES "public"."pemilik"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_settings" ADD CONSTRAINT "label_settings_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pemilik" ADD CONSTRAINT "pemilik_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_barang_id_barang_id_fk" FOREIGN KEY ("barang_id") REFERENCES "public"."barang"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_pemilik_id_pemilik_id_fk" FOREIGN KEY ("pemilik_id") REFERENCES "public"."pemilik"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "barang_select" ON "barang" AS PERMISSIVE FOR SELECT TO public USING ("barang"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "barang_insert" ON "barang" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("barang"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "barang_update" ON "barang" AS PERMISSIVE FOR UPDATE TO public USING ("barang"."business_id" = any(auth_business_ids())) WITH CHECK ("barang"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "label_settings_select" ON "label_settings" AS PERMISSIVE FOR SELECT TO public USING ("label_settings"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "label_settings_insert" ON "label_settings" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("label_settings"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "label_settings_update" ON "label_settings" AS PERMISSIVE FOR UPDATE TO public USING ("label_settings"."business_id" = any(auth_business_ids())) WITH CHECK ("label_settings"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "pemilik_select" ON "pemilik" AS PERMISSIVE FOR SELECT TO public USING ("pemilik"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "pemilik_insert" ON "pemilik" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("pemilik"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "pemilik_update" ON "pemilik" AS PERMISSIVE FOR UPDATE TO public USING ("pemilik"."business_id" = any(auth_business_ids())) WITH CHECK ("pemilik"."business_id" = any(auth_business_ids()));--> statement-breakpoint
-- TT02 (10 September 2026) -- ditulis manual, tidak bisa diekspresikan di
-- schema.ts (CLAUDE.md §3.6). Mencegah dua kasir menjual barang fisik yang
-- sama nyaris bersamaan: UPDATE ... WHERE status='siap_jual' mengunci
-- barisnya secara alami, transaksi kedua yang mencoba klaim barang yang
-- sama akan menunggu transaksi pertama lalu melihat status sudah 'terjual'
-- (not found) dan gagal dengan pesan jelas -- bukan dua order_items untuk
-- satu barang.
CREATE OR REPLACE FUNCTION claim_barang_for_sale()
RETURNS trigger AS $$
BEGIN
  IF NEW.barang_id IS NOT NULL THEN
    UPDATE barang
    SET status = 'terjual', terjual_pada = now()
    WHERE id = NEW.barang_id AND status = 'siap_jual';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Barang % sudah terjual atau belum siap dijual', NEW.barang_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_claim_barang_for_sale ON order_items;
--> statement-breakpoint
CREATE TRIGGER trg_claim_barang_for_sale
BEFORE INSERT ON order_items
FOR EACH ROW EXECUTE FUNCTION claim_barang_for_sale();