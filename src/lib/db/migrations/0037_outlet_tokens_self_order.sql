-- outlet_tokens: token publik per outlet untuk self-order display (QR + kiosk,
-- TT-SELFORDER, 14 September 2026). Tidak enable RLS -- seluruh akses lewat
-- getAdminDb() karena customer tidak punya Supabase Auth. Keamanan via
-- token 32-byte hex + is_active flag + validasi outlet aktif setiap request.
CREATE TABLE "outlet_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"token" text NOT NULL,
	"label" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outlet_tokens_token_unique" UNIQUE("token"),
	CONSTRAINT "outlet_tokens_outlet_id_token_unique" UNIQUE("outlet_id","token")
);
--> statement-breakpoint
ALTER TABLE "outlet_tokens" ADD CONSTRAINT "outlet_tokens_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE cascade ON UPDATE no action;
