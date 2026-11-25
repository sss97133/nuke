-- Disposable PG17: bat_stream_window_v1 (migration 20261125223000). Loads the live body of bat_live_pull_run read on
-- 2026-11-25 (fixture + 20261125174500 reproduce the live sha256 the migration checks), applies the migration twice,
-- and runs the stream-count statement cut from the function as deployed, before and after, against 1,655 stale is_live
-- lots (the 2026-11-25 10:00Z count) beside the lots that are really closing. Proves: rule row written once with its
-- basis, other live_pull keys kept; body patched once; the count with the row is the closing set only; without the
-- row, or with a malformed one, it is the old count. Synthetic rows only.
\set ON_ERROR_STOP on
DO $$ BEGIN IF current_database() NOT LIKE 'dm_refinement_%' THEN RAISE EXCEPTION 'disposable database only'; END IF; END $$;

CREATE TABLE public.live_auction_sources (id uuid PRIMARY KEY, slug text UNIQUE, scraping_config jsonb DEFAULT '{}');
-- guardrail-allow(center-key-fk): monitored_auctions: disposable fixture with the live columns the stream count reads
CREATE TABLE public.monitored_auctions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id uuid, vehicle_id uuid,
  auction_end_time timestamptz, is_live boolean, stream_state jsonb DEFAULT '{}');
INSERT INTO public.live_auction_sources VALUES
  ('c8bb42ac-6d09-4453-bb0b-11a8689f5707', 'bat', '{"live_pull": {"lots_per_run": 8, "closing_slots": 1}}'),
  ('00000000-0000-0000-0000-0000000000aa', 'other', '{}');

\i supabase/sql/fixtures/bat_live_pull_run_live_20261125.sql
\i supabase/migrations/20261125174500_bat_live_pull_relive_fence.sql
CREATE FUNCTION public.assert(cond boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', msg; END IF; END $$;
SELECT public.assert(encode(sha256(convert_to(pg_get_functiondef('public.bat_live_pull_run(integer,boolean)'::regprocedure), 'UTF8')), 'base64')
  = '6kRsloXMB8yA3DAl9HrJnJTUJbl8eCSdvHqnFSPD3VE=', 'fixture + relive fence reproduce the live body');
CREATE TABLE public._before AS SELECT pg_get_functiondef('public.bat_live_pull_run(integer,boolean)'::regprocedure) AS d;

\i supabase/migrations/20261125223000_bat_stream_closing_window.sql
\i supabase/migrations/20261125223000_bat_stream_closing_window.sql

SELECT public.assert((SELECT (length(d) - length(replace(d, 'bat_stream_window_v1', ''))) / length('bat_stream_window_v1') = 1
  FROM (SELECT pg_get_functiondef('public.bat_live_pull_run(integer,boolean)'::regprocedure) d) x), 'patched once');
SELECT public.assert(scraping_config #>> '{live_pull,stream_window,lookback_minutes}' = '120'
  AND scraping_config #>> '{live_pull,stream_window,basis}' LIKE '%n 7,978%'
  AND scraping_config #>> '{live_pull,lots_per_run}' = '8' AND scraping_config #>> '{live_pull,closing_slots}' = '1',
  'rule row written with its basis; other live_pull keys kept') FROM public.live_auction_sources WHERE slug = 'bat';
SELECT public.assert(scraping_config = '{}', 'other source untouched') FROM public.live_auction_sources WHERE slug = 'other';

-- The stream count, cut from the body as deployed, run with the function's own variables.
CREATE FUNCTION public._stream_count(fn text, v_src uuid, v_now timestamptz, v_cfg jsonb) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE stmt text; s int; e int; n integer;
BEGIN
  s := position('SELECT count(*) INTO v_stream_lots' IN fn);
  e := position(E';\n  IF v_stream_lots>0 THEN' IN fn);
  IF s = 0 OR e <= s THEN RAISE EXCEPTION 'stream count not found'; END IF;
  stmt := replace(substr(fn, s, e - s), 'INTO v_stream_lots ', '');
  EXECUTE 'SELECT (' || stmt || ')::integer FROM (SELECT $1 AS v_src, $2 AS v_now, $3 AS v_cfg) vars' INTO n USING v_src, v_now, v_cfg;
  RETURN n;
END $$;

INSERT INTO public.monitored_auctions (source_id, auction_end_time, is_live)
  SELECT 'c8bb42ac-6d09-4453-bb0b-11a8689f5707', now() - (1 + g % 13) * interval '1 day', true FROM generate_series(1, 1655) g;
INSERT INTO public.monitored_auctions (source_id, auction_end_time, is_live, stream_state) VALUES
  ('c8bb42ac-6d09-4453-bb0b-11a8689f5707', now() + interval '5 minutes', true, '{}'),                       -- closing
  ('c8bb42ac-6d09-4453-bb0b-11a8689f5707', now() - interval '30 minutes', true, '{}'),                      -- ended, settling
  ('c8bb42ac-6d09-4453-bb0b-11a8689f5707', now() - interval '1 minute', false,
     jsonb_build_object('terminal_received_at', now() - interval '1 minute')),                              -- just resolved
  ('c8bb42ac-6d09-4453-bb0b-11a8689f5707', now() + interval '1 hour', true, '{}'),                          -- not closing yet
  ('c8bb42ac-6d09-4453-bb0b-11a8689f5707', now() - interval '3 hours', true, '{}'),                         -- past the bound
  ('00000000-0000-0000-0000-0000000000aa', now() + interval '5 minutes', true, '{}');                       -- other source

DO $$
DECLARE
  cfg jsonb := (SELECT scraping_config -> 'live_pull' FROM public.live_auction_sources WHERE slug = 'bat');
  after_fn text := pg_get_functiondef('public.bat_live_pull_run(integer,boolean)'::regprocedure);
  before_fn text := (SELECT d FROM public._before);
  src uuid := 'c8bb42ac-6d09-4453-bb0b-11a8689f5707';
  n integer;
BEGIN
  n := public._stream_count(before_fn, src, now(), cfg);
  PERFORM public.assert(n = 1659, format('before: every stale lot counts as closing (%s)', n));
  n := public._stream_count(after_fn, src, now(), cfg);
  PERFORM public.assert(n = 3, format('after, with the row: closing + settling + just resolved only (%s)', n));
  n := public._stream_count(after_fn, src, now(), cfg - 'stream_window');
  PERFORM public.assert(n = 1659, format('after, no row: the old count (%s)', n));
  n := public._stream_count(after_fn, src, now(), jsonb_set(cfg, '{stream_window,lookback_minutes}', '"two hours"'));
  PERFORM public.assert(n = 1659, format('after, malformed row: the old count (%s)', n));
  n := public._stream_count(after_fn, src, now(), jsonb_set(cfg, '{stream_window,lookback_minutes}', '240'));
  PERFORM public.assert(n = 4, format('after, the row decides the bound (%s)', n));
END $$;
SELECT 'test_bat_stream_closing_window PASS';
