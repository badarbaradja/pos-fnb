CREATE TYPE "public"."order_channel" AS ENUM('dine_in', 'takeaway', 'delivery', 'gofood', 'grabfood', 'shopeefood', 'online_store', 'reservation');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('draft', 'open', 'in_kitchen', 'served', 'paid', 'void', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."shift_status" AS ENUM('open', 'closed', 'reconciled');--> statement-breakpoint
CREATE TABLE "areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "areas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cash_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shift_id" uuid NOT NULL,
	"type" text NOT NULL,
	"amount" numeric(16, 2) NOT NULL,
	"reason" text NOT NULL,
	"expense_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cash_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "order_item_modifiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_item_id" uuid NOT NULL,
	"modifier_id" uuid,
	"modifier_name" text NOT NULL,
	"price" numeric(16, 2) DEFAULT '0' NOT NULL,
	"qty" numeric(16, 4) DEFAULT '1' NOT NULL,
	"unit_cogs" numeric(20, 8) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_item_modifiers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid,
	"variant_id" uuid,
	"product_name" text NOT NULL,
	"variant_name" text,
	"category_name" text,
	"qty" numeric(16, 4) NOT NULL,
	"unit_price" numeric(16, 2) NOT NULL,
	"modifier_total" numeric(16, 2) DEFAULT '0' NOT NULL,
	"gross_amount" numeric(16, 2) NOT NULL,
	"discount_amount" numeric(16, 2) DEFAULT '0' NOT NULL,
	"allocated_order_discount" numeric(16, 2) DEFAULT '0' NOT NULL,
	"net_amount" numeric(16, 2) NOT NULL,
	"unit_cogs" numeric(20, 8) DEFAULT '0' NOT NULL,
	"cogs_amount" numeric(20, 2) DEFAULT '0' NOT NULL,
	"prep_station" text,
	"kitchen_status" text DEFAULT 'pending' NOT NULL,
	"is_voided" boolean DEFAULT false NOT NULL,
	"void_reason" text,
	"note" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"shift_id" uuid,
	"device_id" uuid,
	"number" text NOT NULL,
	"status" "order_status" DEFAULT 'draft' NOT NULL,
	"channel" "order_channel" DEFAULT 'dine_in' NOT NULL,
	"price_tier_id" uuid,
	"table_id" uuid,
	"customer_id" uuid,
	"guest_count" integer DEFAULT 1 NOT NULL,
	"waiter_id" uuid,
	"cashier_id" uuid,
	"subtotal" numeric(16, 2) DEFAULT '0' NOT NULL,
	"item_discount" numeric(16, 2) DEFAULT '0' NOT NULL,
	"order_discount" numeric(16, 2) DEFAULT '0' NOT NULL,
	"discount_total" numeric(16, 2) DEFAULT '0' NOT NULL,
	"net_sales" numeric(16, 2) DEFAULT '0' NOT NULL,
	"service_charge" numeric(16, 2) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(16, 2) DEFAULT '0' NOT NULL,
	"rounding" numeric(16, 2) DEFAULT '0' NOT NULL,
	"total" numeric(16, 2) DEFAULT '0' NOT NULL,
	"cogs_total" numeric(20, 2) DEFAULT '0' NOT NULL,
	"gross_profit" numeric(20, 2) DEFAULT '0' NOT NULL,
	"commission_percent" numeric(7, 4) DEFAULT '0' NOT NULL,
	"commission_amount" numeric(16, 2) DEFAULT '0' NOT NULL,
	"external_ref" text,
	"business_date" date NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	"void_reason" text,
	"note" text,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_business_id_number_unique" UNIQUE("business_id","number")
);
--> statement-breakpoint
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payment_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"mdr_percent" numeric(7, 4) DEFAULT '0' NOT NULL,
	"is_cash_drawer" boolean DEFAULT false NOT NULL,
	"requires_ref" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_methods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"payment_method_id" uuid NOT NULL,
	"method_name" text NOT NULL,
	"amount" numeric(16, 2) NOT NULL,
	"received_amount" numeric(16, 2),
	"change_amount" numeric(16, 2) DEFAULT '0' NOT NULL,
	"mdr_amount" numeric(16, 2) DEFAULT '0' NOT NULL,
	"reference" text,
	"status" text DEFAULT 'success' NOT NULL,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "refund_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"refund_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"qty" numeric(16, 4) NOT NULL,
	"amount" numeric(16, 2) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "refund_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"amount" numeric(16, 2) NOT NULL,
	"restock" boolean DEFAULT false NOT NULL,
	"reason" text NOT NULL,
	"approved_by" uuid,
	"business_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "refunds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"device_id" uuid,
	"employee_id" uuid NOT NULL,
	"status" "shift_status" DEFAULT 'open' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"business_date" date NOT NULL,
	"opening_cash" numeric(16, 2) DEFAULT '0' NOT NULL,
	"counted_cash" numeric(16, 2),
	"expected_cash" numeric(16, 2),
	"cash_variance" numeric(16, 2),
	"note" text
);
--> statement-breakpoint
ALTER TABLE "shifts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"area_id" uuid,
	"name" text NOT NULL,
	"capacity" integer DEFAULT 4 NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"pos_x" integer,
	"pos_y" integer
);
--> statement-breakpoint
ALTER TABLE "tables" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item_modifiers" ADD CONSTRAINT "order_item_modifiers_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item_modifiers" ADD CONSTRAINT "order_item_modifiers_modifier_id_modifiers_id_fk" FOREIGN KEY ("modifier_id") REFERENCES "public"."modifiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_price_tier_id_price_tiers_id_fk" FOREIGN KEY ("price_tier_id") REFERENCES "public"."price_tiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_table_id_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."tables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_waiter_id_employees_id_fk" FOREIGN KEY ("waiter_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_cashier_id_employees_id_fk" FOREIGN KEY ("cashier_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_payment_method_id_payment_methods_id_fk" FOREIGN KEY ("payment_method_id") REFERENCES "public"."payment_methods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_items" ADD CONSTRAINT "refund_items_refund_id_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refunds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_items" ADD CONSTRAINT "refund_items_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_approved_by_employees_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tables" ADD CONSTRAINT "tables_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tables" ADD CONSTRAINT "tables_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_outlet_business_date_idx" ON "orders" USING btree ("outlet_id","business_date");--> statement-breakpoint
CREATE INDEX "orders_active_status_idx" ON "orders" USING btree ("status") WHERE "orders"."status" in ('draft', 'open', 'in_kitchen');--> statement-breakpoint
CREATE POLICY "areas_select" ON "areas" AS PERMISSIVE FOR SELECT TO public USING (exists (
        select 1 from outlets o
        where o.id = "areas"."outlet_id"
          and o.business_id = any(auth_business_ids())
      ));--> statement-breakpoint
CREATE POLICY "areas_insert" ON "areas" AS PERMISSIVE FOR INSERT TO public WITH CHECK (exists (
        select 1 from outlets o
        where o.id = "areas"."outlet_id"
          and o.business_id = any(auth_business_ids())
      ));--> statement-breakpoint
CREATE POLICY "areas_update" ON "areas" AS PERMISSIVE FOR UPDATE TO public USING (exists (
        select 1 from outlets o
        where o.id = "areas"."outlet_id"
          and o.business_id = any(auth_business_ids())
      )) WITH CHECK (exists (
        select 1 from outlets o
        where o.id = "areas"."outlet_id"
          and o.business_id = any(auth_business_ids())
      ));--> statement-breakpoint
CREATE POLICY "cash_movements_select" ON "cash_movements" AS PERMISSIVE FOR SELECT TO public USING (exists (
        select 1 from shifts s
        where s.id = "cash_movements"."shift_id"
          and s.business_id = any(auth_business_ids())
      ));--> statement-breakpoint
CREATE POLICY "cash_movements_insert" ON "cash_movements" AS PERMISSIVE FOR INSERT TO public WITH CHECK (exists (
        select 1 from shifts s
        where s.id = "cash_movements"."shift_id"
          and s.business_id = any(auth_business_ids())
      ));--> statement-breakpoint
CREATE POLICY "cash_movements_update" ON "cash_movements" AS PERMISSIVE FOR UPDATE TO public USING (exists (
        select 1 from shifts s
        where s.id = "cash_movements"."shift_id"
          and s.business_id = any(auth_business_ids())
      )) WITH CHECK (exists (
        select 1 from shifts s
        where s.id = "cash_movements"."shift_id"
          and s.business_id = any(auth_business_ids())
      ));--> statement-breakpoint
CREATE POLICY "order_item_modifiers_select" ON "order_item_modifiers" AS PERMISSIVE FOR SELECT TO public USING (exists (
        select 1 from order_items oi
        join orders o on o.id = oi.order_id
        where oi.id = "order_item_modifiers"."order_item_id"
          and o.business_id = any(auth_business_ids())
      ));--> statement-breakpoint
CREATE POLICY "order_item_modifiers_insert" ON "order_item_modifiers" AS PERMISSIVE FOR INSERT TO public WITH CHECK (exists (
        select 1 from order_items oi
        join orders o on o.id = oi.order_id
        where oi.id = "order_item_modifiers"."order_item_id"
          and o.business_id = any(auth_business_ids())
      ));--> statement-breakpoint
CREATE POLICY "order_item_modifiers_update" ON "order_item_modifiers" AS PERMISSIVE FOR UPDATE TO public USING (exists (
        select 1 from order_items oi
        join orders o on o.id = oi.order_id
        where oi.id = "order_item_modifiers"."order_item_id"
          and o.business_id = any(auth_business_ids())
      )) WITH CHECK (exists (
        select 1 from order_items oi
        join orders o on o.id = oi.order_id
        where oi.id = "order_item_modifiers"."order_item_id"
          and o.business_id = any(auth_business_ids())
      ));--> statement-breakpoint
CREATE POLICY "order_items_select" ON "order_items" AS PERMISSIVE FOR SELECT TO public USING (exists (
        select 1 from orders o
        where o.id = "order_items"."order_id"
          and o.business_id = any(auth_business_ids())
      ));--> statement-breakpoint
CREATE POLICY "order_items_insert" ON "order_items" AS PERMISSIVE FOR INSERT TO public WITH CHECK (exists (
        select 1 from orders o
        where o.id = "order_items"."order_id"
          and o.business_id = any(auth_business_ids())
      ));--> statement-breakpoint
CREATE POLICY "order_items_update" ON "order_items" AS PERMISSIVE FOR UPDATE TO public USING (exists (
        select 1 from orders o
        where o.id = "order_items"."order_id"
          and o.business_id = any(auth_business_ids())
      )) WITH CHECK (exists (
        select 1 from orders o
        where o.id = "order_items"."order_id"
          and o.business_id = any(auth_business_ids())
      ));--> statement-breakpoint
CREATE POLICY "orders_select" ON "orders" AS PERMISSIVE FOR SELECT TO public USING ("orders"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "orders_insert" ON "orders" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("orders"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "orders_update" ON "orders" AS PERMISSIVE FOR UPDATE TO public USING ("orders"."business_id" = any(auth_business_ids())) WITH CHECK ("orders"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "payment_methods_select" ON "payment_methods" AS PERMISSIVE FOR SELECT TO public USING ("payment_methods"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "payment_methods_insert" ON "payment_methods" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("payment_methods"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "payment_methods_update" ON "payment_methods" AS PERMISSIVE FOR UPDATE TO public USING ("payment_methods"."business_id" = any(auth_business_ids())) WITH CHECK ("payment_methods"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "payments_select" ON "payments" AS PERMISSIVE FOR SELECT TO public USING (exists (
        select 1 from orders o
        where o.id = "payments"."order_id"
          and o.business_id = any(auth_business_ids())
      ));--> statement-breakpoint
CREATE POLICY "payments_insert" ON "payments" AS PERMISSIVE FOR INSERT TO public WITH CHECK (exists (
        select 1 from orders o
        where o.id = "payments"."order_id"
          and o.business_id = any(auth_business_ids())
      ));--> statement-breakpoint
CREATE POLICY "payments_update" ON "payments" AS PERMISSIVE FOR UPDATE TO public USING (exists (
        select 1 from orders o
        where o.id = "payments"."order_id"
          and o.business_id = any(auth_business_ids())
      )) WITH CHECK (exists (
        select 1 from orders o
        where o.id = "payments"."order_id"
          and o.business_id = any(auth_business_ids())
      ));--> statement-breakpoint
CREATE POLICY "refund_items_select" ON "refund_items" AS PERMISSIVE FOR SELECT TO public USING (exists (
        select 1 from refunds r
        join orders o on o.id = r.order_id
        where r.id = "refund_items"."refund_id"
          and o.business_id = any(auth_business_ids())
      ));--> statement-breakpoint
CREATE POLICY "refund_items_insert" ON "refund_items" AS PERMISSIVE FOR INSERT TO public WITH CHECK (exists (
        select 1 from refunds r
        join orders o on o.id = r.order_id
        where r.id = "refund_items"."refund_id"
          and o.business_id = any(auth_business_ids())
      ));--> statement-breakpoint
CREATE POLICY "refund_items_update" ON "refund_items" AS PERMISSIVE FOR UPDATE TO public USING (exists (
        select 1 from refunds r
        join orders o on o.id = r.order_id
        where r.id = "refund_items"."refund_id"
          and o.business_id = any(auth_business_ids())
      )) WITH CHECK (exists (
        select 1 from refunds r
        join orders o on o.id = r.order_id
        where r.id = "refund_items"."refund_id"
          and o.business_id = any(auth_business_ids())
      ));--> statement-breakpoint
CREATE POLICY "refunds_select" ON "refunds" AS PERMISSIVE FOR SELECT TO public USING (exists (
        select 1 from orders o
        where o.id = "refunds"."order_id"
          and o.business_id = any(auth_business_ids())
      ));--> statement-breakpoint
CREATE POLICY "refunds_insert" ON "refunds" AS PERMISSIVE FOR INSERT TO public WITH CHECK (exists (
        select 1 from orders o
        where o.id = "refunds"."order_id"
          and o.business_id = any(auth_business_ids())
      ));--> statement-breakpoint
CREATE POLICY "refunds_update" ON "refunds" AS PERMISSIVE FOR UPDATE TO public USING (exists (
        select 1 from orders o
        where o.id = "refunds"."order_id"
          and o.business_id = any(auth_business_ids())
      )) WITH CHECK (exists (
        select 1 from orders o
        where o.id = "refunds"."order_id"
          and o.business_id = any(auth_business_ids())
      ));--> statement-breakpoint
CREATE POLICY "shifts_select" ON "shifts" AS PERMISSIVE FOR SELECT TO public USING ("shifts"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "shifts_insert" ON "shifts" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("shifts"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "shifts_update" ON "shifts" AS PERMISSIVE FOR UPDATE TO public USING ("shifts"."business_id" = any(auth_business_ids())) WITH CHECK ("shifts"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "tables_select" ON "tables" AS PERMISSIVE FOR SELECT TO public USING (exists (
        select 1 from outlets o
        where o.id = "tables"."outlet_id"
          and o.business_id = any(auth_business_ids())
      ));--> statement-breakpoint
CREATE POLICY "tables_insert" ON "tables" AS PERMISSIVE FOR INSERT TO public WITH CHECK (exists (
        select 1 from outlets o
        where o.id = "tables"."outlet_id"
          and o.business_id = any(auth_business_ids())
      ));--> statement-breakpoint
CREATE POLICY "tables_update" ON "tables" AS PERMISSIVE FOR UPDATE TO public USING (exists (
        select 1 from outlets o
        where o.id = "tables"."outlet_id"
          and o.business_id = any(auth_business_ids())
      )) WITH CHECK (exists (
        select 1 from outlets o
        where o.id = "tables"."outlet_id"
          and o.business_id = any(auth_business_ids())
      ));--> statement-breakpoint
-- T11: FORCE ROW LEVEL SECURITY -- Drizzle tidak punya builder untuk ini
-- (sama seperti T07 migration 0001, T08 migration 0003). Tanpa ini, role
-- "postgres" (pemilik tabel, dipakai getAdminDb()/DATABASE_URL) tetap kena
-- atribut BYPASSRLS-nya sendiri regardless (docs/04-CATATAN-TEKNIS.md #2)
-- -- FORCE di sini tetap dipasang untuk menutup celah
-- bypass-karena-kepemilikan-tabel pada role LAIN yang bukan postgres,
-- konsisten dengan kebijakan semua tabel.
ALTER TABLE "areas" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tables" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shifts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cash_movements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_item_modifiers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_methods" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "refunds" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "refund_items" FORCE ROW LEVEL SECURITY;