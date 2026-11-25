-- field_evidence_document_key_v1: a paper witness on field_evidence points at its document row, and what a document
-- can establish is a rule row by document_type.
--
-- WHY. Lead ruling 2026-11-25 (two-axis establishment rule, held): a receipt establishes a purchase and its own lines,
-- never a spec; a build sheet, title or shop paper ranks by its document kind. field_evidence had no key to a document:
-- its paper rows carry only source_type text, so no reader can tell a parts receipt from a build sheet.
--
-- WHAT.
-- 1. field_evidence.document_id uuid, FOREIGN KEY -> vehicle_documents(id), NOT VALID (every row is NULL when it lands;
--    new and updated rows are checked), and a partial index built CONCURRENTLY so a vehicle_documents delete never
--    scans the 8.9M-row table.
-- 2. public.paper_kind_rules (document_type PK, evidence_class FK -> evidence_class_rank, establishes purchase |
--    current | as_built | none, rank): one row per vehicle_documents.document_type in use on 2026-11-25 (12), plus the
--    as-built kinds the rule needs (build_sheet, title, phs_documents, window_sticker, protect_o_plate) ahead of data.
-- BACKFILL: none. Measured 2026-11-25 05:5xZ: 155 paper-class field_evidence rows (quickbooks 74, invoice 67,
-- email_receipt 14, one vehicle, newest 2026-03-24). 0 resolve to a vehicle_documents row by a real key: their keys are
-- supporting_signals.qb_id (129, all equal to a qb_transactions.qb_id) and supporting_signals.manifest_id (26, all equal
-- to a vehicle_build_manifest.id), and their vehicle has 0 vehicle_documents rows. All 155 stay NULL; no text matching.
-- REVERT. ALTER TABLE public.field_evidence DROP COLUMN document_id; DROP TABLE public.paper_kind_rules.
-- Contract: supabase/sql/test_field_evidence_document_key.sql.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

ALTER TABLE public.field_evidence ADD COLUMN IF NOT EXISTS document_id uuid;
DO $fk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.field_evidence'::regclass
                  AND conname = 'field_evidence_document_id_fkey') THEN
    ALTER TABLE public.field_evidence ADD CONSTRAINT field_evidence_document_id_fkey
      FOREIGN KEY (document_id) REFERENCES public.vehicle_documents (id) NOT VALID;
  END IF;
END $fk$;
COMMENT ON COLUMN public.field_evidence.document_id IS
  'The vehicle_documents row this evidence was read from, when it is paper. What that paper can establish is the '
  'paper_kind_rules row of its document_type. 20261124195800.';

CREATE TABLE IF NOT EXISTS public.paper_kind_rules (
  document_type text PRIMARY KEY,
  evidence_class text NOT NULL REFERENCES public.evidence_class_rank (class),
  establishes text NOT NULL CHECK (establishes IN ('purchase', 'current', 'as_built', 'none')),
  rank int NOT NULL CHECK (rank >= 1),
  note text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.paper_kind_rules (document_type, evidence_class, establishes, rank, note) VALUES
  ('build_sheet', 'receipt', 'as_built', 1, 'factory build sheet: as-built specification of this car'),
  ('phs_documents', 'receipt', 'as_built', 1, 'factory billing history (PHS): as-built specification of this car'),
  ('window_sticker', 'receipt', 'as_built', 1, 'factory window sticker: as-built options of this car'),
  ('protect_o_plate', 'receipt', 'as_built', 1, 'warranty plate: as-built engine, transmission and axle of this car'),
  ('title', 'receipt', 'as_built', 1, 'title: the VIN, year and make as registered'),
  ('work_order', 'receipt', 'current', 2, 'shop paper: work done on this car, current state of what it names'),
  ('alignment_report', 'receipt', 'current', 2, 'a measurement taken on this car'),
  ('receipt', 'receipt', 'purchase', 3, 'a purchase by its payer and its own lines; never fitment or a spec'),
  ('invoice', 'receipt', 'purchase', 3, 'a purchase by its payer and its own lines; never fitment or a spec'),
  ('agreement', 'receipt', 'purchase', 3, 'the terms of a deal between its parties'),
  ('packing_slip', 'receipt', 'purchase', 4, 'what was shipped; never fitment'),
  ('order_confirmation', 'receipt', 'purchase', 4, 'what was ordered; never fitment'),
  ('estimate', 'receipt', 'none', 8, 'a quote: neither a purchase nor work done'),
  ('history_file', 'receipt', 'none', 8, 'a history file: cite its pages by their own kinds'),
  ('provenance_citation', 'receipt', 'none', 8, 'a citation of an outside source: its claims are claims'),
  ('books_decision', 'receipt', 'none', 9, 'a bookkeeping decision: no fact about the car'),
  ('other', 'receipt', 'none', 9, 'unclassified paper: establishes nothing until it has a kind')
ON CONFLICT (document_type) DO NOTHING;
ALTER TABLE public.paper_kind_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS paper_kind_rules_read ON public.paper_kind_rules;
CREATE POLICY paper_kind_rules_read ON public.paper_kind_rules FOR SELECT USING (true);
GRANT SELECT ON public.paper_kind_rules TO anon, authenticated, service_role;
COMMENT ON TABLE public.paper_kind_rules IS
  'What a document of each vehicle_documents.document_type can establish: purchase (its own lines), current (state of '
  'what it names), as_built (factory specification) or none, with its witness class and rank. 20261124195800.';

RESET lock_timeout;
RESET statement_timeout;
SET statement_timeout = '30min';
SET lock_timeout = '15min';
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('public.field_evidence_document_id_idx') AND NOT indisvalid) THEN
    RAISE EXCEPTION 'field_evidence_document_id_idx exists but is INVALID; drop it CONCURRENTLY and rebuild';
  END IF;
END $guard$;
CREATE INDEX CONCURRENTLY IF NOT EXISTS field_evidence_document_id_idx
  ON public.field_evidence (document_id) WHERE document_id IS NOT NULL;
RESET lock_timeout;
RESET statement_timeout;
