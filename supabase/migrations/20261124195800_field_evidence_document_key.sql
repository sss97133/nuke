-- field_evidence_paper_arc_v1: a paper witness on field_evidence is keyed to where its real key points (an exclusive
-- arc), and what it can establish is a rule row by arc and the target's own kind.
--
-- WHY. Lead ruling 2026-11-25 (two-axis establishment rule, held): a receipt establishes a purchase and its own lines,
-- never a spec; build sheet, title and shop paper rank by document kind. field_evidence held its paper's keys only in
-- supporting_signals jsonb, so no reader could tell a card payment from a build sheet.
--
-- WHAT.
-- 1. Three nullable keys on field_evidence, at most one set (CHECK num_nonnulls(...) <= 1):
--      document_id       -> vehicle_documents(id)        kind: vehicle_documents.document_type
--      qb_transaction_id -> qb_transactions(id)          kind: qb_transactions.qb_type
--      build_manifest_id -> vehicle_build_manifest(id)   kind: vehicle_build_manifest.evidence_level
--    Foreign keys and the CHECK are added NOT VALID, then validated after the backfill (validation takes SHARE UPDATE
--    EXCLUSIVE: reads and writes continue; each validation is one scan of the 2.4 GB heap).
-- 2. Backfill by key equality only: supporting_signals.qb_id = qb_transactions.qb_id (unique),
--    supporting_signals.manifest_id = vehicle_build_manifest.id, supporting_signals or raw_extraction_data document_id =
--    vehicle_documents.id. Predicted from live keys 2026-11-25: 129 + 26 + 0 = 155 of the 155 paper-class rows keyed,
--    0 by text.
-- 3. Writers: no live writer lands these rows (all 155 were written 2026-03-24 03:14-03:15Z by a one-off run that is
--    not in the repository; accept_cited_field_evidence reads raw_extraction_data.document_id). A BEFORE INSERT
--    trigger (field_evidence_paper_arc) sets the arc on every insert whose signals carry one of the three real keys and
--    that names no arc itself, so any writer that lands paper with its key lands the edge.
-- 4. public.paper_kind_rules (arc, kind) PK: evidence_class (FK evidence_class_rank), establishes purchase | current |
--    as_built | none, rank. A qb_transactions row is a payment or billing record: a purchase, never a spec. A build
--    manifest row is the builder's list of electrical devices in the build (its table comment): a claim whose purchase
--    line an invoice or a payment may prove (evidence_level), never fitment or a spec.
-- INDEX: none now (155 rows; 0 deletes on the three targets since the stats reset). Add partial indexes on the arc
-- columns, CONCURRENTLY and in the quietest v_job_health window, when they hold volume or a target sees deletes.
-- REVERT. DROP TRIGGER field_evidence_paper_arc; ALTER TABLE field_evidence DROP the three columns (the constraints
-- go with them); DROP TABLE paper_kind_rules.
-- Contract: supabase/sql/test_field_evidence_document_key.sql.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

ALTER TABLE public.field_evidence
  ADD COLUMN IF NOT EXISTS document_id uuid,
  ADD COLUMN IF NOT EXISTS qb_transaction_id uuid,
  ADD COLUMN IF NOT EXISTS build_manifest_id uuid;
