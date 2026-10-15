-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_live_finish_estimates -f this-file.sql
-- Contract for 20261015100000_live_finish_estimates.sql. Synthetic rows only; never production.
-- vehicles and hammer_predictions keep the columns the reader uses, with their live types (2026-10-15):
--   * one row per public live BaT lot, from its latest model 32 prediction; models 31 and 24 are never read;
--   * private, deleted, non-vehicle, ended, other-venue and not-live lots are left out;
--   * every estimate is withheld when the writer has not run for two hours;
--   * notes that are not a JSON object leave grade and sentence null instead of failing the read;
--   * analogs come only for up to five named lots, and only the four notes keys the reader names leave the function;
--   * anon executes it while reading no prediction column it could not read before; it is a definer with a pinned path.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.hammer_predictions') IS NOT NULL THEN
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

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

CREATE TABLE public.vehicles (id uuid PRIMARY KEY, is_public boolean, deleted_at timestamptz, listing_kind text,
  sale_status text, platform_source text, auction_end_date text);
CREATE TABLE public.hammer_predictions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, current_bid numeric,
  model_version integer, predicted_hammer numeric, predicted_low numeric, predicted_high numeric, confidence_score numeric,
  predicted_at timestamptz, notes text, price_tier text, comp_count integer);
-- The live grants: anon reads nine prediction columns, through a model 31 policy.
ALTER TABLE public.hammer_predictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY hammer_predictions_live_bands_read ON public.hammer_predictions FOR SELECT TO anon, authenticated USING (model_version = 31);
GRANT SELECT (id, vehicle_id, price_tier, model_version, comp_count, predicted_hammer, predicted_low, predicted_high, predicted_at)
  ON public.hammer_predictions TO anon, authenticated;
GRANT SELECT ON public.vehicles TO anon, authenticated;

-- Lots: 1 live (two model 32 rows, the newer wins; a model 31 row ignored), 2 live with notes that are not JSON,
-- 3 private, 4 ended, 5 another venue, 6 sold already, 7 live with no model 32 row, 8 deleted.
INSERT INTO public.vehicles (id, is_public, deleted_at, listing_kind, sale_status, platform_source, auction_end_date) VALUES
  ('00000000-0000-4000-8000-000000000001', true, NULL, NULL, 'auction_live', 'bringatrailer', (now() + interval '20 hours')::text),
  ('00000000-0000-4000-8000-000000000002', true, NULL, NULL, 'auction_live', 'bringatrailer', (now() + interval '3 hours')::text),
  ('00000000-0000-4000-8000-000000000003', false, NULL, NULL, 'auction_live', 'bringatrailer', (now() + interval '5 hours')::text),
  ('00000000-0000-4000-8000-000000000004', true, NULL, NULL, 'auction_live', 'bringatrailer', (now() - interval '1 hour')::text),
  ('00000000-0000-4000-8000-000000000005', true, NULL, NULL, 'auction_live', 'carsandbids', (now() + interval '5 hours')::text),
  ('00000000-0000-4000-8000-000000000006', true, NULL, NULL, 'sold', 'bringatrailer', (now() + interval '5 hours')::text),
  ('00000000-0000-4000-8000-000000000007', true, NULL, NULL, 'auction_live', 'bringatrailer', (now() + interval '9 hours')::text),
  ('00000000-0000-4000-8000-000000000008', true, now(), NULL, 'auction_live', 'bringatrailer', (now() + interval '9 hours')::text);
INSERT INTO public.hammer_predictions (vehicle_id, current_bid, model_version, predicted_hammer, predicted_low, predicted_high,
  confidence_score, predicted_at, notes) VALUES
  ('00000000-0000-4000-8000-000000000001', 20000, 32, 30000, 24000, 41000, 0.78, now() - interval '50 minutes',
   '{"grade":"A","sentence":"old","comps_through":"2026-09-27","analogs":[]}'),
  ('00000000-0000-4000-8000-000000000001', 25000, 32, 33000, 25500, 45100, 0.775, now() - interval '10 minutes',
   '{"grade":"A","sentence":"8 in 10 cars like this finished inside this range. Half finished within 15%.","comps_through":"2026-09-27","model_page":"ford/mustang-1964-1966","private_note":"never leaves","analogs":[{"title":"1965 Ford Mustang Convertible","closed":"2026-02-22","bid":25000,"final":38250}]}'),
  ('00000000-0000-4000-8000-000000000001', 25000, 31, 36000, 20000, 60000, 0.9, now() - interval '5 minutes', '{"method":"band"}'),
  ('00000000-0000-4000-8000-000000000002', 62700, 32, 83100, 70500, 117800, 0.79, now() - interval '20 minutes', 'not json at all'),
  ('00000000-0000-4000-8000-000000000003', 1, 32, 2, 1, 3, 0.5, now() - interval '5 minutes', '{"grade":"C"}'),
  ('00000000-0000-4000-8000-000000000004', 1, 32, 2, 1, 3, 0.5, now() - interval '5 minutes', '{"grade":"C"}'),
  ('00000000-0000-4000-8000-000000000005', 1, 32, 2, 1, 3, 0.5, now() - interval '5 minutes', '{"grade":"C"}'),
  ('00000000-0000-4000-8000-000000000006', 1, 32, 2, 1, 3, 0.5, now() - interval '5 minutes', '{"grade":"C"}'),
  ('00000000-0000-4000-8000-000000000008', 1, 32, 2, 1, 3, 0.5, now() - interval '5 minutes', '{"grade":"C"}');

