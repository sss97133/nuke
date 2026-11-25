-- Disposable PG17: bat_live_pull_relive_fence_v1 (migration 20261125174500). Loads the live body of
-- bat_live_pull_run(integer,boolean) read on 2026-11-25 (fixtures/bat_live_pull_run_live_20261125.sql, sha256 checked by
-- the migration), applies the migration twice, and runs the re-live step's SELECT, cut from the function as deployed
-- before and after, on tables at the live row counts of 2026-11-25 (vehicles 1.5 M, bat monitored rows 11,728 of which
-- 9,017 not live and 13 in the end window). Proves: patched once; the same rows are chosen before and after (a lot
-- with no outcome is re-lived; one with an outcome, one outside the window, one on a deleted vehicle are not); after the
-- edit no plan node reads vehicles except by its primary key; buffers before and after are printed.
-- Run from the repo root in an empty database named dm_refinement_<name>. Synthetic rows only.
\set ON_ERROR_STOP on
SET statement_timeout = '300s';

CREATE TYPE public.observation_kind AS ENUM ('sale_result', 'listing');
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, deleted_at timestamptz, origin_metadata jsonb, listing_url text,
  requires_improvement boolean);
CREATE INDEX idx_vehicles_requires_improvement ON public.vehicles (requires_improvement) WHERE deleted_at IS NULL;
-- guardrail-allow(center-key-fk): monitored_auctions: disposable fixture with the live columns the re-live step reads
CREATE TABLE public.monitored_auctions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id uuid, external_auction_id text,
  external_auction_url text, vehicle_id uuid, auction_end_time timestamptz, is_live boolean, stream_state jsonb DEFAULT '{}',
  UNIQUE (source_id, external_auction_id));
CREATE INDEX idx_monitored_auctions_vehicle ON public.monitored_auctions (vehicle_id);
-- guardrail-allow(center-key-fk): auction_events: disposable fixture with the live columns the re-live step reads
CREATE TABLE public.auction_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, source_url text, outcome text);
CREATE INDEX auction_events_vehicle_canon_idx ON public.auction_events (vehicle_id);
CREATE INDEX idx_auction_events_bat_lot_slug ON public.auction_events (lower(substring(source_url, 'bringatrailer\.com/listing/([^/?#]+)')));
-- guardrail-allow(center-key-fk): vehicle_observations: disposable fixture with the live columns the re-live step reads
CREATE TABLE public.vehicle_observations (id uuid PRIMARY KEY, vehicle_id uuid, structured_data jsonb, kind public.observation_kind,
  extraction_method text, is_superseded boolean, vehicle_match_signals jsonb, source_url text);
-- guardrail-allow(center-key-fk): vehicle_events: disposable fixture with the live columns the re-live step reads
CREATE TABLE public.vehicle_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, source_platform text, source_url text);
CREATE INDEX idx_vehicle_events_source_url ON public.vehicle_events (source_url);

\i supabase/sql/fixtures/bat_live_pull_run_live_20261125.sql
CREATE TABLE public._before AS SELECT pg_get_functiondef('public.bat_live_pull_run(integer,boolean)'::regprocedure) AS d;
\i supabase/migrations/20261125174500_bat_live_pull_relive_fence.sql
\i supabase/migrations/20261125174500_bat_live_pull_relive_fence.sql

