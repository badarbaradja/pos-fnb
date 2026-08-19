ALTER TABLE "stock_transfer_items" ALTER COLUMN "requested_unit" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_transfer_items" ALTER COLUMN "requested_qty" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_transfer_items" DROP COLUMN "entered_unit";--> statement-breakpoint
ALTER TABLE "stock_transfer_items" DROP COLUMN "entered_qty";--> statement-breakpoint
ALTER TABLE "stock_transfer_items" DROP COLUMN "entered_unit_cost";--> statement-breakpoint
-- T22 -- trigger cancel-only v1 (migration 0019) SEKARANG SALAH: dia
-- menolak SEMUA transisi kecuali status='received'->'cancelled', jadi
-- kalau dibiarkan aktif akan menolak approve/reject/send/receive yang
-- justru mesti dibolehkan (dan dia tidak kenal kolom-kolom baru sama
-- sekali). Diganti sepenuhnya oleh check_stock_transfer_transition di
-- bawah, yang mencakup kasus cancel-only sebagai salah satu cabangnya.
DROP TRIGGER IF EXISTS stock_transfers_cancel_only ON stock_transfers;--> statement-breakpoint
DROP FUNCTION IF EXISTS check_stock_transfer_cancel_only();--> statement-breakpoint
-- State machine stock_transfers: requested -> approved -> sent -> received,
-- requested -> rejected, (requested|approved|received) -> cancelled.
-- RLS stock_transfers_update (migration 0023) cuma menjaga tenancy --
-- trigger ini yang menegakkan (a) transisi status mana yang valid dari
-- status mana, DAN (b) kolom mana yang boleh berubah untuk transisi itu.
-- Pola sama check_stock_transfer_cancel_only v1, digeneralisasi ke semua
-- transisi bukan cuma cancel.
CREATE OR REPLACE FUNCTION check_stock_transfer_transition()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Field inti: TIDAK PERNAH berubah lewat transisi status apa pun, apa pun transisinya.
  IF NEW.business_id != OLD.business_id
     OR NEW.from_outlet_id != OLD.from_outlet_id
     OR NEW.to_outlet_id != OLD.to_outlet_id
     OR NEW.note IS DISTINCT FROM OLD.note
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.created_at != OLD.created_at
  THEN
    RAISE EXCEPTION 'Field inti transfer stok tidak boleh berubah lewat transisi status';
  END IF;

  IF OLD.status = 'requested' AND NEW.status = 'approved' THEN
    IF NEW.approved_by IS NULL OR NEW.approved_at IS NULL THEN
      RAISE EXCEPTION 'approved_by dan approved_at wajib diisi saat menyetujui';
    END IF;
    IF NEW.number IS DISTINCT FROM OLD.number
       OR NEW.rejected_by IS NOT NULL OR NEW.rejected_at IS NOT NULL OR NEW.rejected_reason IS NOT NULL
       OR NEW.sent_by IS NOT NULL OR NEW.sent_at IS NOT NULL
       OR NEW.received_by IS NOT NULL OR NEW.received_at IS NOT NULL
       OR NEW.cancel_reason IS NOT NULL OR NEW.cancelled_at IS NOT NULL OR NEW.cancelled_by IS NOT NULL
    THEN
      RAISE EXCEPTION 'Transisi requested->approved cuma boleh mengisi approved_by/approved_at';
    END IF;

  ELSIF OLD.status = 'requested' AND NEW.status = 'rejected' THEN
    IF NEW.rejected_by IS NULL OR NEW.rejected_at IS NULL OR NEW.rejected_reason IS NULL THEN
      RAISE EXCEPTION 'rejected_by, rejected_at, dan rejected_reason wajib diisi saat menolak';
    END IF;
    IF NEW.number IS DISTINCT FROM OLD.number
       OR NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL
       OR NEW.sent_by IS NOT NULL OR NEW.sent_at IS NOT NULL
       OR NEW.received_by IS NOT NULL OR NEW.received_at IS NOT NULL
       OR NEW.cancel_reason IS NOT NULL OR NEW.cancelled_at IS NOT NULL OR NEW.cancelled_by IS NOT NULL
    THEN
      RAISE EXCEPTION 'Transisi requested->rejected cuma boleh mengisi rejected_by/rejected_at/rejected_reason';
    END IF;

  ELSIF OLD.status = 'approved' AND NEW.status = 'sent' THEN
    IF NEW.sent_by IS NULL OR NEW.sent_at IS NULL THEN
      RAISE EXCEPTION 'sent_by dan sent_at wajib diisi saat mengirim';
    END IF;
    IF NEW.received_by IS NOT NULL OR NEW.received_at IS NOT NULL
       OR NEW.cancel_reason IS NOT NULL OR NEW.cancelled_at IS NOT NULL OR NEW.cancelled_by IS NOT NULL
    THEN
      RAISE EXCEPTION 'Transisi approved->sent cuma boleh mengisi sent_by/sent_at/number';
    END IF;

  ELSIF OLD.status = 'sent' AND NEW.status = 'received' THEN
    IF NEW.received_by IS NULL OR NEW.received_at IS NULL THEN
      RAISE EXCEPTION 'received_by dan received_at wajib diisi saat menerima';
    END IF;
    IF NEW.number IS DISTINCT FROM OLD.number
       OR NEW.cancel_reason IS NOT NULL OR NEW.cancelled_at IS NOT NULL OR NEW.cancelled_by IS NOT NULL
    THEN
      RAISE EXCEPTION 'Transisi sent->received cuma boleh mengisi received_by/received_at';
    END IF;

  ELSIF NEW.status = 'cancelled' AND OLD.status IN ('requested', 'approved', 'received') THEN
    IF NEW.cancel_reason IS NULL OR NEW.cancelled_at IS NULL OR NEW.cancelled_by IS NULL THEN
      RAISE EXCEPTION 'cancel_reason, cancelled_at, dan cancelled_by wajib diisi saat membatalkan';
    END IF;
    -- Kolom tahap lain (apa pun isinya dari sebelum dibatalkan) harus
    -- tetap sama seperti sebelum pembatalan -- cuma tiga kolom cancel_*
    -- yang boleh berubah, terlepas dari status asal pembatalan.
    IF NEW.number IS DISTINCT FROM OLD.number
       OR NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
       OR NEW.rejected_by IS DISTINCT FROM OLD.rejected_by OR NEW.rejected_at IS DISTINCT FROM OLD.rejected_at OR NEW.rejected_reason IS DISTINCT FROM OLD.rejected_reason
       OR NEW.sent_by IS DISTINCT FROM OLD.sent_by OR NEW.sent_at IS DISTINCT FROM OLD.sent_at
       OR NEW.received_by IS DISTINCT FROM OLD.received_by OR NEW.received_at IS DISTINCT FROM OLD.received_at
    THEN
      RAISE EXCEPTION 'Transisi ke cancelled cuma boleh mengisi cancel_reason/cancelled_at/cancelled_by';
    END IF;

  ELSE
    RAISE EXCEPTION 'Transisi status % -> % tidak diizinkan', OLD.status, NEW.status;
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE TRIGGER stock_transfers_check_transition
BEFORE UPDATE ON stock_transfers
FOR EACH ROW EXECUTE FUNCTION check_stock_transfer_transition();--> statement-breakpoint
-- stock_transfer_items: field inti permintaan (apa yang diminta outlet)
-- terkunci selamanya setelah baris dibuat. Field lain (sent_*/
-- received_*/qty/unit_cost) TIDAK dikunci trigger -- urutan pengisiannya
-- (tidak bisa isi sent_* sebelum transfer induk berstatus 'approved',
-- dst.) ditegakkan lib/stock-transfers/manage.ts di dalam transaksi,
-- bukan di sini, mengikuti pola yang sama seperti sequencing status
-- stock_transfers sendiri (RLS+trigger di sana juga tidak menegakkan
-- URUTAN, cuma keabsahan transisi begitu terjadi).
CREATE OR REPLACE FUNCTION check_transfer_item_immutable_core()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.transfer_id != OLD.transfer_id
     OR NEW.business_id != OLD.business_id
     OR NEW.ingredient_id != OLD.ingredient_id
     OR NEW.requested_unit != OLD.requested_unit
     OR NEW.requested_qty != OLD.requested_qty
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at != OLD.created_at
  THEN
    RAISE EXCEPTION 'Field permintaan awal baris transfer stok tidak boleh diubah';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE TRIGGER stock_transfer_items_check_immutable_core
BEFORE UPDATE ON stock_transfer_items
FOR EACH ROW EXECUTE FUNCTION check_transfer_item_immutable_core();