-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_seller_index -f this-file.sql
-- Proves the seller identity index migration: it builds a valid partial index with the expected definition, the planner
-- uses it for a seller's listings, and a rerun is a no-op. The rows below are a disposable test database's rows, never
-- production testimony.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicle_events') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;

-- The columns the index and its readers touch; most events carry no seller key, as on production (36,075 of 470,968).
CREATE TABLE public.vehicle_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, source_url text,
  event_type text, seller_external_identity_id uuid, metadata jsonb);
INSERT INTO public.vehicle_events (vehicle_id, source_url, event_type, seller_external_identity_id, metadata)
SELECT gen_random_uuid(), 'https://bringatrailer.com/listing/lot-' || g, 'auction',
       CASE WHEN g % 13 = 0 THEN ('80000000-0000-0000-0000-' || lpad((g % 200)::text, 12, '0'))::uuid END,
       jsonb_build_object('pad', repeat('x', 200))
  FROM generate_series(1, 60000) g;
ANALYZE public.vehicle_events;

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;

-- 1. The migration builds the index; its own verify block raises unless it is valid with the expected definition.
\ir ../migrations/20261014030000_vehicle_events_seller_identity_index.sql
SELECT public.t_assert(EXISTS (SELECT FROM pg_index WHERE indexrelid = 'public.idx_vehicle_events_seller_identity'::regclass
  AND indisvalid AND indisready AND indislive), 'the index is valid, ready and live');

-- 2. The planner reads one seller's listings through it.
CREATE FUNCTION public.t_plan() RETURNS text LANGUAGE plpgsql AS $$
DECLARE line text; plan text := '';
BEGIN
  FOR line IN EXPLAIN SELECT id FROM public.vehicle_events
    WHERE seller_external_identity_id = ANY (ARRAY['80000000-0000-0000-0000-000000000013'::uuid])
  LOOP plan := plan || line || E'\n'; END LOOP;
  RETURN plan;
END $$;
SELECT public.t_assert(public.t_plan() LIKE '%idx_vehicle_events_seller_identity%', format('the seller filter uses the index; plan %s', public.t_plan()));

-- 3. A rerun is a no-op: the preflight accepts the valid index and IF NOT EXISTS skips the build.
\ir ../migrations/20261014030000_vehicle_events_seller_identity_index.sql
SELECT public.t_assert((SELECT count(*) FROM pg_indexes WHERE tablename = 'vehicle_events' AND indexname = 'idx_vehicle_events_seller_identity') = 1, 'one index after the rerun');
SELECT 'vehicle_events seller identity index contract: PASS' AS result;
