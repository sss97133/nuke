-- Paperwork scan mode (iOS): per-page evidence beside the document_ocr_queue row.
--
-- The phone scans paper (receipts, work orders, titles) with VisionKit, reads it on-device, and posts each page to
-- the paperwork-intake edge function, which writes the image to the private deal-documents bucket, a pending
-- document_ocr_queue row (document-ocr-worker stays authoritative for type, date and linking), and this row.
--
-- What lives here and nowhere else:
--   scanned_at                capture time on the phone: SCAN time only, never the document's date
--   document_date_hint*       a date read from the page text on-device; a hint, the worker decides
--   batch_evidence            the label card ("Box 3, R3500 receipts 2017") open when the page was scanned:
--                             {source:'label_card', strength:'soft', label_page_id, label_document_id, box,
--                              vehicle_hint, year_hint, confidence, label_text}. Soft cited evidence, never a
--                             vehicle assignment; label_page_id points at the label card's own row here.
-- Writes come from the service role only (the edge function); active admins read, as for the bucket.
BEGIN;

CREATE TABLE IF NOT EXISTS public.paperwork_page_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_page_id uuid NOT NULL UNIQUE,
  document_id uuid NOT NULL,
  page_index integer NOT NULL CHECK (page_index >= 0),
  page_count integer NOT NULL CHECK (page_count > page_index),
  storage_path text NOT NULL,
  document_ocr_queue_id uuid REFERENCES public.document_ocr_queue(id) ON DELETE SET NULL,
  uploaded_by uuid,
  scanned_at timestamptz NOT NULL,
  is_document boolean NOT NULL DEFAULT true CHECK (is_document),
  is_label_card boolean NOT NULL DEFAULT false,
  ocr_text text NOT NULL DEFAULT '',
  ocr_engine text,
  document_date_hint date,
  document_date_hint_text text,
  document_date_hint_confidence real CHECK (document_date_hint_confidence IS NULL OR document_date_hint_confidence BETWEEN 0 AND 1),
  batch_evidence jsonb CHECK (batch_evidence IS NULL OR (batch_evidence->>'strength' = 'soft'
    AND batch_evidence ? 'label_page_id' AND (batch_evidence->>'confidence')::numeric BETWEEN 0 AND 1)),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, page_index)
);

CREATE INDEX IF NOT EXISTS idx_paperwork_evidence_document ON public.paperwork_page_evidence (document_id, page_index);
CREATE INDEX IF NOT EXISTS idx_paperwork_evidence_queue ON public.paperwork_page_evidence (document_ocr_queue_id);
CREATE INDEX IF NOT EXISTS idx_paperwork_evidence_label ON public.paperwork_page_evidence ((batch_evidence->>'label_page_id'))
  WHERE batch_evidence IS NOT NULL;

ALTER TABLE public.paperwork_page_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.paperwork_page_evidence FROM anon, authenticated;
GRANT SELECT ON public.paperwork_page_evidence TO authenticated;

DROP POLICY IF EXISTS paperwork_evidence_admin_read ON public.paperwork_page_evidence;
CREATE POLICY paperwork_evidence_admin_read ON public.paperwork_page_evidence FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = (SELECT auth.uid()) AND au.is_active));

COMMENT ON TABLE public.paperwork_page_evidence IS
  'Paperwork scan pages (iOS): scan time, on-device OCR text and date hint, and the label-card batch as soft cited evidence. One row per document_ocr_queue page; written by paperwork-intake (service role).';
COMMENT ON COLUMN public.paperwork_page_evidence.scanned_at IS 'Phone capture time. Scan time only; never the document date.';
COMMENT ON COLUMN public.paperwork_page_evidence.document_date_hint IS 'Date read on-device from the page text. A hint: document-ocr-worker is authoritative.';
COMMENT ON COLUMN public.paperwork_page_evidence.batch_evidence IS 'Label card batch open at scan time: soft evidence citing label_page_id with a confidence. Never a hard vehicle assignment.';

COMMIT;
