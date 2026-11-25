-- Contract for 20261124195800_field_evidence_document_key (empty disposable PG17). Asserts: the backfill keys paper rows
-- by key equality only (payment, manifest; a row whose key resolves nowhere and a row with no key stay NULL; a name in
-- text never keys); the arc is exclusive (CHECK) and every arc foreign key refuses an unknown target; the insert trigger
-- sets the arc from a real key and leaves an explicit arc alone; constraints are validated; paper_kind_rules ranks by
-- arc and kind (a payment establishes a purchase, never a spec); anon reads the rules; idempotent.
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
CREATE TABLE public.qb_transactions (id uuid PRIMARY KEY, qb_id text UNIQUE, qb_type text, vehicle_id uuid REFERENCES public.vehicles (id));
CREATE TABLE public.vehicle_build_manifest (id uuid PRIMARY KEY, vehicle_id uuid REFERENCES public.vehicles (id), evidence_level text);
CREATE TABLE public.field_evidence (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid REFERENCES public.vehicles (id),
  field_name text, proposed_value text, source_type text, supporting_signals jsonb, raw_extraction_data jsonb);
-- fixtures (disposable database only)
INSERT INTO public.vehicles VALUES ('00000000-0000-0000-0000-00000000000a');
INSERT INTO public.vehicle_documents VALUES ('d0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'work_order');
INSERT INTO public.qb_transactions VALUES ('a0000000-0000-0000-0000-000000000001', 'qb-1', 'Purchase', '00000000-0000-0000-0000-00000000000a');
INSERT INTO public.vehicle_build_manifest VALUES ('b0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'invoice_proven');
INSERT INTO public.field_evidence (id, vehicle_id, field_name, proposed_value, source_type, supporting_signals) VALUES
  ('f0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'spend:a', '1', 'quickbooks', '{"qb_id": "qb-1"}'),
  ('f0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', 'component:b', '1', 'invoice', '{"manifest_id": "b0000000-0000-0000-0000-000000000001"}'),
  ('f0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a', 'spend:c', '1', 'email_receipt', '{"qb_id": "qb-unknown"}'),
  ('f0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-00000000000a', 'spend:d', '1', 'invoice', '{"vendor": "work_order"}'),
  ('f0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-00000000000a', 'engine', 'x', 'bat_listing', '{"qb_id": "qb-1"}');

\ir ../migrations/20261124195800_field_evidence_document_key.sql
\ir ../migrations/20261124195800_field_evidence_document_key.sql

DO $$
DECLARE fe record;
BEGIN
  -- backfill: by key equality only, paper-class rows only
  SELECT * INTO fe FROM public.field_evidence WHERE id = 'f0000000-0000-0000-0000-000000000001';
  IF fe.qb_transaction_id IS DISTINCT FROM 'a0000000-0000-0000-0000-000000000001' OR fe.document_id IS NOT NULL OR fe.build_manifest_id IS NOT NULL THEN
    RAISE EXCEPTION 'qb row not keyed: %', row_to_json(fe); END IF;
  SELECT * INTO fe FROM public.field_evidence WHERE id = 'f0000000-0000-0000-0000-000000000002';
  IF fe.build_manifest_id IS DISTINCT FROM 'b0000000-0000-0000-0000-000000000001' THEN RAISE EXCEPTION 'manifest row not keyed'; END IF;
  IF EXISTS (SELECT 1 FROM public.field_evidence WHERE id IN ('f0000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000004',
               'f0000000-0000-0000-0000-000000000005') AND num_nonnulls(document_id, qb_transaction_id, build_manifest_id) > 0) THEN
    RAISE EXCEPTION 'an unresolved key, a text name or a non-paper row was keyed'; END IF;

  -- the arc is exclusive and every arc refuses an unknown target
  BEGIN
    UPDATE public.field_evidence SET document_id = 'd0000000-0000-0000-0000-000000000001' WHERE id = 'f0000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'two arcs were accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.field_evidence (vehicle_id, field_name, source_type, qb_transaction_id)
    VALUES ('00000000-0000-0000-0000-00000000000a', 'x', 'quickbooks', 'a0000000-0000-0000-0000-0000000000ff');
    RAISE EXCEPTION 'an unknown payment was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.field_evidence (vehicle_id, field_name, source_type, build_manifest_id)
    VALUES ('00000000-0000-0000-0000-00000000000a', 'x', 'invoice', 'b0000000-0000-0000-0000-0000000000ff');
    RAISE EXCEPTION 'an unknown manifest row was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.field_evidence (vehicle_id, field_name, source_type, document_id)
    VALUES ('00000000-0000-0000-0000-00000000000a', 'x', 'invoice', 'd0000000-0000-0000-0000-0000000000ff');
    RAISE EXCEPTION 'an unknown document was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  -- the insert trigger lands the edge from a real key, prefers a document, and leaves an explicit arc alone
  INSERT INTO public.field_evidence (id, vehicle_id, field_name, source_type, supporting_signals, raw_extraction_data) VALUES
    ('f0000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-00000000000a', 'y', 'quickbooks', '{"qb_id": "qb-1"}', NULL),
    ('f0000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-00000000000a', 'y', 'invoice', '{"qb_id": "qb-1"}',
     '{"document_id": "d0000000-0000-0000-0000-000000000001"}');
  INSERT INTO public.field_evidence (id, vehicle_id, field_name, source_type, supporting_signals, build_manifest_id) VALUES
    ('f0000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-00000000000a', 'y', 'invoice', '{"qb_id": "qb-1"}',
     'b0000000-0000-0000-0000-000000000001');
  IF (SELECT qb_transaction_id FROM public.field_evidence WHERE id = 'f0000000-0000-0000-0000-000000000010') IS DISTINCT FROM 'a0000000-0000-0000-0000-000000000001'
     OR (SELECT document_id FROM public.field_evidence WHERE id = 'f0000000-0000-0000-0000-000000000011') IS DISTINCT FROM 'd0000000-0000-0000-0000-000000000001'
     OR (SELECT qb_transaction_id FROM public.field_evidence WHERE id = 'f0000000-0000-0000-0000-000000000011') IS NOT NULL
     OR (SELECT num_nonnulls(document_id, qb_transaction_id) FROM public.field_evidence WHERE id = 'f0000000-0000-0000-0000-000000000012') <> 0 THEN
    RAISE EXCEPTION 'insert trigger arc wrong'; END IF;

  -- constraints validated
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.field_evidence'::regclass AND NOT convalidated
               AND conname IN ('field_evidence_paper_arc_one', 'field_evidence_document_id_fkey', 'field_evidence_qb_transaction_id_fkey',
                               'field_evidence_build_manifest_id_fkey')) THEN RAISE EXCEPTION 'a constraint is not validated'; END IF;

  -- the rules
  IF (SELECT establishes FROM public.paper_kind_rules WHERE arc = 'qb_transaction' AND kind = 'Purchase') <> 'purchase'
     OR (SELECT establishes FROM public.paper_kind_rules WHERE arc = 'document' AND kind = 'work_order') <> 'current'
     OR (SELECT establishes FROM public.paper_kind_rules WHERE arc = 'document' AND kind = 'build_sheet') <> 'as_built'
     OR (SELECT evidence_class FROM public.paper_kind_rules WHERE arc = 'build_manifest' AND kind = 'invoice_proven') <> 'claim'
     OR EXISTS (SELECT 1 FROM public.paper_kind_rules WHERE arc IN ('qb_transaction', 'build_manifest') AND establishes IN ('current', 'as_built')) THEN
    RAISE EXCEPTION 'paper scopes wrong'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['Purchase', 'Deposit', 'Invoice']) k
              WHERE NOT EXISTS (SELECT 1 FROM public.paper_kind_rules r WHERE r.arc = 'qb_transaction' AND r.kind = k))
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['qb_matched', 'invoice_proven', 'assumed']) k
              WHERE NOT EXISTS (SELECT 1 FROM public.paper_kind_rules r WHERE r.arc = 'build_manifest' AND r.kind = k))
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['receipt', 'invoice', 'books_decision', 'provenance_citation', 'packing_slip', 'work_order',
                 'agreement', 'estimate', 'order_confirmation', 'alignment_report', 'other', 'history_file']) k
              WHERE NOT EXISTS (SELECT 1 FROM public.paper_kind_rules r WHERE r.arc = 'document' AND r.kind = k)) THEN
    RAISE EXCEPTION 'a live kind has no rule row'; END IF;
  IF NOT has_table_privilege('anon', 'public.paper_kind_rules', 'SELECT') THEN RAISE EXCEPTION 'anon cannot read the rules'; END IF;
END $$;
\echo field_evidence_document_key: ok