DO $c$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.field_evidence'::regclass AND conname = 'field_evidence_document_id_fkey') THEN
    ALTER TABLE public.field_evidence ADD CONSTRAINT field_evidence_document_id_fkey
      FOREIGN KEY (document_id) REFERENCES public.vehicle_documents (id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.field_evidence'::regclass AND conname = 'field_evidence_qb_transaction_id_fkey') THEN
    ALTER TABLE public.field_evidence ADD CONSTRAINT field_evidence_qb_transaction_id_fkey
      FOREIGN KEY (qb_transaction_id) REFERENCES public.qb_transactions (id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.field_evidence'::regclass AND conname = 'field_evidence_build_manifest_id_fkey') THEN
    ALTER TABLE public.field_evidence ADD CONSTRAINT field_evidence_build_manifest_id_fkey
      FOREIGN KEY (build_manifest_id) REFERENCES public.vehicle_build_manifest (id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.field_evidence'::regclass AND conname = 'field_evidence_paper_arc_one') THEN
    ALTER TABLE public.field_evidence ADD CONSTRAINT field_evidence_paper_arc_one
      CHECK (num_nonnulls(document_id, qb_transaction_id, build_manifest_id) <= 1) NOT VALID;
  END IF;
END $c$;
COMMENT ON COLUMN public.field_evidence.document_id IS
  'Paper arc: the vehicle_documents row this evidence was read from. At most one arc is set. 20261124195800.';
COMMENT ON COLUMN public.field_evidence.qb_transaction_id IS
  'Paper arc: the qb_transactions row (a payment or billing record) this evidence comes from. 20261124195800.';
COMMENT ON COLUMN public.field_evidence.build_manifest_id IS
  'Paper arc: the vehicle_build_manifest row (the builder''s device list) this evidence comes from. 20261124195800.';

-- the arc from a real key, never from text: the first key that resolves wins (document, payment, manifest)
CREATE OR REPLACE FUNCTION public.field_evidence_paper_arc_resolve(p_signals jsonb, p_raw jsonb,
  OUT document_id uuid, OUT qb_transaction_id uuid, OUT build_manifest_id uuid)
LANGUAGE plpgsql STABLE
SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE k text;
BEGIN
  k := coalesce(p_signals->>'document_id', p_raw->>'document_id');
  IF k ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT d.id INTO document_id FROM public.vehicle_documents d WHERE d.id = k::uuid;
    IF document_id IS NOT NULL THEN RETURN; END IF;
  END IF;
  k := p_signals->>'qb_id';
  IF nullif(btrim(k), '') IS NOT NULL THEN
    SELECT q.id INTO qb_transaction_id FROM public.qb_transactions q WHERE q.qb_id = k;
    IF qb_transaction_id IS NOT NULL THEN RETURN; END IF;
  END IF;
  k := p_signals->>'manifest_id';
  IF k ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT m.id INTO build_manifest_id FROM public.vehicle_build_manifest m WHERE m.id = k::uuid;
  END IF;
END $f$;

CREATE OR REPLACE FUNCTION public.field_evidence_paper_arc() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE r record;
BEGIN
  IF num_nonnulls(NEW.document_id, NEW.qb_transaction_id, NEW.build_manifest_id) = 0
     AND (NEW.supporting_signals ?| ARRAY['document_id', 'qb_id', 'manifest_id']
          OR NEW.raw_extraction_data ? 'document_id') THEN
    SELECT * INTO r FROM public.field_evidence_paper_arc_resolve(NEW.supporting_signals, NEW.raw_extraction_data);
    NEW.document_id := r.document_id;
    NEW.qb_transaction_id := r.qb_transaction_id;
    NEW.build_manifest_id := r.build_manifest_id;
  END IF;
  RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS field_evidence_paper_arc ON public.field_evidence;
CREATE TRIGGER field_evidence_paper_arc BEFORE INSERT ON public.field_evidence
  FOR EACH ROW EXECUTE FUNCTION public.field_evidence_paper_arc();

-- backfill: the paper-class rows, by key equality only
UPDATE public.field_evidence f
   SET document_id = r.document_id, qb_transaction_id = r.qb_transaction_id, build_manifest_id = r.build_manifest_id
  FROM public.field_evidence f0
  CROSS JOIN LATERAL public.field_evidence_paper_arc_resolve(f0.supporting_signals, f0.raw_extraction_data) r
 WHERE f.id = f0.id
   AND f0.source_type IN ('quickbooks', 'invoice', 'email_receipt', 'receipt')
   AND num_nonnulls(f0.document_id, f0.qb_transaction_id, f0.build_manifest_id) = 0
   AND num_nonnulls(r.document_id, r.qb_transaction_id, r.build_manifest_id) = 1;

CREATE TABLE IF NOT EXISTS public.paper_kind_rules (
  arc text NOT NULL CHECK (arc IN ('document', 'qb_transaction', 'build_manifest')),
  kind text NOT NULL,
  evidence_class text NOT NULL REFERENCES public.evidence_class_rank (class),
  establishes text NOT NULL CHECK (establishes IN ('purchase', 'current', 'as_built', 'none')),
  rank int NOT NULL CHECK (rank >= 1),
  note text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (arc, kind)
);
INSERT INTO public.paper_kind_rules (arc, kind, evidence_class, establishes, rank, note) VALUES
  ('document', 'build_sheet', 'receipt', 'as_built', 1, 'factory build sheet: as-built specification of this car'),
  ('document', 'phs_documents', 'receipt', 'as_built', 1, 'factory billing history (PHS): as-built specification of this car'),
  ('document', 'window_sticker', 'receipt', 'as_built', 1, 'factory window sticker: as-built options of this car'),
  ('document', 'protect_o_plate', 'receipt', 'as_built', 1, 'warranty plate: as-built engine, transmission and axle of this car'),
  ('document', 'title', 'receipt', 'as_built', 1, 'title: the VIN, year and make as registered'),
  ('document', 'work_order', 'receipt', 'current', 2, 'shop paper: work done on this car, current state of what it names'),
  ('document', 'alignment_report', 'receipt', 'current', 2, 'a measurement taken on this car'),
  ('document', 'receipt', 'receipt', 'purchase', 3, 'a purchase by its payer and its own lines; never fitment or a spec'),
  ('document', 'invoice', 'receipt', 'purchase', 3, 'a purchase by its payer and its own lines; never fitment or a spec'),
  ('document', 'agreement', 'receipt', 'purchase', 3, 'the terms of a deal between its parties'),
  ('document', 'packing_slip', 'receipt', 'purchase', 4, 'what was shipped; never fitment'),
  ('document', 'order_confirmation', 'receipt', 'purchase', 4, 'what was ordered; never fitment'),
  ('document', 'estimate', 'receipt', 'none', 8, 'a quote: neither a purchase nor work done'),
  ('document', 'history_file', 'receipt', 'none', 8, 'a history file: cite its pages by their own kinds'),
  ('document', 'provenance_citation', 'receipt', 'none', 8, 'a citation of an outside source: its claims are claims'),
  ('document', 'books_decision', 'receipt', 'none', 9, 'a bookkeeping decision: no fact about the car'),
  ('document', 'other', 'receipt', 'none', 9, 'unclassified paper: establishes nothing until it has a kind'),
  ('qb_transaction', 'Purchase', 'receipt', 'purchase', 3, 'a payment by its payer (bank or card line): the payment, never a spec or fitment'),
  ('qb_transaction', 'Invoice', 'receipt', 'purchase', 3, 'a billing between its parties: the billing, never a spec or fitment'),
  ('qb_transaction', 'Deposit', 'receipt', 'none', 9, 'money received: no fact about the car'),
  ('build_manifest', 'invoice_proven', 'claim', 'purchase', 4, 'the builder''s device row whose purchase an invoice proves: the purchase line, never fitment or a spec'),
  ('build_manifest', 'qb_matched', 'claim', 'purchase', 5, 'the builder''s device row matched to a payment line: the purchase line, never fitment or a spec'),
  ('build_manifest', 'assumed', 'claim', 'none', 9, 'the builder''s device row with nothing behind it')
ON CONFLICT (arc, kind) DO NOTHING;
ALTER TABLE public.paper_kind_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS paper_kind_rules_read ON public.paper_kind_rules;
CREATE POLICY paper_kind_rules_read ON public.paper_kind_rules FOR SELECT USING (true);
GRANT SELECT ON public.paper_kind_rules TO anon, authenticated, service_role;
COMMENT ON TABLE public.paper_kind_rules IS
  'What paper of each arc and kind can establish (purchase: its own lines; current: state of what it names; as_built: '
  'factory specification; none), with its witness class and rank. Kind is the target''s own column: '
  'vehicle_documents.document_type, qb_transactions.qb_type, vehicle_build_manifest.evidence_level. 20261124195800.';

-- validate after the backfill: one heap scan each, reads and writes continue (SHARE UPDATE EXCLUSIVE)
SET statement_timeout = '5min';
ALTER TABLE public.field_evidence VALIDATE CONSTRAINT field_evidence_paper_arc_one;
ALTER TABLE public.field_evidence VALIDATE CONSTRAINT field_evidence_document_id_fkey;
ALTER TABLE public.field_evidence VALIDATE CONSTRAINT field_evidence_qb_transaction_id_fkey;
ALTER TABLE public.field_evidence VALIDATE CONSTRAINT field_evidence_build_manifest_id_fkey;
RESET statement_timeout;
RESET lock_timeout;
