-- Isolated PostgreSQL 17 contract for 20261008015000 (replays 20261008013000 first). Synthetic rows only.
--   createdb dm_refinement_flag_evidence_value_ci
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_flag_evidence_value_ci -f supabase/sql/test_flag_fabricated_field_evidence_value_predicate.sql
-- Covered: the four-argument form replaces the three-argument one; without p_value_text the old behaviour holds; with it
-- only rows whose value_text matches are flagged and the record carries value_text; real decode rows untouched; receipts;
-- idempotent; empty p_value_text refused; service_role only; re-apply a no-op.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicle_field_evidence') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '30s';
SET lock_timeout = '3s';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;
CREATE FUNCTION pg_temp.fails(label text, stmt text, want_state text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE got text;
BEGIN
  BEGIN EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    got := SQLSTATE;
    IF got <> want_state THEN RAISE EXCEPTION 'Contract failed: % raised % (%), wanted %', label, got, SQLERRM, want_state; END IF;
    RAISE NOTICE 'PASS % (refused %)', label, got; RETURN;
  END;
  RAISE EXCEPTION 'Contract failed: % was admitted', label;
END $$;
CREATE TABLE public.vehicle_field_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, field_name text, value_text text, value_number numeric,
  source_type text, source_id uuid, confidence_score integer, flagged_as_incorrect boolean DEFAULT false, metadata jsonb,
  created_at timestamptz DEFAULT now());
CREATE TABLE public.write_receipts (
  id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), tbl text NOT NULL, op text NOT NULL, rows integer,
  writer text, db_role text, app_name text, txid bigint);
CREATE TABLE public.pipeline_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_name text NOT NULL, column_name text,
  owned_by text NOT NULL, description text NOT NULL, valid_values text[],
  do_not_write_directly boolean NOT NULL DEFAULT false, write_via text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (table_name, column_name));
INSERT INTO public.pipeline_registry (table_name, column_name, owned_by, description, do_not_write_directly, write_via) VALUES
  ('vehicle_field_evidence', NULL, 'photo-pipeline-orchestrator', 'Field-level evidence per vehicle.', true, 'photo-pipeline-orchestrator (upsert).');
INSERT INTO public.vehicle_field_evidence (id, vehicle_id, field_name, value_text, value_number, source_type, confidence_score, metadata) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'displacement', 'undefined', NULL, 'nhtsa_vin_decode', 90, '{}'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a1', 'fuel_type',    'undefined', NULL, 'nhtsa_vin_decode', 90, NULL),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000a1', 'make',         'HONDA',     NULL, 'nhtsa_vin_decode', 90, '{}'),
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000a2', 'model_year',   '2003',      2003, 'nhtsa_vin_decode', 90, '{}'),
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'market_value_low', NULL, 197700, 'hagerty_instant_quote', 50, '{}'),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a2', 'notes', 'undefined', NULL, 'owner_submission', 95, '{}');

\ir ../migrations/20261008013000_flag_fabricated_field_evidence.sql
\ir ../migrations/20261008015000_flag_fabricated_field_evidence_value_predicate.sql

SELECT pg_temp.ok('one function remains, with four arguments',
  (SELECT count(*) FROM pg_proc WHERE proname = 'flag_fabricated_field_evidence') = 1
  AND (SELECT pronargs FROM pg_proc WHERE proname = 'flag_fabricated_field_evidence') = 4);
SELECT pg_temp.fails('an empty p_value_text is refused', $q$SELECT public.flag_fabricated_field_evidence('nhtsa_vin_decode', 'r', 10, '')$q$, '22023');
CREATE TEMP TABLE r1 AS SELECT public.flag_fabricated_field_evidence('nhtsa_vin_decode', 'literal undefined: the adapter read a missing field', 10, 'undefined') AS r;
SELECT pg_temp.ok('with the value predicate only the two undefined nhtsa rows are flagged; real decode rows and other sources untouched',
  (SELECT (r ->> 'flagged')::int = 2 AND r ->> 'value_text' = 'undefined' FROM r1)
  AND (SELECT count(*) FROM public.vehicle_field_evidence WHERE flagged_as_incorrect) = 2
  AND (SELECT bool_and(flagged_as_incorrect) FROM public.vehicle_field_evidence WHERE id IN ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d2'))
  AND (SELECT bool_and(NOT flagged_as_incorrect) FROM public.vehicle_field_evidence WHERE id IN ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1')));
SELECT pg_temp.ok('the record carries value_text; values untouched; one receipt',
  (SELECT metadata -> 'flagged_incorrect' ->> 'value_text' = 'undefined' AND value_text = 'undefined' FROM public.vehicle_field_evidence WHERE id = '00000000-0000-0000-0000-0000000000d1')
  AND (SELECT count(*) FROM public.write_receipts) = 1 AND (SELECT rows FROM public.write_receipts) = 2);
CREATE TEMP TABLE r2 AS SELECT public.flag_fabricated_field_evidence('nhtsa_vin_decode', 'literal undefined: the adapter read a missing field', 10, 'undefined') AS r;
SELECT pg_temp.ok('idempotent: a second call flags 0 and leaves no receipt', (SELECT (r ->> 'flagged')::int = 0 FROM r2) AND (SELECT count(*) FROM public.write_receipts) = 1);
CREATE TEMP TABLE r3 AS SELECT public.flag_fabricated_field_evidence('hagerty_instant_quote', 'placeholder', 10) AS r;
SELECT pg_temp.ok('without the value predicate the old behaviour holds (source_type only) and the record has no value_text key',
  (SELECT (r ->> 'flagged')::int = 1 FROM r3)
  AND (SELECT flagged_as_incorrect AND NOT (metadata -> 'flagged_incorrect' ? 'value_text') FROM public.vehicle_field_evidence WHERE id = '00000000-0000-0000-0000-0000000000e1'));
SELECT pg_temp.ok('service_role only, definer, fixed search_path',
  has_function_privilege('service_role', 'public.flag_fabricated_field_evidence(text,text,integer,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.flag_fabricated_field_evidence(text,text,integer,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.flag_fabricated_field_evidence(text,text,integer,text)', 'EXECUTE')
  AND (SELECT prosecdef AND 'search_path=public, pg_temp' = ANY (proconfig) FROM pg_proc WHERE proname = 'flag_fabricated_field_evidence'));
\ir ../migrations/20261008015000_flag_fabricated_field_evidence_value_predicate.sql
SELECT pg_temp.ok('re-apply changes nothing', (SELECT count(*) FROM pg_proc WHERE proname = 'flag_fabricated_field_evidence') = 1 AND (SELECT count(*) FROM public.write_receipts) = 2);
\echo 'flag fabricated field evidence value predicate contract: all checks passed'
