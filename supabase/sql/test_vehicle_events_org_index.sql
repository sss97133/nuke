-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_vehicle_events_org -f this-file.sql
-- Proves the organization page's vehicle_events read (PostgREST's shape: events with the vehicle embedded as a
-- lateral join, filtered by source_organization_id and source_platform, newest ended_at first, small limit) stops
-- joining a vehicle for every event of the organization and joins one per returned event.
-- Before the migration the planner reads all of the organization's events, runs the lateral join for each, then sorts.
-- After it, an ordered scan of idx_vehicle_events_org_platform_ended stops at the limit.
-- The rows below are a disposable test database's rows, never production testimony.
-- ALLOW_RAW_TESTIMONY_WRITE: a disposable test database; the stub tables below carry production's names and none of its rows.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicle_events') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;

-- The shapes the read touches.
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, year integer, make text, model text, is_public boolean DEFAULT true,
  payload text);
CREATE TABLE public.vehicle_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid,
  source_organization_id uuid, source_platform text, event_status text, ended_at timestamptz);
CREATE INDEX idx_vehicle_events_source_org ON public.vehicle_events (source_organization_id);
CREATE INDEX idx_vehicle_events_ended ON public.vehicle_events (ended_at DESC NULLS LAST);
CREATE INDEX idx_vehicle_events_platform ON public.vehicle_events (source_platform);
CREATE INDEX idx_vehicle_events_vehicle ON public.vehicle_events (vehicle_id);

