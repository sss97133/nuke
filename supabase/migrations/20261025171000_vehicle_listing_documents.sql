-- Links documentary photos in a vehicle's listing gallery (receipts, invoices, service records,
-- window stickers, title, history reports) to the vehicle, with OCR text and typed work categories.
-- Purpose: an independent (image + OCR, not description text) source for documented_work claims.
-- Additive only. Rows are never deleted: set revoked_at/revoked_reason instead.
-- Revert: supabase/sql/revert_20261025171000_vehicle_listing_documents.sql

CREATE TABLE IF NOT EXISTS public.vehicle_listing_documents (
  id               bigserial PRIMARY KEY,
  vehicle_id       uuid NOT NULL REFERENCES public.vehicles(id),
  image_id         uuid NOT NULL REFERENCES public.vehicle_images(id),
  run_id           uuid NOT NULL,
  detector         text NOT NULL,              -- e.g. 'clip_vitb32_zs_v1'
  detector_score   numeric(5,4) NOT NULL,      -- P(document scene)
  doc_type         text NOT NULL CHECK (doc_type IN
                     ('receipt_invoice','service_record','window_sticker','title_registration',
                      'history_report','manual_book','other_document')),
  ocr_method       text,                       -- e.g. 'rapidocr_box_v1'
  ocr_text         text,
  ocr_mean_conf    numeric(5,4),
  work_categories  text[] NOT NULL DEFAULT '{}', -- same vocabulary as documented_work value_text
  doc_date         date,
  amount           numeric,
  observed_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at       timestamptz,
  revoked_reason   text,
  UNIQUE (image_id, detector)
);
CREATE INDEX IF NOT EXISTS vehicle_listing_documents_vehicle_idx
  ON public.vehicle_listing_documents (vehicle_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS vehicle_listing_documents_run_idx ON public.vehicle_listing_documents (run_id);

ALTER TABLE public.vehicle_listing_documents ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.vehicle_listing_documents IS
  'Documentary photos (receipts, service records, stickers, title, history reports) found in a vehicle listing gallery, with OCR and work categories. Independent source for documented_work. Never delete; revoke.';
