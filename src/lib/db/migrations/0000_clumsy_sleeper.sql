CREATE TYPE "public"."user_role" AS ENUM('owner', 'manager', 'cashier', 'waiter', 'kitchen', 'warehouse', 'accountant');--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"business_type" text DEFAULT 'cafe' NOT NULL,
	"timezone" text DEFAULT 'Asia/Jakarta' NOT NULL,
	"currency" text DEFAULT 'IDR' NOT NULL,
	"logo_url" text,
	"npwp" text,
	"plan" text DEFAULT 'basic' NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "businesses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"serial_number" text NOT NULL,
	"name" text NOT NULL,
	"device_type" text DEFAULT 'pos' NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_seq" bigint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "devices_business_id_serial_number_unique" UNIQUE("business_id","serial_number")
);
--> statement-breakpoint
ALTER TABLE "devices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"outlet_id" uuid,
	"user_id" uuid,
	"code" text NOT NULL,
	"full_name" text NOT NULL,
	"role" "user_role" DEFAULT 'cashier' NOT NULL,
	"pin_hash" text,
	"employment_type" text DEFAULT 'fulltime' NOT NULL,
	"join_date" date,
	"resign_date" date,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "employees_business_id_code_unique" UNIQUE("business_id","code")
);
--> statement-breakpoint
ALTER TABLE "employees" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "user_role" NOT NULL,
	"outlet_ids" uuid[],
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "memberships_business_id_user_id_unique" UNIQUE("business_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "outlets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"phone" text,
	"day_cutoff_time" time DEFAULT '04:00:00' NOT NULL,
	"is_central_kitchen" boolean DEFAULT false NOT NULL,
	"tax_percent" numeric(7, 4) DEFAULT '10' NOT NULL,
	"tax_inclusive" boolean DEFAULT false NOT NULL,
	"service_charge_percent" numeric(7, 4) DEFAULT '0' NOT NULL,
	"service_charge_in_tax_base" boolean DEFAULT true NOT NULL,
	"rounding_to" integer DEFAULT 100 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outlets_business_id_code_unique" UNIQUE("business_id","code")
);
--> statement-breakpoint
ALTER TABLE "outlets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "permissions_override" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"permission_key" text NOT NULL,
	"allowed" boolean NOT NULL
);
--> statement-breakpoint
ALTER TABLE "permissions_override" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"phone" text,
	"avatar_url" text
);
--> statement-breakpoint
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- profiles.id merujuk ke auth.users(id) milik Supabase Auth (skema "auth",
-- dikelola Supabase, bukan Drizzle). Migration ini WAJIB dijalankan di
-- database Supabase (auth.users sudah ada), bukan Postgres kosong.
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_id_auth_users_id_fk" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outlets" ADD CONSTRAINT "outlets_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permissions_override" ADD CONSTRAINT "permissions_override_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- BLUEPRINT §9.5 — helper RLS. Harus dibuat SETELAH memberships ada (di atas)
-- dan SEBELUM policy manapun yang memanggilnya (di bawah).
CREATE OR REPLACE FUNCTION auth_business_ids()
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(ARRAY_AGG(business_id), '{}')
  FROM memberships
  WHERE user_id = auth.uid() AND is_active = true
$$;--> statement-breakpoint
CREATE POLICY "businesses_select" ON "businesses" AS PERMISSIVE FOR SELECT TO public USING ("businesses"."id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "devices_select" ON "devices" AS PERMISSIVE FOR SELECT TO public USING ("devices"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "devices_insert" ON "devices" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("devices"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "employees_select" ON "employees" AS PERMISSIVE FOR SELECT TO public USING ("employees"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "employees_insert" ON "employees" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("employees"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "memberships_select" ON "memberships" AS PERMISSIVE FOR SELECT TO public USING ("memberships"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "outlets_select" ON "outlets" AS PERMISSIVE FOR SELECT TO public USING ("outlets"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "outlets_insert" ON "outlets" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("outlets"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "permissions_override_select" ON "permissions_override" AS PERMISSIVE FOR SELECT TO public USING (exists (
        select 1 from employees e
        where e.id = "permissions_override"."employee_id"
          and e.business_id = any(auth_business_ids())
      ));--> statement-breakpoint
CREATE POLICY "profiles_select_own" ON "profiles" AS PERMISSIVE FOR SELECT TO public USING ("profiles"."id" = auth.uid());