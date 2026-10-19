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

CREATE TABLE public.vehicles (id uuid PRIMARY KEY, vin text, model text, title text, trim text, deleted_at timestamptz);
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
CREATE TABLE public.superseded_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_table text NOT NULL, row_id uuid, row_data jsonb,
  superseded_at timestamptz DEFAULT now(), asserted_by text, source jsonb, reason text, restored_at timestamptz
);

-- Pilot cases the first version filled.
INSERT INTO public.vehicles VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'VINSPEEDSTER00001', '911 Speedster', '1989 Porsche 911 Speedster', NULL, NULL),
  ('00000000-0000-0000-0000-0000000000a2', 'VINRAPTOR00000002', 'F-150 SVT Raptor SuperCab', '2010 Ford F-150 SVT Raptor', NULL, NULL),
  ('00000000-0000-0000-0000-0000000000a3', 'VINGT3RS000000003', '911', '2023 Porsche 911', NULL, NULL),
  ('00000000-0000-0000-0000-0000000000a4', 'VINFTYPER00000004', 'F-Type R Coupe', '2015 Jaguar F-Type R Coupe', NULL, NULL);
INSERT INTO public.vin_decoded_data VALUES
  ('VINSPEEDSTER00001', 'Carrera'),
  ('VINRAPTOR00000002', 'Styleside'),
  ('VINGT3RS000000003', 'GT3 RS'),
  ('VINFTYPER00000004', 'R');

\ir ../migrations/20261018200000_record_vin_trim_evidence.sql
BEGIN;
SET LOCAL statement_timeout = '30s';
SELECT public.record_vin_trim_evidence(NULL, 100);
COMMIT;

CREATE FUNCTION pg_temp.check(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN ASSERT ok IS TRUE, label; END $$;
SELECT pg_temp.check((SELECT count(*) FROM public.vehicles WHERE trim IS NOT NULL) = 4, 'first version filled all four');

\ir ../migrations/20261018210000_vin_trim_corroboration.sql
-- Replay is safe.
\ir ../migrations/20261018210000_vin_trim_corroboration.sql

SELECT pg_temp.check((SELECT trim FROM public.vehicles WHERE id = '00000000-0000-0000-0000-0000000000a1') IS NULL, 'uncorroborated Carrera on a Speedster undone');
SELECT pg_temp.check((SELECT trim FROM public.vehicles WHERE id = '00000000-0000-0000-0000-0000000000a2') IS NULL, 'body word Styleside undone');
SELECT pg_temp.check((SELECT trim FROM public.vehicles WHERE id = '00000000-0000-0000-0000-0000000000a3') = 'GT3 RS', 'bare model fill kept');
SELECT pg_temp.check((SELECT trim FROM public.vehicles WHERE id = '00000000-0000-0000-0000-0000000000a4') = 'R', 'corroborated fill kept');
SELECT pg_temp.check((SELECT count(*) FROM public.superseded_rows) = 2, 'each undone fill recorded once, also on replay');
SELECT pg_temp.check((SELECT bool_and(row_data ->> 'field' = 'trim' AND source_table = 'vehicles') FROM public.superseded_rows), 'superseded rows name the field');
SELECT pg_temp.check((SELECT status FROM public.field_evidence WHERE vehicle_id = '00000000-0000-0000-0000-0000000000a1') = 'pending', 'undone evidence back to pending');

SELECT pg_temp.check(public.vin_decode_single_trim('Styleside') IS NULL, 'bed style is not a trim');
SELECT pg_temp.check(public.vin_decode_single_trim('Cabriolet (4WD)') IS NULL, 'body word with drivetrain note is not a trim');
SELECT pg_temp.check(public.vin_decode_single_trim('Turbo Cabriolet (4WD)') = 'Turbo Cabriolet', 'trim containing a body word kept');
SELECT pg_temp.check(public.vin_trim_corroborated('V', 'CTS-V', NULL), 'single-letter trim matched as a word');
SELECT pg_temp.check(NOT public.vin_trim_corroborated('R', '911 Carrera', '1999 Porsche 911 Carrera Coupe'), 'letter inside a word is not a match');
SELECT pg_temp.check(public.vin_trim_corroborated('Deluxe', 'Tacoma', NULL), 'bare one-word model accepts the decode');

-- New vehicles: uncorroborated decode becomes pending evidence without a fill.
INSERT INTO public.vehicles VALUES
  ('00000000-0000-0000-0000-0000000000b1', 'VINQUATTRO0000001', 'tt roadster', '2001 Audi TT Roadster', NULL, NULL);
INSERT INTO public.vin_decoded_data VALUES ('VINQUATTRO0000001', 'quattro');
BEGIN;
SET LOCAL statement_timeout = '30s';
CREATE TEMP TABLE run AS SELECT public.record_vin_trim_evidence('00000000-0000-0000-0000-0000000000a4', 100) AS r;
COMMIT;
SELECT pg_temp.check((SELECT (r->>'trim_filled')::int FROM run) = 0, 'uncorroborated decode not filled');
SELECT pg_temp.check((SELECT status FROM public.field_evidence WHERE vehicle_id = '00000000-0000-0000-0000-0000000000b1') = 'pending', 'uncorroborated decode pending');

SELECT pg_temp.check(NOT has_function_privilege('anon', 'public.vin_trim_corroborated(text,text,text)', 'EXECUTE'), 'anon cannot execute');

SELECT 'vin_trim_corroboration contract passed' AS result;
