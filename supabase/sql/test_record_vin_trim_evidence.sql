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

CREATE TABLE public.vehicles (id uuid PRIMARY KEY, vin text, trim text, deleted_at timestamptz);
CREATE TABLE public.vin_decoded_data (vin text PRIMARY KEY, trim text);
CREATE TABLE public.field_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid NOT NULL REFERENCES public.vehicles(id),
  field_name text NOT NULL, proposed_value text NOT NULL, source_type text NOT NULL,
  source_confidence integer CHECK (source_confidence BETWEEN 0 AND 100), extraction_context text,
  extracted_at timestamptz DEFAULT now(), status text DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','rejected','conflicted','superseded')),
  assigned_at timestamptz, assigned_by text, raw_extraction_data jsonb, created_at timestamptz DEFAULT now(),
  UNIQUE (vehicle_id, field_name, source_type, proposed_value)
);
CREATE TABLE writer_seen (vehicle_id uuid, writer text);
CREATE FUNCTION public.record_writer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN INSERT INTO writer_seen VALUES (NEW.id, current_setting('app.writer', true)); RETURN NEW; END $$;
CREATE TRIGGER record_writer AFTER UPDATE OF trim ON public.vehicles FOR EACH ROW EXECUTE FUNCTION public.record_writer();

INSERT INTO public.vehicles VALUES
  ('00000000-0000-0000-0000-000000000001', 'WP0AB29966S740001', NULL, NULL),  -- empty trim, single decode
  ('00000000-0000-0000-0000-000000000002', 'WP0CB29926S760002', NULL, NULL),  -- empty trim, decode with drivetrain note
  ('00000000-0000-0000-0000-000000000003', 'WP0AB29986S740003', NULL, NULL),  -- empty trim, decode lists alternatives
  ('00000000-0000-0000-0000-000000000004', 'WP0AB29906S740004', 'Carrera S', NULL),  -- trim disagrees with decode
  ('00000000-0000-0000-0000-000000000005', 'wp0ab29926s740005', 'carrera 4s', NULL), -- trim agrees (case-insensitive, lowercase VIN)
  ('00000000-0000-0000-0000-000000000006', 'WP0AB29946S740006', NULL, now());  -- deleted vehicle
INSERT INTO public.vin_decoded_data VALUES
  ('WP0AB29966S740001', 'Carrera'),
  ('WP0CB29926S760002', 'Turbo Cabriolet (4WD)'),
  ('WP0AB29986S740003', 'S (2WD), 4S (4WD)'),
  ('WP0AB29906S740004', 'Carrera 4'),
  ('WP0AB29926S740005', 'Carrera 4S'),
  ('WP0AB29946S740006', 'GT3');

\ir ../migrations/20261018200000_record_vin_trim_evidence.sql
-- Replay is safe.
\ir ../migrations/20261018200000_record_vin_trim_evidence.sql

