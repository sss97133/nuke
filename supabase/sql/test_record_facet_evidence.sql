-- Empty disposable PG17 dm_refinement_* database only; no production fixtures.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable dm_refinement_* database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;

CREATE TABLE public.vehicles (id uuid PRIMARY KEY, series text, trim text, body_style text, listing_title text, title text);
CREATE TABLE public.pipeline_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_name text NOT NULL, column_name text, owned_by text NOT NULL,
  description text NOT NULL, valid_values text[], do_not_write_directly boolean NOT NULL DEFAULT false, write_via text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.field_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid NOT NULL REFERENCES public.vehicles(id),
  field_name text NOT NULL, proposed_value text NOT NULL, source_type text NOT NULL,
  source_confidence integer CHECK (source_confidence BETWEEN 0 AND 100), extraction_context text,
  extracted_at timestamptz DEFAULT now(), status text DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','rejected','conflicted','superseded')),
  assigned_at timestamptz, assigned_by text, raw_extraction_data jsonb, created_at timestamptz DEFAULT now(),
  UNIQUE (vehicle_id, field_name, source_type, proposed_value)
);
CREATE TABLE public.superseded_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_table text NOT NULL, row_id uuid, row_data jsonb,
  superseded_at timestamptz DEFAULT now(), asserted_by text, source jsonb, reason text, restored_at timestamptz
);
CREATE TABLE writer_seen (vehicle_id uuid, writer text);
CREATE FUNCTION public.record_writer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN INSERT INTO writer_seen VALUES (NEW.id, current_setting('app.writer', true)); RETURN NEW; END $$;
CREATE TRIGGER record_writer AFTER UPDATE ON public.vehicles FOR EACH ROW EXECUTE FUNCTION public.record_writer();

INSERT INTO public.vehicles (id, series, trim, body_style, listing_title) VALUES
  ('00000000-0000-0000-0000-000000000001', NULL, NULL, NULL, '1979 Chevrolet Camaro Z/28 - 4-Speed'), -- empty: fill from stored title
  ('00000000-0000-0000-0000-000000000002', NULL, 'Silverado', NULL, '1985 Chevrolet C10 Cheyenne'),   -- trim already set
  ('00000000-0000-0000-0000-000000000003', 'E90/E92/E93', NULL, 'Coupe', NULL), -- narrow to E92
  ('00000000-0000-0000-0000-000000000004', 'E36/7 / E36/8', NULL, NULL, NULL),  -- narrow with internal slashes
  ('00000000-0000-0000-0000-000000000005', 'E90/E92/E93 M3', NULL, NULL, NULL), -- narrow keeping the M3 suffix
  ('00000000-0000-0000-0000-000000000006', 'E90/E92/E93', NULL, NULL, NULL),    -- stale expected value
  ('00000000-0000-0000-0000-000000000007', 'W212', NULL, NULL, NULL),           -- not a range: no narrowing
  ('00000000-0000-0000-0000-000000000008', NULL, NULL, NULL, '1984 Chevrolet C10 Pickup'),               -- caller cites a title the record does not hold
  ('00000000-0000-0000-0000-000000000009', NULL, NULL, NULL, '1966 Ford Mustang Shelby GT350 Replica'),  -- replica title
  ('00000000-0000-0000-0000-000000000010', NULL, NULL, NULL, '1967 Chevrolet Corvette 427/435 Short Bed'); -- engine and bed words

\ir ../migrations/20261018220000_record_facet_evidence.sql
\ir ../migrations/20261019000000_facet_evidence_stored_title.sql
\ir ../migrations/20261019000000_facet_evidence_stored_title.sql

