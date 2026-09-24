CREATE TYPE "public"."stock_opname_jenis" AS ENUM('buka', 'tutup', 'berkala');--> statement-breakpoint
ALTER TABLE "ingredients" ADD COLUMN "hitung_tiap_shift" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_opnames" ADD COLUMN "jenis" "stock_opname_jenis" DEFAULT 'berkala' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_opnames" ADD COLUMN "shift_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_opnames" ADD CONSTRAINT "stock_opnames_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_opnames" ADD CONSTRAINT "stock_opnames_shift_jenis_unique" UNIQUE("shift_id","jenis");