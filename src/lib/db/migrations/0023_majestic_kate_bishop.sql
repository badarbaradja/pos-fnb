ALTER TYPE "public"."movement_type" ADD VALUE 'transfer_loss';--> statement-breakpoint
ALTER TABLE "stock_transfer_items" ALTER COLUMN "entered_unit" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_transfer_items" ALTER COLUMN "entered_qty" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_transfer_items" ALTER COLUMN "entered_unit_cost" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_transfer_items" ALTER COLUMN "qty" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_transfer_items" ALTER COLUMN "unit_cost" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_transfers" ALTER COLUMN "number" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_transfers" ALTER COLUMN "status" SET DEFAULT 'requested';--> statement-breakpoint
ALTER TABLE "stock_transfers" ALTER COLUMN "received_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "stock_transfers" ALTER COLUMN "received_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "transfer_request_alert_hours" integer DEFAULT 4 NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_transfer_items" ADD COLUMN "requested_unit" text;--> statement-breakpoint
ALTER TABLE "stock_transfer_items" ADD COLUMN "requested_qty" numeric(16, 4);--> statement-breakpoint
ALTER TABLE "stock_transfer_items" ADD COLUMN "sent_unit" text;--> statement-breakpoint
ALTER TABLE "stock_transfer_items" ADD COLUMN "sent_qty" numeric(16, 4);--> statement-breakpoint
ALTER TABLE "stock_transfer_items" ADD COLUMN "sent_unit_cost" numeric(20, 8);--> statement-breakpoint
ALTER TABLE "stock_transfer_items" ADD COLUMN "send_diff_reason" text;--> statement-breakpoint
ALTER TABLE "stock_transfer_items" ADD COLUMN "received_qty" numeric(16, 4);--> statement-breakpoint
ALTER TABLE "stock_transfer_items" ADD COLUMN "receive_diff_reason" text;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD COLUMN "requested_by" uuid;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD COLUMN "rejected_by" uuid;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD COLUMN "rejected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD COLUMN "rejected_reason" text;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD COLUMN "sent_by" uuid;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_requested_by_employees_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_approved_by_employees_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_rejected_by_employees_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_sent_by_employees_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "stock_transfer_items_update" ON "stock_transfer_items" AS PERMISSIVE FOR UPDATE TO public USING ("stock_transfer_items"."business_id" = any(auth_business_ids())) WITH CHECK ("stock_transfer_items"."business_id" = any(auth_business_ids()));--> statement-breakpoint
ALTER POLICY "stock_transfers_update" ON "stock_transfers" TO public USING ("stock_transfers"."business_id" = any(auth_business_ids())) WITH CHECK ("stock_transfers"."business_id" = any(auth_business_ids()));--> statement-breakpoint
-- T22 -- backfill data v1 (transfer yang sudah 'received'/'cancelled'
-- sebelum alur dua sisi ini ada). v1 SELALU mengisi entered_unit/
-- entered_qty/entered_unit_cost saat dibuat (satu langkah, tidak pernah
-- lewat tahap request/approve/send terpisah) -- jadi backfill yang jujur
-- adalah anggap outlet "meminta" dan gudang "mengirim" PERSIS sejumlah
-- yang tercatat diterima, karena itu SATU-SATUNYA angka yang ada.
-- requested_by/approved_by/approved_at/sent_by/sent_at SENGAJA dibiarkan
-- NULL untuk baris lama -- v1 tidak pernah mencatat siapa yang berperan
-- di tahap-tahap itu (belum ada tahapnya), tidak ada yang bisa
-- direkonstruksi secara jujur. UI wajib menampilkan ini sebagai "-"
-- untuk transfer lama, bukan menebak.
UPDATE stock_transfer_items
SET
  requested_unit = entered_unit,
  requested_qty = entered_qty,
  sent_unit = entered_unit,
  sent_qty = entered_qty,
  sent_unit_cost = entered_unit_cost,
  received_qty = entered_qty
WHERE entered_unit IS NOT NULL;