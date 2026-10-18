-- Isolated PostgreSQL 17 contract for 20261008013000_flag_fabricated_field_evidence.sql. Synthetic rows only; never production.
--   createdb dm_refinement_flag_evidence_ci
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_flag_evidence_ci -f supabase/sql/test_flag_fabricated_field_evidence.sql
-- Fixtures: vehicle_field_evidence with the live columns the writer touches, write_receipts, pipeline_registry, the API
-- roles with Supabase's default function grants. Covered: only the named source_type is flagged, batch honoured, values
-- untouched, metadata merged (object, NULL and non-object cases), one receipt per writing call, idempotent, app.writer
-- restored, bad parameters refused, service_role only, comments and registry, re-apply a no-op.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicle_field_evidence') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '30s';
SET lock_timeout = '3s';
SET TimeZone = 'UTC';
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
-- Six fabricated rows (two vehicles, three fields each, in all three metadata shapes) and two legitimate rows.
INSERT INTO public.vehicle_field_evidence (id, vehicle_id, field_name, value_number, source_type, confidence_score, metadata) VALUES
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'market_value_low',  197700, 'hagerty_instant_quote', 50, '{}'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a1', 'market_value_avg',  296550, 'hagerty_instant_quote', 50, NULL),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000a1', 'market_value_high', 395400, 'hagerty_instant_quote', 50, '["legacy"]'),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000a2', 'market_value_low',  200000, 'hagerty_instant_quote', 50, '{"k": 1}'),
  ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000a2', 'market_value_avg',  300000, 'hagerty_instant_quote', 50, '{}'),
  ('00000000-0000-0000-0000-0000000000e6', '00000000-0000-0000-0000-0000000000a2', 'insurance_value',   360000, 'hagerty_instant_quote', 50, '{}'),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', 'mileage',            84000, 'nhtsa_vin_decode',      90, '{}'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000a2', 'market_value_avg',   42000, 'bat_sale_result',       95, '{}');

\ir ../migrations/20261008013000_flag_fabricated_field_evidence.sql

SELECT pg_temp.ok('the migration flagged nothing by itself', (SELECT count(*) FROM public.vehicle_field_evidence WHERE flagged_as_incorrect) = 0 AND (SELECT count(*) FROM public.write_receipts) = 0);
SELECT pg_temp.fails('an empty reason is refused', $q$SELECT public.flag_fabricated_field_evidence('hagerty_instant_quote', ' ', 10)$q$, '22023');
SELECT pg_temp.fails('an empty source_type is refused', $q$SELECT public.flag_fabricated_field_evidence('', 'r', 10)$q$, '22023');
SELECT pg_temp.fails('a batch of 0 is refused', $q$SELECT public.flag_fabricated_field_evidence('hagerty_instant_quote', 'r', 0)$q$, '22023');
SELECT set_config('app.writer', 'contract-caller', false);
CREATE TEMP TABLE r1 AS SELECT public.flag_fabricated_field_evidence('hagerty_instant_quote', 'placeholder: model year times a constant, no Hagerty key', 4) AS r;
SELECT pg_temp.ok('the first call flagged 4 of 6 fabricated rows with one receipt under its writer',
  (SELECT (r ->> 'flagged')::int = 4 AND r ->> 'source_type' = 'hagerty_instant_quote' FROM r1)
  AND (SELECT count(*) FROM public.vehicle_field_evidence WHERE flagged_as_incorrect) = 4
  AND (SELECT count(*) FROM public.write_receipts) = 1
  AND (SELECT tbl = 'vehicle_field_evidence' AND op = 'UPDATE' AND rows = 4 AND writer = 'flag_fabricated_field_evidence' FROM public.write_receipts));
