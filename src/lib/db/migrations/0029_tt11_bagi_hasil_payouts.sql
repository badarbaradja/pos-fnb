CREATE TABLE "pemilik_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"pemilik_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"jumlah" numeric(16, 2) NOT NULL,
	"tanggal_bayar" date NOT NULL,
	"recorded_by_user_id" uuid NOT NULL,
	"catatan" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pemilik_payouts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "outlets" ADD COLUMN "day_cutoff_confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pemilik_payouts" ADD CONSTRAINT "pemilik_payouts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pemilik_payouts" ADD CONSTRAINT "pemilik_payouts_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pemilik_payouts" ADD CONSTRAINT "pemilik_payouts_pemilik_id_pemilik_id_fk" FOREIGN KEY ("pemilik_id") REFERENCES "public"."pemilik"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pemilik_payouts" ADD CONSTRAINT "pemilik_payouts_recorded_by_user_id_profiles_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "pemilik_payouts_select" ON "pemilik_payouts" AS PERMISSIVE FOR SELECT TO public USING ("pemilik_payouts"."business_id" = any(auth_business_ids()));--> statement-breakpoint
CREATE POLICY "pemilik_payouts_insert" ON "pemilik_payouts" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("pemilik_payouts"."business_id" = any(auth_business_ids()));