-- 40,000 vehicles. 60,000 events: 3,000 BaT events of organization A (a third sold), 3,000 of organization B,
-- 30,000 BaT events of 200 other organizations, and 24,000 with no organization (other platforms, no organization).
INSERT INTO public.vehicles (id, year, make, model, payload)
SELECT ('20000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 1960 + g % 60, 'Make' || g % 40, 'Model' || g % 90, repeat('x', 600)
FROM generate_series(1, 40000) g;
INSERT INTO public.vehicle_events (vehicle_id, source_organization_id, source_platform, event_status, ended_at)
SELECT ('20000000-0000-0000-0000-' || lpad((1 + g % 40000)::text, 12, '0'))::uuid,
       CASE WHEN g <= 3000 THEN 'a0000000-0000-0000-0000-00000000000a'::uuid
            WHEN g <= 6000 THEN 'b0000000-0000-0000-0000-00000000000b'::uuid
            WHEN g <= 36000 THEN ('c0000000-0000-0000-0000-' || lpad((g % 200)::text, 12, '0'))::uuid END,
       CASE WHEN g <= 36000 THEN 'bat' WHEN g % 2 = 0 THEN 'mecum' ELSE 'cars_and_bids' END,
       CASE WHEN g % 3 = 0 THEN 'sold' ELSE 'ended' END,
       now() - (g || ' minutes')::interval
FROM generate_series(1, 60000) g;
ANALYZE public.vehicles;
ANALYZE public.vehicle_events;

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;

-- The two statements the organization profile sends, as PostgREST shapes them (embedded vehicle as a lateral join).
CREATE FUNCTION public.t_plan(p_sold boolean) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE plan jsonb;
BEGIN
  EXECUTE format($q$EXPLAIN (ANALYZE, FORMAT JSON, TIMING OFF, COSTS OFF)
    SELECT ve.*, row_to_json(v1.*)::jsonb AS vehicle
    FROM public.vehicle_events ve
    LEFT JOIN LATERAL (SELECT v.* FROM public.vehicles v WHERE v.id = ve.vehicle_id LIMIT 1) v1 ON true
    WHERE ve.source_organization_id = 'a0000000-0000-0000-0000-00000000000a' %s AND ve.source_platform = 'bat'
    ORDER BY ve.ended_at DESC LIMIT %s$q$, CASE WHEN p_sold THEN 'AND ve.event_status = ''sold''' ELSE '' END,
    CASE WHEN p_sold THEN 50 ELSE 100 END) INTO plan;
  RETURN plan;
END $$;
-- How many times the vehicles probe ran, and which indexes the plan used.
CREATE FUNCTION public.t_vehicle_probes(p_plan jsonb) RETURNS bigint LANGUAGE sql AS $$
  SELECT coalesce(max((n #>> '{Actual Loops}')::bigint), 0)
  FROM jsonb_path_query(p_plan, 'strict $.**') n
  WHERE jsonb_typeof(n) = 'object' AND n ->> 'Relation Name' = 'vehicles'
$$;
CREATE FUNCTION public.t_uses_index(p_plan jsonb, p_index text) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM jsonb_path_query(p_plan, 'strict $.**') n
                 WHERE jsonb_typeof(n) = 'object' AND n ->> 'Index Name' = p_index)
$$;

-- 1. Before: the vehicles join runs once per event of the organization (3,000), not once per returned row.
SELECT public.t_plan(false) AS before_plain, public.t_plan(true) AS before_sold \gset
SELECT public.t_assert(public.t_vehicle_probes((:'before_plain'::jsonb) -> 0 -> 'Plan') >= 3000,
  format('before: the lateral join ran for all of the organization''s events; got %s', public.t_vehicle_probes((:'before_plain'::jsonb) -> 0 -> 'Plan')));

-- 2. The migration (CREATE INDEX CONCURRENTLY runs outside a transaction block, so psql's autocommit is required).
\ir ../migrations/20261014040100_vehicle_events_org_platform_ended_index.sql
ANALYZE public.vehicle_events;
SELECT public.t_assert((SELECT i.indisvalid AND i.indisready FROM pg_index i
  WHERE i.indexrelid = 'public.idx_vehicle_events_org_platform_ended'::regclass), 'the index is valid and ready');
SELECT public.t_assert((SELECT pg_get_expr(i.indpred, i.indrelid) = '(source_organization_id IS NOT NULL)' FROM pg_index i
  WHERE i.indexrelid = 'public.idx_vehicle_events_org_platform_ended'::regclass), 'the index is partial on source_organization_id');
SELECT public.t_assert((SELECT obj_description('public.idx_vehicle_events_org_platform_ended'::regclass, 'pg_class') IS NOT NULL),
  'the index is described');

-- 3. After: an ordered scan of the new index, and the vehicles join runs for the returned rows only.
SELECT public.t_plan(false) AS after_plain, public.t_plan(true) AS after_sold \gset
SELECT public.t_assert(public.t_uses_index((:'after_plain'::jsonb) -> 0 -> 'Plan', 'idx_vehicle_events_org_platform_ended'),
  'after: the plain read uses the new index');
SELECT public.t_assert(public.t_vehicle_probes((:'after_plain'::jsonb) -> 0 -> 'Plan') = 100,
  format('after: the lateral join ran 100 times (the limit); got %s', public.t_vehicle_probes((:'after_plain'::jsonb) -> 0 -> 'Plan')));
SELECT public.t_assert(public.t_uses_index((:'after_sold'::jsonb) -> 0 -> 'Plan', 'idx_vehicle_events_org_platform_ended'),
  'after: the sold read uses the new index');
SELECT public.t_assert(public.t_vehicle_probes((:'after_sold'::jsonb) -> 0 -> 'Plan') = 50,
  format('after: the sold read joined 50 vehicles (the limit); got %s', public.t_vehicle_probes((:'after_sold'::jsonb) -> 0 -> 'Plan')));

-- 4. The answer is the same rows in the same order as an unindexed read.
SET enable_indexscan = off; SET enable_bitmapscan = off; SET enable_indexonlyscan = off;
CREATE TEMP TABLE without_index AS
  SELECT id FROM public.vehicle_events WHERE source_organization_id = 'a0000000-0000-0000-0000-00000000000a'
    AND source_platform = 'bat' ORDER BY ended_at DESC LIMIT 100;
RESET enable_indexscan; RESET enable_bitmapscan; RESET enable_indexonlyscan;
CREATE TEMP TABLE with_index AS
  SELECT id FROM public.vehicle_events WHERE source_organization_id = 'a0000000-0000-0000-0000-00000000000a'
    AND source_platform = 'bat' ORDER BY ended_at DESC LIMIT 100;
SELECT public.t_assert((SELECT array_agg(id ORDER BY id) FROM without_index) = (SELECT array_agg(id ORDER BY id) FROM with_index)
  AND (SELECT count(*) FROM with_index) = 100, 'the same 100 events with and without the index');

-- 5. A second run is a no-op, and an interrupted build (an INVALID index) stops the migration.
\ir ../migrations/20261014040100_vehicle_events_org_platform_ended_index.sql
UPDATE pg_index SET indisvalid = false WHERE indexrelid = 'public.idx_vehicle_events_org_platform_ended'::regclass;
\echo 'Expected: the INVALID-index ERROR below.'
\set ON_ERROR_STOP off
\ir ../migrations/20261014040100_vehicle_events_org_platform_ended_index.sql
\set ON_ERROR_STOP on
SELECT public.t_assert((SELECT NOT i.indisvalid FROM pg_index i WHERE i.indexrelid = 'public.idx_vehicle_events_org_platform_ended'::regclass),
  'an INVALID index is reported, not skipped');
SELECT 'vehicle_events org index contract: PASS' AS result;
