-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_text_field -f this-file.sql
-- Proves correct_vehicle_text_field, the sanctioned writer for a vehicle's descriptive text fields: which fields it
-- accepts (engine_type and engine_code since 20261110090000), the cited source and reason it demands, the stale
-- check, the prior value kept in superseded_rows, and that only service_role may execute it.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

-- The two tables the writer touches, in the live shape it uses.
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY, vin text, body_style text, series text, trim text, notes text, engine_type text, engine_code text);
CREATE TABLE public.superseded_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_table text NOT NULL, row_id uuid NOT NULL, row_data jsonb NOT NULL,
  superseded_at timestamptz NOT NULL DEFAULT now(), asserted_by text NOT NULL, source jsonb NOT NULL, reason text NOT NULL,
  restored_at timestamptz);

\ir ../migrations/20261104000000_correct_vehicle_text_field.sql
\ir ../migrations/20261110090000_tribute_badges_and_engine_correction.sql
\ir ../migrations/20261110090000_tribute_badges_and_engine_correction.sql

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
CREATE FUNCTION public.t_error(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;

INSERT INTO public.vehicles (id, vin, trim, engine_type) VALUES
 ('10000000-0000-0000-0000-000000000001', '2S87D3N143591', 'TRANS AM', 'SD-455');

SET statement_timeout = '5s';
DO $$
DECLARE r jsonb;
  src CONSTANT jsonb := '{"type":"receipt","ref":"ebe76e24-0000-4000-8000-000000000000","title":"Atomic Motors work order 9810: 1970 Pontiac block, engine 455","asserted_by":"contract"}';
BEGIN
  -- engine_type is correctable, with the prior value kept.
  r := public.correct_vehicle_text_field('10000000-0000-0000-0000-000000000001', 'engine_type', 'SD-455', '455 V8', src,
         'The receipts show a 455 built on a 1970 block; SD-455 names the 1973-74 Super Duty engine.');
  PERFORM public.t_assert(r->>'status' = 'corrected' AND r->>'was' = 'SD-455' AND r->>'now' = '455 V8', format('engine_type corrected; got %s', r));
  PERFORM public.t_assert((SELECT engine_type FROM public.vehicles WHERE id = '10000000-0000-0000-0000-000000000001') = '455 V8', 'engine_type now reads 455 V8');
  PERFORM public.t_assert((SELECT count(*) FROM public.superseded_rows s WHERE s.source_table = 'vehicles' AND s.row_id = '10000000-0000-0000-0000-000000000001'
            AND s.row_data->>'field' = 'engine_type' AND s.row_data->>'value' = 'SD-455' AND s.row_data->>'replacement' = '455 V8'
            AND s.source = src AND s.asserted_by = 'contract') = 1, 'the prior engine_type is kept in superseded_rows with its source');

  -- The stale check: the expected value must be the live one.
  r := public.correct_vehicle_text_field('10000000-0000-0000-0000-000000000001', 'engine_type', 'SD-455', '455 V8', src, 'repeat of the same correction');
  PERFORM public.t_assert(r->>'status' = 'stale' AND r->>'live' = '455 V8', format('a stale expectation is refused; got %s', r));

  -- engine_code is correctable too; a VIN is not (its own writer exists).
  r := public.correct_vehicle_text_field('10000000-0000-0000-0000-000000000001', 'engine_code', NULL, 'YH', src, 'block casting read on the engine');
  PERFORM public.t_assert(r->>'status' = 'corrected' AND r->>'now' = 'YH', format('engine_code corrected; got %s', r));
  PERFORM public.t_assert(public.t_error($q$SELECT public.correct_vehicle_text_field('10000000-0000-0000-0000-000000000001', 'vin', '2S87D3N143591', 'X', '{"type":"t","ref":"r","title":"t"}', 'ten characters long')$q$)
            LIKE '%not correctable%', 'vin is not correctable here');
  PERFORM public.t_assert(public.t_error($q$SELECT public.correct_vehicle_text_field('10000000-0000-0000-0000-000000000001', 'trim', 'TRANS AM', 'Trans Am', '{"type":"t"}', 'ten characters long')$q$)
            LIKE '%no cited source%', 'a source without ref and title is refused');
  PERFORM public.t_assert(public.t_error($q$SELECT public.correct_vehicle_text_field('10000000-0000-0000-0000-000000000001', 'trim', 'TRANS AM', 'Trans Am', '{"type":"t","ref":"r","title":"t"}', 'short')$q$)
            LIKE '%needs a reason%', 'a short reason is refused');
  PERFORM public.t_assert((SELECT trim FROM public.vehicles WHERE id = '10000000-0000-0000-0000-000000000001') = 'TRANS AM', 'refused calls change nothing');
  PERFORM public.t_assert((SELECT count(*) FROM public.superseded_rows) = 2, 'two corrections, two kept rows');
END $$;
RESET statement_timeout;

SELECT public.t_assert(has_function_privilege('service_role', 'public.correct_vehicle_text_field(uuid,text,text,text,jsonb,text)', 'EXECUTE'), 'service_role may execute');
SELECT public.t_assert(NOT has_function_privilege('anon', 'public.correct_vehicle_text_field(uuid,text,text,text,jsonb,text)', 'EXECUTE'), 'anon may not execute');
SELECT public.t_assert(NOT has_function_privilege('authenticated', 'public.correct_vehicle_text_field(uuid,text,text,text,jsonb,text)', 'EXECUTE'), 'authenticated may not execute');
SELECT public.t_assert(position('engine_type' in obj_description('public.correct_vehicle_text_field(uuid,text,text,text,jsonb,text)'::regprocedure, 'pg_proc')) > 0, 'the comment names the new fields');
SELECT 'correct_vehicle_text_field contract: PASS' AS result;