\ir ../migrations/20261015100000_live_finish_estimates.sql
\ir ../migrations/20261015100000_live_finish_estimates.sql

DO $$
DECLARE b jsonb := public.live_finish_estimates();
  r jsonb;
BEGIN
  PERFORM pg_temp.ok('fresh while the writer ran within two hours', (b->>'fresh')::boolean);
  PERFORM pg_temp.ok('one row per public live BaT lot with a model 32 estimate',
    (SELECT array_agg(x->>0 ORDER BY x->>0) FROM jsonb_array_elements(b->'rows') x)
      = ARRAY['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002']);
  SELECT x INTO r FROM jsonb_array_elements(b->'rows') x WHERE x->>0 = '00000000-0000-4000-8000-000000000001';
  PERFORM pg_temp.ok('the latest model 32 row, never model 31',
    (r->>1)::numeric = 33000 AND (r->>2)::numeric = 25500 AND (r->>3)::numeric = 45100 AND (r->>8)::numeric = 25000);
  PERFORM pg_temp.ok('grade, coverage, sentence and comps date',
    r->>4 = 'A' AND (r->>5)::numeric = 0.775 AND r->>6 LIKE '8 in 10 cars like this%' AND r->>9 = '2026-09-27');
  SELECT x INTO r FROM jsonb_array_elements(b->'rows') x WHERE x->>0 = '00000000-0000-4000-8000-000000000002';
  PERFORM pg_temp.ok('notes that are not JSON leave grade and sentence null, and the estimate stands',
    r->4 = 'null'::jsonb AND r->6 = 'null'::jsonb AND (r->>1)::numeric = 83100);
  PERFORM pg_temp.ok('no analogs on the board read', b->'analogs' = 'null'::jsonb OR b->'analogs' IS NULL);
  PERFORM pg_temp.ok('the payload names its columns', jsonb_array_length(b->'columns') = 10);
END $$;

DO $$
DECLARE b jsonb := public.live_finish_estimates(ARRAY['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003']::uuid[]);
BEGIN
  PERFORM pg_temp.ok('named lots: only the eligible ones', jsonb_array_length(b->'rows') = 1);
  PERFORM pg_temp.ok('named lots carry their analogs',
    b->'analogs'->'00000000-0000-4000-8000-000000000001'->0->>'final' = '38250');
  PERFORM pg_temp.ok('only the named notes keys leave', position('never leaves' IN b::text) = 0 AND position('mustang-1964-1966' IN b::text) = 0);
END $$;
SELECT pg_temp.ok('more than five named lots get no analogs',
  public.live_finish_estimates(ARRAY(SELECT ('00000000-0000-4000-8000-00000000000' || g)::uuid FROM generate_series(1, 6) g))->'analogs' = 'null'::jsonb
  OR public.live_finish_estimates(ARRAY(SELECT ('00000000-0000-4000-8000-00000000000' || g)::uuid FROM generate_series(1, 6) g))->'analogs' IS NULL);

-- A writer that stopped: every model 32 row older than two hours withholds every estimate.
UPDATE public.hammer_predictions SET predicted_at = predicted_at - interval '3 hours' WHERE model_version = 32;
DO $$
DECLARE b jsonb := public.live_finish_estimates();
BEGIN
  PERFORM pg_temp.ok('a stopped writer shows nothing', NOT (b->>'fresh')::boolean AND b->'rows' = '[]'::jsonb AND b->>'writer_at' IS NOT NULL);
END $$;
UPDATE public.hammer_predictions SET predicted_at = predicted_at + interval '3 hours' WHERE model_version = 32;

SELECT pg_temp.ok('PUBLIC cannot execute; anon, authenticated and service_role can',
  NOT has_function_privilege('public', 'public.live_finish_estimates(uuid[])', 'execute')
  AND has_function_privilege('anon', 'public.live_finish_estimates(uuid[])', 'execute')
  AND has_function_privilege('authenticated', 'public.live_finish_estimates(uuid[])', 'execute')
  AND has_function_privilege('service_role', 'public.live_finish_estimates(uuid[])', 'execute'));
SELECT pg_temp.ok('definer with a pinned search_path', p.prosecdef AND p.proconfig @> ARRAY['search_path=public, pg_temp'])
FROM pg_proc p WHERE p.proname = 'live_finish_estimates';
SELECT pg_temp.ok('anon still cannot read notes or confidence directly',
  NOT has_column_privilege('anon', 'public.hammer_predictions', 'notes', 'select')
  AND NOT has_column_privilege('anon', 'public.hammer_predictions', 'confidence_score', 'select'));

GRANT EXECUTE ON FUNCTION pg_temp.ok(text, boolean) TO anon;
SET ROLE anon;
DO $$
DECLARE b jsonb := public.live_finish_estimates();
BEGIN
  PERFORM pg_temp.ok('anon: the same two estimates', jsonb_array_length(b->'rows') = 2);
END $$;
RESET ROLE;