CREATE FUNCTION public.assert(cond boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', msg; END IF; END $$;
SELECT public.assert((length(d) - length(replace(d, 'bat_live_pull_relive_fence_v1', ''))) / length('bat_live_pull_relive_fence_v1') = 1,
                     'patched once')
  FROM (SELECT pg_get_functiondef('public.bat_live_pull_run(integer,boolean)'::regprocedure) d) x;

-- The re-live step's SELECT, cut from a function body, with the source id and clock as literals.
CREATE FUNCTION public.relive_select(body text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE s int; e int; q text;
BEGIN
  s := position(E'UPDATE monitored_auctions m SET is_live=true\n  WHERE m.id IN (\n' IN body);
  IF s = 0 THEN RAISE EXCEPTION 'FAIL: re-live step not found'; END IF;
  s := s + length(E'UPDATE monitored_auctions m SET is_live=true\n  WHERE m.id IN (\n');
  e := position(E'    ORDER BY m2.id FOR UPDATE OF m2 SKIP LOCKED);' IN substr(body, s));
  IF e = 0 THEN RAISE EXCEPTION 'FAIL: re-live step end not found'; END IF;
  q := substr(body, s, e - 1);
  q := replace(replace(q, 'v_src', '''00000000-0000-0000-0000-0000000000b1''::uuid'), 'v_now', 'now()');
  RETURN q;
END $$;

-- Rows at the live counts of 2026-11-25.
INSERT INTO public.vehicles (id, deleted_at, origin_metadata, listing_url, requires_improvement)
SELECT ('00000000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
       CASE WHEN g % 50 = 0 THEN now() END,
       CASE WHEN g <= 60000 THEN jsonb_build_object('source', 'bat_auctions_page', 'external_id', (100000 + g)::text,
                                                    'pad', repeat('x', 400))
            ELSE jsonb_build_object('source', 'other', 'pad', repeat('x', 400)) END,
       CASE WHEN g <= 60000 THEN 'https://bringatrailer.com/listing/lot-' || g || '/' END,
       g % 3 = 0
  FROM generate_series(1, 1500000) g;
INSERT INTO public.monitored_auctions (source_id, external_auction_id, external_auction_url, vehicle_id, auction_end_time, is_live)
SELECT '00000000-0000-0000-0000-0000000000b1', 'lot-' || g, 'https://bringatrailer.com/listing/lot-' || g || '/',
       ('00000000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
       CASE WHEN g <= 13 THEN now() - (g || ' hours')::interval ELSE now() - ((g % 300) + 2 || ' days')::interval END,
       g > 9017
  FROM generate_series(1, 11728) g;
-- Lots 2..13 in the window carry a final outcome; lot 1 has none; lot 50 (deleted vehicle) is in the window, no outcome.
INSERT INTO public.auction_events (vehicle_id, source_url, outcome)
SELECT ('00000000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid, 'https://bringatrailer.com/listing/lot-' || g, 'sold'
  FROM generate_series(2, 13) g;
INSERT INTO public.auction_events (vehicle_id, source_url, outcome)
SELECT ('00000000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid, 'https://bringatrailer.com/listing/lot-' || g, 'sold'
  FROM generate_series(14, 11728, 2) g;
UPDATE public.monitored_auctions SET auction_end_time = now() - interval '2 hours'
 WHERE external_auction_id = 'lot-50';
ANALYZE;

DO $$
DECLARE qb text; qa text; ids_b uuid[]; ids_a uuid[]; pb jsonb; pa jsonb; bad int;
BEGIN
  qb := public.relive_select((SELECT d FROM public._before));
  qa := public.relive_select(pg_get_functiondef('public.bat_live_pull_run(integer,boolean)'::regprocedure));
  IF position('bat_live_pull_relive_fence_v1' IN qa) = 0 OR position('bat_live_pull_relive_fence_v1' IN qb) > 0 THEN
    RAISE EXCEPTION 'FAIL: cut the wrong bodies';
  END IF;
  EXECUTE 'SELECT coalesce(array_agg(id ORDER BY id), ''{}'') FROM (' || qb || ') s(id)' INTO ids_b;
  EXECUTE 'SELECT coalesce(array_agg(id ORDER BY id), ''{}'') FROM (' || qa || ') s(id)' INTO ids_a;
  IF ids_a IS DISTINCT FROM ids_b THEN RAISE EXCEPTION 'FAIL: rows differ: before % after %', ids_b, ids_a; END IF;
  IF cardinality(ids_a) <> 1 OR ids_a[1] <> (SELECT id FROM public.monitored_auctions WHERE external_auction_id = 'lot-1') THEN
    RAISE EXCEPTION 'FAIL: expected only lot-1 re-lived, got %', ids_a;
  END IF;
  EXECUTE 'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' || qb INTO pb;
  EXECUTE 'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' || qa INTO pa;
  RAISE NOTICE 'before: % ms, shared hit+read %', pb->0->'Execution Time',
    (pb->0->'Plan'->>'Shared Hit Blocks')::int + (pb->0->'Plan'->>'Shared Read Blocks')::int;
  RAISE NOTICE 'after: % ms, shared hit+read %', pa->0->'Execution Time',
    (pa->0->'Plan'->>'Shared Hit Blocks')::int + (pa->0->'Plan'->>'Shared Read Blocks')::int;
  -- After the edit, vehicles is read only through its primary key.
  WITH RECURSIVE n(node) AS (SELECT pa->0->'Plan' UNION ALL SELECT p FROM n, jsonb_array_elements(n.node->'Plans') p)
  SELECT count(*) INTO bad FROM n
   WHERE node->>'Relation Name' = 'vehicles' AND node->>'Index Name' IS DISTINCT FROM 'vehicles_pkey';
  IF bad > 0 THEN RAISE EXCEPTION 'FAIL: after the edit a plan node reads vehicles without its key: %', pa; END IF;
END $$;

\echo 'test_bat_live_pull_relive_fence: PASS'
