-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_prediction_factors_registry -f this-file.sql
-- Contract for 20261018011000_prediction_factors_registry.sql. Synthetic rows only; never production.
--   * the migration seeds nothing and applies twice;
--   * record_prediction_factor() is the only way in: service_role executes it, anon and authenticated cannot, and nobody
--     inserts, updates or deletes the table directly;
--   * measures are numbers only (nested objects of numbers allowed); family, status and a past measured_at are checked;
--   * a re-measurement is a new row that supersedes the factor's newest row and leaves it as it was;
--   * anon and authenticated read every row; the writer is a definer with a pinned search_path.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.prediction_factors') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '60s';
SET lock_timeout = '3s';
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
-- Supabase's default privileges hand every new public table to these roles; the migration must take them back.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;
CREATE FUNCTION pg_temp.fails(label text, stmt text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'PASS % (%)', label, SQLERRM; RETURN; END;
  RAISE EXCEPTION 'Contract failed: % (statement succeeded)', label;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.ok(text, boolean), pg_temp.fails(text, text) TO anon, authenticated, service_role;

\ir ../migrations/20261018011000_prediction_factors_registry.sql
\ir ../migrations/20261018011000_prediction_factors_registry.sql

SELECT pg_temp.ok('nothing seeded', (SELECT count(*) FROM public.prediction_factors) = 0);
SELECT pg_temp.ok('nobody but the definer writes the table',
  NOT has_table_privilege('anon', 'public.prediction_factors', 'insert') AND NOT has_table_privilege('anon', 'public.prediction_factors', 'update')
  AND NOT has_table_privilege('anon', 'public.prediction_factors', 'delete') AND NOT has_table_privilege('authenticated', 'public.prediction_factors', 'insert')
  AND NOT has_table_privilege('service_role', 'public.prediction_factors', 'insert') AND NOT has_table_privilege('service_role', 'public.prediction_factors', 'update')
  AND NOT has_table_privilege('service_role', 'public.prediction_factors', 'delete') AND NOT has_table_privilege('public', 'public.prediction_factors', 'insert'));
SELECT pg_temp.ok('anon, authenticated and service_role read it',
  has_table_privilege('anon', 'public.prediction_factors', 'select') AND has_table_privilege('authenticated', 'public.prediction_factors', 'select')
  AND has_table_privilege('service_role', 'public.prediction_factors', 'select'));
SELECT pg_temp.ok('only service_role executes the writer',
  has_function_privilege('service_role', 'public.record_prediction_factor(integer, text, text, text, text, text, text, jsonb, text, timestamptz)', 'execute')
  AND NOT has_function_privilege('anon', 'public.record_prediction_factor(integer, text, text, text, text, text, text, jsonb, text, timestamptz)', 'execute')
  AND NOT has_function_privilege('authenticated', 'public.record_prediction_factor(integer, text, text, text, text, text, text, jsonb, text, timestamptz)', 'execute')
  AND NOT has_function_privilege('public', 'public.record_prediction_factor(integer, text, text, text, text, text, text, jsonb, text, timestamptz)', 'execute'));
SELECT pg_temp.ok('the writer is a definer with a pinned search_path', p.prosecdef AND p.proconfig @> ARRAY['search_path=public, pg_temp'])
FROM pg_proc p WHERE p.proname = 'record_prediction_factor';

SET ROLE service_role;
SELECT set_config('app.writer', 'live-finish-33-retrain', false);
SELECT pg_temp.ok('a first measurement lands',
  public.record_prediction_factor(33, 'T_z_var', 'trim', 'the bid against the variant''s usual finish: ln(bid / variant level)',
    'BaT archive lots on the same model page and leading model words, +-3 model years', 'variant lots closed before the lot''s t72',
    'keep', '{"lift_pts":{"72h":4.39,"24h":2.1,"6h":1.2,"1h":0.6,"10m":0.3},"nonnull_share":0.61,"lots":25620}'::jsonb,
    'archive car lots closed 2026-04-01..09-27, fit A trained 2025-01..12', now() - interval '1 hour') IS NOT NULL);
SELECT pg_temp.fails('measures that hold a string are refused',
  $s$SELECT public.record_prediction_factor(33, 'T_miles', 'trim', 'd', 's', 'r', 'keep', '{"lift_pts":{"24h":"high"}}'::jsonb, 'w', now())$s$);
SELECT pg_temp.fails('measures that hold an array are refused',
  $s$SELECT public.record_prediction_factor(33, 'T_miles', 'trim', 'd', 's', 'r', 'keep', '{"lift_pts":[1,2]}'::jsonb, 'w', now())$s$);
SELECT pg_temp.fails('measures that are not an object are refused',
  $s$SELECT public.record_prediction_factor(33, 'T_miles', 'trim', 'd', 's', 'r', 'keep', '[1]'::jsonb, 'w', now())$s$);
SELECT pg_temp.fails('an unknown family is refused',
  $s$SELECT public.record_prediction_factor(33, 'T_miles', 'vibes', 'd', 's', 'r', 'keep', '{}'::jsonb, 'w', now())$s$);
SELECT pg_temp.fails('an unknown status is refused',
  $s$SELECT public.record_prediction_factor(33, 'T_miles', 'trim', 'd', 's', 'r', 'maybe', '{}'::jsonb, 'w', now())$s$);
SELECT pg_temp.fails('a measurement from the future is refused',
  $s$SELECT public.record_prediction_factor(33, 'T_miles', 'trim', 'd', 's', 'r', 'keep', '{}'::jsonb, 'w', now() + interval '1 day')$s$);
SELECT pg_temp.fails('a blank definition is refused',
  $s$SELECT public.record_prediction_factor(33, 'T_miles', 'trim', ' ', 's', 'r', 'keep', '{}'::jsonb, 'w', now())$s$);
SELECT pg_temp.fails('service_role cannot insert directly',
  $s$INSERT INTO public.prediction_factors (model_version, factor_key, family, definition, source, as_of_rule, status, measures, measured_on, measured_at, recorded_by)
     VALUES (33, 'x', 'trim', 'd', 's', 'r', 'keep', '{}', 'w', now(), 'me')$s$);
SELECT pg_temp.ok('the monthly re-measurement lands too',
  public.record_prediction_factor(33, 'T_z_var', 'trim', 'the bid against the variant''s usual finish: ln(bid / variant level)',
    'BaT archive lots on the same model page and leading model words, +-3 model years', 'variant lots closed before the lot''s t72',
    'keep', '{"lift_pts":{"72h":4.1,"24h":2.0,"6h":1.1,"1h":0.5,"10m":0.3},"nonnull_share":0.62,"lots":26004}'::jsonb,
    'archive car lots closed 2026-05-01..10-27, fit trained 2025-02..2026-01', now()) IS NOT NULL);
RESET ROLE;
SELECT pg_temp.ok('the re-measurement supersedes the first row, which is left as it was',
  (SELECT count(*) FROM public.prediction_factors WHERE factor_key = 'T_z_var') = 2
  AND (SELECT supersedes FROM public.prediction_factors WHERE factor_key = 'T_z_var' ORDER BY measured_at DESC LIMIT 1)
      = (SELECT id FROM public.prediction_factors WHERE factor_key = 'T_z_var' ORDER BY measured_at LIMIT 1)
  AND (SELECT (measures->'lift_pts'->>'72h')::numeric FROM public.prediction_factors WHERE factor_key = 'T_z_var' ORDER BY measured_at LIMIT 1) = 4.39
  AND (SELECT supersedes FROM public.prediction_factors WHERE factor_key = 'T_z_var' ORDER BY measured_at LIMIT 1) IS NULL);
SELECT pg_temp.ok('the declared writer is recorded', (SELECT bool_and(recorded_by = 'live-finish-33-retrain') FROM public.prediction_factors));
SELECT pg_temp.ok('nothing else landed', (SELECT count(*) FROM public.prediction_factors) = 2);

SET ROLE anon;
SELECT pg_temp.ok('anon reads the registry', (SELECT count(*) FROM public.prediction_factors) = 2);
SELECT pg_temp.fails('anon cannot call the writer',
  $s$SELECT public.record_prediction_factor(33, 'T_miles', 'trim', 'd', 's', 'r', 'keep', '{}'::jsonb, 'w', now())$s$);
SELECT pg_temp.fails('anon cannot insert', $s$INSERT INTO public.prediction_factors (model_version) VALUES (33)$s$);
SELECT pg_temp.fails('anon cannot update', $s$UPDATE public.prediction_factors SET status = 'dropped'$s$);
SELECT pg_temp.fails('anon cannot delete', $s$DELETE FROM public.prediction_factors$s$);
RESET ROLE;
SET ROLE authenticated;
SELECT pg_temp.ok('authenticated reads the registry', (SELECT count(*) FROM public.prediction_factors) = 2);
RESET ROLE;