SELECT pg_temp.ok('app.writer is handed back to the caller', current_setting('app.writer', true) = 'contract-caller');
CREATE TEMP TABLE r2 AS SELECT public.flag_fabricated_field_evidence('hagerty_instant_quote', 'placeholder: model year times a constant, no Hagerty key', 4) AS r;
CREATE TEMP TABLE r3 AS SELECT public.flag_fabricated_field_evidence('hagerty_instant_quote', 'placeholder: model year times a constant, no Hagerty key', 4) AS r;
SELECT pg_temp.ok('the second call flagged the remaining 2; the third flagged 0 and left no receipt',
  (SELECT (r ->> 'flagged')::int = 2 FROM r2) AND (SELECT (r ->> 'flagged')::int = 0 FROM r3)
  AND (SELECT count(*) FROM public.write_receipts) = 2
  AND (SELECT count(*) FROM public.vehicle_field_evidence WHERE flagged_as_incorrect) = 6);
SELECT pg_temp.ok('only the named source_type was flagged; the two legitimate rows are untouched',
  (SELECT bool_and(NOT flagged_as_incorrect AND metadata = '{}'::jsonb) FROM public.vehicle_field_evidence WHERE source_type <> 'hagerty_instant_quote'));
SELECT pg_temp.ok('values are untouched; the metadata record carries at, writer, reason and source_type; object, NULL and non-object metadata handled',
  (SELECT value_number = 197700 AND metadata -> 'flagged_incorrect' ->> 'writer' = 'flag_fabricated_field_evidence'
          AND metadata -> 'flagged_incorrect' ->> 'reason' LIKE 'placeholder%' AND (metadata -> 'flagged_incorrect' ->> 'at')::timestamptz IS NOT NULL
   FROM public.vehicle_field_evidence WHERE id = '00000000-0000-0000-0000-0000000000e1')
  AND (SELECT (SELECT count(*) FROM jsonb_object_keys(metadata)) = 1 FROM public.vehicle_field_evidence WHERE id = '00000000-0000-0000-0000-0000000000e2')
  AND (SELECT metadata -> 'prior' = '["legacy"]'::jsonb FROM public.vehicle_field_evidence WHERE id = '00000000-0000-0000-0000-0000000000e3')
  AND (SELECT metadata -> 'k' = '1'::jsonb AND metadata ? 'flagged_incorrect' FROM public.vehicle_field_evidence WHERE id = '00000000-0000-0000-0000-0000000000e4'));
SELECT pg_temp.ok('the writer is callable by service_role only and is a definer with a fixed search_path',
  has_function_privilege('service_role', 'public.flag_fabricated_field_evidence(text,text,integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.flag_fabricated_field_evidence(text,text,integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.flag_fabricated_field_evidence(text,text,integer)', 'EXECUTE')
  AND (SELECT prosecdef AND 'search_path=public, pg_temp' = ANY (proconfig) FROM pg_proc WHERE oid = 'public.flag_fabricated_field_evidence(text,text,integer)'::regprocedure));
SELECT pg_temp.ok('comments and the registry note are present once',
  obj_description('public.flag_fabricated_field_evidence(text,text,integer)'::regprocedure, 'pg_proc') IS NOT NULL
  AND col_description('public.vehicle_field_evidence'::regclass, (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.vehicle_field_evidence'::regclass AND attname = 'flagged_as_incorrect')) LIKE 'True when a sanctioned correction%'
  AND (SELECT (length(write_via) - length(replace(write_via, 'flag_fabricated_field_evidence', ''))) / length('flag_fabricated_field_evidence') = 1
       FROM public.pipeline_registry WHERE table_name = 'vehicle_field_evidence' AND column_name IS NULL));
CREATE TEMP TABLE before_reapply AS SELECT (SELECT write_via FROM public.pipeline_registry WHERE table_name = 'vehicle_field_evidence' AND column_name IS NULL) AS wv, (SELECT count(*) FROM public.write_receipts) AS n;
\ir ../migrations/20261008013000_flag_fabricated_field_evidence.sql
SELECT pg_temp.ok('re-apply changes nothing', (SELECT wv = (SELECT write_via FROM public.pipeline_registry WHERE table_name = 'vehicle_field_evidence' AND column_name IS NULL) AND n = (SELECT count(*) FROM public.write_receipts) FROM before_reapply));
\echo 'flag fabricated field evidence contract: all checks passed'