CREATE FUNCTION pg_temp.check(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN ASSERT ok IS TRUE, label; END $$;
CREATE FUNCTION pg_temp.call(p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('statement_timeout', '30s', true); RETURN public.record_facet_evidence(p); END $$;

-- Refusals.
DO $$ BEGIN
  BEGIN PERFORM pg_temp.call('[{"vehicle_id":"00000000-0000-0000-0000-000000000001","field":"color","value":"Red","source_type":"cars_and_bids_listing"}]');
        RAISE EXCEPTION 'expected refusal'; EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%field must be%' THEN RAISE; END IF; END;
  BEGIN PERFORM pg_temp.call('[{"vehicle_id":"00000000-0000-0000-0000-000000000001","field":"trim","value":"GT","source_type":"made_up"}]');
        RAISE EXCEPTION 'expected refusal'; EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%source_type must be%' THEN RAISE; END IF; END;
  BEGIN PERFORM pg_temp.call('[{"vehicle_id":"00000000-0000-0000-0000-000000000001","field":"series","value":"996","source_type":"derived_chassis_rule"}]');
        RAISE EXCEPTION 'expected refusal'; EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%derivation%' THEN RAISE; END IF; END;
  BEGIN PERFORM pg_temp.call('[{"vehicle_id":"00000000-0000-0000-0000-000000000001","field":"trim","value":"GT","source_type":"cars_and_bids_listing","narrow":true}]');
        RAISE EXCEPTION 'expected refusal'; EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%only series%' THEN RAISE; END IF; END;
END $$;

CREATE TEMP TABLE r AS SELECT pg_temp.call($j$[
  {"vehicle_id":"00000000-0000-0000-0000-000000000001","field":"trim","value":"Z/28","source_type":"cars_and_bids_listing","cited_title":"1979 Chevrolet Camaro Z/28 - 4-Speed"},
  {"vehicle_id":"00000000-0000-0000-0000-000000000001","field":"series","value":"2nd Gen","source_type":"derived_chassis_rule","derivation":"year 1970-1981 Camaro"},
  {"vehicle_id":"00000000-0000-0000-0000-000000000001","field":"body_style","value":"Coupe","source_type":"cars_and_bids_listing","cited_title":"1979 Chevrolet Camaro Z/28 - 4-Speed"},
  {"vehicle_id":"00000000-0000-0000-0000-000000000002","field":"trim","value":"Cheyenne","source_type":"cars_and_bids_listing","cited_title":"1985 Chevrolet C10 Cheyenne"},
  {"vehicle_id":"00000000-0000-0000-0000-000000000003","field":"series","value":"E92","source_type":"derived_chassis_rule","derivation":"E9x body code from Coupe","expected_live":"E90/E92/E93","narrow":true},
  {"vehicle_id":"00000000-0000-0000-0000-000000000004","field":"series","value":"E36/8","source_type":"derived_chassis_rule","derivation":"E36 Z3 coupe","expected_live":"E36/7 / E36/8","narrow":true},
  {"vehicle_id":"00000000-0000-0000-0000-000000000005","field":"series","value":"E92 M3","source_type":"derived_chassis_rule","derivation":"E9x M3 coupe","expected_live":"E90/E92/E93 M3","narrow":true},
  {"vehicle_id":"00000000-0000-0000-0000-000000000006","field":"series","value":"E92","source_type":"derived_chassis_rule","derivation":"x","expected_live":"E46","narrow":true},
  {"vehicle_id":"00000000-0000-0000-0000-000000000007","field":"series","value":"W211","source_type":"derived_chassis_rule","derivation":"x","expected_live":"W212","narrow":true}
]$j$::jsonb) AS out;

SELECT pg_temp.check((SELECT trim FROM public.vehicles WHERE id='00000000-0000-0000-0000-000000000001') = 'Z/28', 'cited trim fills an empty trim');
SELECT pg_temp.check((SELECT series FROM public.vehicles WHERE id='00000000-0000-0000-0000-000000000001') IS NULL, 'derived series does not fill');
SELECT pg_temp.check((SELECT body_style FROM public.vehicles WHERE id='00000000-0000-0000-0000-000000000001') IS NULL, 'body word absent from title does not fill');
SELECT pg_temp.check((SELECT trim FROM public.vehicles WHERE id='00000000-0000-0000-0000-000000000002') = 'Silverado', 'set trim not overwritten');
SELECT pg_temp.check((SELECT status FROM public.field_evidence WHERE vehicle_id='00000000-0000-0000-0000-000000000002') = 'accepted', 'cited disagreeing value recorded as accepted evidence');
SELECT pg_temp.check((SELECT series FROM public.vehicles WHERE id='00000000-0000-0000-0000-000000000003') = 'E92', 'range narrowed');
SELECT pg_temp.check((SELECT series FROM public.vehicles WHERE id='00000000-0000-0000-0000-000000000004') = 'E36/8', 'range with internal slashes narrowed');
SELECT pg_temp.check((SELECT series FROM public.vehicles WHERE id='00000000-0000-0000-0000-000000000005') = 'E92 M3', 'suffix kept when narrowing');
SELECT pg_temp.check((SELECT series FROM public.vehicles WHERE id='00000000-0000-0000-0000-000000000006') = 'E90/E92/E93', 'stale expected value refused');
SELECT pg_temp.check((SELECT series FROM public.vehicles WHERE id='00000000-0000-0000-0000-000000000007') = 'W212', 'single code not narrowed');
SELECT pg_temp.check((SELECT count(*) FROM public.superseded_rows) = 3, 'each narrowing recorded');
SELECT pg_temp.check((SELECT (out->>'narrowed')::int = 3 AND (out->>'filled')::int = 1 FROM r), 'counts reported');
SELECT pg_temp.check((SELECT status FROM public.field_evidence WHERE vehicle_id='00000000-0000-0000-0000-000000000001' AND field_name='series') = 'pending'
                     AND (SELECT source_confidence FROM public.field_evidence WHERE vehicle_id='00000000-0000-0000-0000-000000000001' AND field_name='series') = 55, 'derived evidence pending at 55');
SELECT pg_temp.check((SELECT bool_and(writer = 'record_facet_evidence') FROM writer_seen), 'vehicle writes carry the writer');

-- The stored title decides, not the caller's string; copies, engines and bed or cab words stay pending.
CREATE TEMP TABLE r3 AS SELECT pg_temp.call($j$[
  {"vehicle_id":"00000000-0000-0000-0000-000000000008","field":"trim","value":"Silverado","source_type":"mecum_listing","cited_title":"1984 Chevrolet C10 Silverado Pickup"},
  {"vehicle_id":"00000000-0000-0000-0000-000000000009","field":"trim","value":"GT350","source_type":"mecum_listing","cited_title":"1966 Ford Mustang Shelby GT350 Replica"},
  {"vehicle_id":"00000000-0000-0000-0000-000000000010","field":"trim","value":"427/435","source_type":"mecum_listing"},
  {"vehicle_id":"00000000-0000-0000-0000-000000000010","field":"body_style","value":"Short Bed","source_type":"mecum_listing"}
]$j$::jsonb) AS out;
SELECT pg_temp.check((SELECT trim FROM public.vehicles WHERE id='00000000-0000-0000-0000-000000000008') IS NULL
  AND (SELECT status FROM public.field_evidence WHERE vehicle_id='00000000-0000-0000-0000-000000000008') = 'pending',
  'a value only in the caller''s cited string stays pending');
SELECT pg_temp.check((SELECT raw_extraction_data->>'caller_cited_title' FROM public.field_evidence WHERE vehicle_id='00000000-0000-0000-0000-000000000008')
  = '1984 Chevrolet C10 Silverado Pickup', 'the caller''s string is kept as context');
SELECT pg_temp.check((SELECT trim FROM public.vehicles WHERE id='00000000-0000-0000-0000-000000000009') IS NULL, 'a replica title does not fill a trim');
SELECT pg_temp.check((SELECT trim FROM public.vehicles WHERE id='00000000-0000-0000-0000-000000000010') IS NULL
  AND (SELECT body_style FROM public.vehicles WHERE id='00000000-0000-0000-0000-000000000010') IS NULL, 'engine trim and bed body stay pending');
SELECT pg_temp.check((SELECT (out->>'filled')::int = 0 AND (out->>'evidence_pending')::int = 4 FROM r3), 'four pending, nothing filled');
SELECT pg_temp.check((SELECT count(*) FROM public.pipeline_registry WHERE table_name='vehicles' AND owned_by='record_facet_evidence') = 3,
  'series, trim and body_style registered once to their writer');

-- Rerun records nothing new and narrows nothing.
CREATE TEMP TABLE r2 AS SELECT pg_temp.call($j$[
  {"vehicle_id":"00000000-0000-0000-0000-000000000003","field":"series","value":"E92","source_type":"derived_chassis_rule","derivation":"E9x body code from Coupe","expected_live":"E90/E92/E93","narrow":true}
]$j$::jsonb) AS out;
SELECT pg_temp.check((SELECT (out->>'narrowed')::int FROM r2) = 0, 'rerun narrows nothing');

SELECT pg_temp.check(NOT has_function_privilege('anon', 'public.record_facet_evidence(jsonb)', 'EXECUTE'), 'anon cannot execute');
SELECT pg_temp.check(has_function_privilege('service_role', 'public.record_facet_evidence(jsonb)', 'EXECUTE'), 'service_role can execute');

SELECT 'record_facet_evidence contract passed' AS result;