CREATE FUNCTION pg_temp.check(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN ASSERT ok IS TRUE, label; END $$;

SELECT pg_temp.check(public.vin_decode_single_trim('Carrera') = 'Carrera', 'single trim kept');
SELECT pg_temp.check(public.vin_decode_single_trim('Turbo Cabriolet (4WD)') = 'Turbo Cabriolet', 'trailing drivetrain note dropped');
SELECT pg_temp.check(public.vin_decode_single_trim('S (2WD), 4S (4WD)') IS NULL, 'comma alternatives skipped');
SELECT pg_temp.check(public.vin_decode_single_trim('Turbo (4WD) / GT2 (2WD)') IS NULL, 'slash alternatives skipped');
SELECT pg_temp.check(public.vin_decode_single_trim('Carrera (2WD + 4WD)') IS NULL, 'plus alternatives skipped');
SELECT pg_temp.check(public.vin_decode_single_trim('  ') IS NULL, 'blank is null');

-- Outside the 1 ms - 60 s window the writer refuses.
DO $$ BEGIN
  SET LOCAL statement_timeout = 0;
  BEGIN
    PERFORM public.record_vin_trim_evidence(NULL, 10);
    RAISE EXCEPTION 'expected refusal';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%statement_timeout%' THEN RAISE; END IF;
  END;
END $$;

BEGIN;
SET LOCAL statement_timeout = '30s';
CREATE TEMP TABLE run1 AS SELECT public.record_vin_trim_evidence(NULL, 100) AS r;
COMMIT;

SELECT pg_temp.check((SELECT (r->>'scanned')::int FROM run1) = 5, 'deleted vehicle not scanned');
SELECT pg_temp.check((SELECT (r->>'single_trim')::int FROM run1) = 4, 'four decodes name a single trim');
SELECT pg_temp.check((SELECT (r->>'trim_filled')::int FROM run1) = 2, 'only empty trims filled');
SELECT pg_temp.check((SELECT trim FROM public.vehicles WHERE id = '00000000-0000-0000-0000-000000000001') = 'Carrera', 'empty trim filled from decode');
SELECT pg_temp.check((SELECT trim FROM public.vehicles WHERE id = '00000000-0000-0000-0000-000000000002') = 'Turbo Cabriolet', 'filled without drivetrain note');
SELECT pg_temp.check((SELECT trim FROM public.vehicles WHERE id = '00000000-0000-0000-0000-000000000003') IS NULL, 'ambiguous decode leaves trim empty');
SELECT pg_temp.check((SELECT trim FROM public.vehicles WHERE id = '00000000-0000-0000-0000-000000000004') = 'Carrera S', 'disagreeing trim kept');
SELECT pg_temp.check((SELECT status FROM public.field_evidence WHERE vehicle_id = '00000000-0000-0000-0000-000000000004') = 'pending', 'disagreement left pending');
SELECT pg_temp.check((SELECT status FROM public.field_evidence WHERE vehicle_id = '00000000-0000-0000-0000-000000000005') = 'accepted', 'agreeing decode accepted');
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM public.field_evidence WHERE vehicle_id = '00000000-0000-0000-0000-000000000003'), 'no evidence for ambiguous decode');
SELECT pg_temp.check((SELECT bool_and(source_type = 'nhtsa_vin_decode' AND extraction_context LIKE 'VIN: %' AND assigned_by = 'record_vin_trim_evidence') FROM public.field_evidence), 'evidence cites the VIN and its writer');
SELECT pg_temp.check((SELECT bool_and(writer = 'record_vin_trim_evidence') FROM writer_seen) AND (SELECT count(*) FROM writer_seen) = 2, 'vehicle writes carry the function''s own writer');

-- A second run writes nothing new.
BEGIN;
SET LOCAL statement_timeout = '30s';
CREATE TEMP TABLE run2 AS SELECT public.record_vin_trim_evidence(NULL, 100) AS r;
COMMIT;
SELECT pg_temp.check((SELECT (r->>'evidence_accepted')::int + (r->>'evidence_pending')::int + (r->>'trim_filled')::int FROM run2) = 0, 'rerun is a no-op');

-- Keyset paging: a batch of 2 resumes after its last id.
BEGIN;
SET LOCAL statement_timeout = '30s';
CREATE TEMP TABLE page AS SELECT public.record_vin_trim_evidence(NULL, 2) AS r;
COMMIT;
SELECT pg_temp.check((SELECT (r->>'last_vehicle_id')::uuid FROM page) = '00000000-0000-0000-0000-000000000002', 'page ends at its last id');

-- Only service_role may execute.
SELECT pg_temp.check(NOT has_function_privilege('anon', 'public.record_vin_trim_evidence(uuid,integer)', 'EXECUTE'), 'anon cannot execute');
SELECT pg_temp.check(NOT has_function_privilege('authenticated', 'public.record_vin_trim_evidence(uuid,integer)', 'EXECUTE'), 'authenticated cannot execute');
SELECT pg_temp.check(has_function_privilege('service_role', 'public.record_vin_trim_evidence(uuid,integer)', 'EXECUTE'), 'service_role can execute');

SELECT 'record_vin_trim_evidence contract passed' AS result;
