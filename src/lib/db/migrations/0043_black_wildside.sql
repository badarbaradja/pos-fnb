CREATE TABLE "handoff_nonces" (
	"nonce" uuid PRIMARY KEY NOT NULL,
	"report_email" text NOT NULL,
	"used_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "handoff_nonces" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "report_identity_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_email" text NOT NULL,
	"pos_profile_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "report_identity_links_report_email_unique" UNIQUE("report_email")
);
--> statement-breakpoint
ALTER TABLE "report_identity_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_identity_links" ADD CONSTRAINT "report_identity_links_pos_profile_id_profiles_id_fk" FOREIGN KEY ("pos_profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_identity_links" ADD CONSTRAINT "report_identity_links_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;