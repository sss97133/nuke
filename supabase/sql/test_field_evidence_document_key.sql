-- Contract for 20261124195800_field_evidence_document_key (empty disposable PG17). Asserts: field_evidence.document_id
-- exists with its foreign key to vehicle_documents (an unknown document is refused, a real one accepted, existing rows
-- stay NULL); the partial index is valid; paper_kind_rules covers every document_type in the live vocabulary, a receipt
-- establishes a purchase only, shop paper the current state, a build sheet the as-built; idempotent.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF to_regclass('public.evidence_class_rank') IS NOT NULL THEN RAISE EXCEPTION 'Requires an empty disposable database'; END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.evidence_class_rank (class text PRIMARY KEY, rank int, is_witness boolean NOT NULL, note text);
INSERT INTO public.evidence_class_rank VALUES ('decode', 0, true, ''), ('receipt', 1, true, ''), ('claim', 3, true, '');
CREATE TABLE public.vehicles (id uuid PRIMARY KEY);
CREATE TABLE public.vehicle_documents (id uuid PRIMARY KEY, vehicle_id uuid REFERENCES public.vehicles (id), document_type text);
CREATE TABLE public.field_evidence (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid REFERENCES public.vehicles (id),
  field_name text, proposed_value text, source_type text, supporting_signals jsonb);
-- fixtures (disposable database only)
INSERT INTO public.vehicles VALUES ('00000000-0000-0000-0000-00000000000a');
INSERT INTO public.vehicle_documents VALUES ('d0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'work_order');
INSERT INTO public.field_evidence (vehicle_id, field_name, proposed_value, source_type, supporting_signals) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'spend:parts:x', '1', 'invoice', '{"qb_id": "qb-1"}');

\ir ../migrations/20261124195800_field_evidence_document_key.sql
\ir ../migrations/20261124195800_field_evidence_document_key.sql

DO $$
DECLARE live_types text[] := ARRAY['receipt', 'invoice', 'books_decision', 'provenance_citation', 'packing_slip', 'work_order',
  'agreement', 'estimate', 'order_confirmation', 'alignment_report', 'other', 'history_file'];
BEGIN
  IF EXISTS (SELECT 1 FROM public.field_evidence WHERE document_id IS NOT NULL) THEN RAISE EXCEPTION 'existing rows must stay NULL'; END IF;
  BEGIN
    INSERT INTO public.field_evidence (vehicle_id, field_name, source_type, document_id)
    VALUES ('00000000-0000-0000-0000-00000000000a', 'x', 'invoice', 'd0000000-0000-0000-0000-0000000000ff');
    RAISE EXCEPTION 'an unknown document was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  INSERT INTO public.field_evidence (vehicle_id, field_name, source_type, document_id)
  VALUES ('00000000-0000-0000-0000-00000000000a', 'x', 'invoice', 'd0000000-0000-0000-0000-000000000001');
  IF NOT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('public.field_evidence_document_id_idx') AND indisvalid) THEN
    RAISE EXCEPTION 'partial index missing or invalid'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(live_types) t WHERE NOT EXISTS (SELECT 1 FROM public.paper_kind_rules r WHERE r.document_type = t)) THEN
    RAISE EXCEPTION 'a live document_type has no rule row'; END IF;
  IF (SELECT establishes FROM public.paper_kind_rules WHERE document_type = 'receipt') <> 'purchase'
     OR (SELECT establishes FROM public.paper_kind_rules WHERE document_type = 'work_order') <> 'current'
     OR (SELECT establishes FROM public.paper_kind_rules WHERE document_type = 'build_sheet') <> 'as_built' THEN
    RAISE EXCEPTION 'paper scopes wrong'; END IF;
  BEGIN
    INSERT INTO public.paper_kind_rules (document_type, evidence_class, establishes, rank, note) VALUES ('x', 'record', 'none', 9, 'x');
    RAISE EXCEPTION 'a class outside evidence_class_rank was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  IF NOT has_table_privilege('anon', 'public.paper_kind_rules', 'SELECT') THEN RAISE EXCEPTION 'anon cannot read the rules'; END IF;
END $$;
\echo field_evidence_document_key: ok
