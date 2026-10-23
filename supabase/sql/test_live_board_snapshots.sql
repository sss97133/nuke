-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_board_snapshots -f supabase/sql/test_live_board_snapshots.sql
-- Contract for 20261022073000_live_board_snapshots.sql: one row per house per quarter-hour (BaT from market_pulse_live,
-- the rest from market_pulse_live_houses), dollars from USD bids only, a repeat in the same quarter-hour is a no-op, the
-- share reader returns hourly points, how far back each house goes and each house's week-ago reading only when recorded,
-- a visitor can read the series but cannot write it, the cron job is registered once.
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
-- stand-ins for the two board reads (their own contracts are tested elsewhere)
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text);
CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE sql AS
$$ INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_schedule, p_command) RETURNING jobid $$;
CREATE FUNCTION public.market_pulse_live() RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('auctions', jsonb_build_array(
  jsonb_build_array('b1',1990,'BMW','M3',40000,'2026-12-01T00:00:00Z'), jsonb_build_array('b2',1991,'BMW','M3',10000,'2026-12-01T00:00:00Z'),
  jsonb_build_array('b3',1992,'BMW','M3',NULL,'2026-12-01T00:00:00Z'))) $$;
CREATE FUNCTION public.market_pulse_live_houses() RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('auctions', jsonb_build_array(
  jsonb_build_array('c1',1990,'X','Y',44694,'2026-12-01T00:00:00Z','a','b',NULL,false,NULL,NULL,'collecting-cars','GBP'),
  jsonb_build_array('c2',1990,'X','Y',20000,'2026-12-01T00:00:00Z','a','b',NULL,false,NULL,NULL,'collecting-cars','USD'),
  jsonb_build_array('c3',1990,'X','Y',NULL,'2026-12-01T00:00:00Z','a','b',NULL,false,NULL,NULL,'collecting-cars','EUR'),
  jsonb_build_array('e1',1990,'X','Y',5000,'2026-12-01T00:00:00Z','a','b',NULL,false,NULL,NULL,'ebay-motors','USD'))) $$;
CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF; RAISE NOTICE 'PASS %', label;
END $$;

\ir ../migrations/20261022073000_live_board_snapshots.sql
\ir ../migrations/20261022073000_live_board_snapshots.sql

SELECT public.record_live_board_snapshot() AS first_run \gset
SELECT pg_temp.ok('one row per house is recorded: BaT, Collecting Cars, eBay', :'first_run'::int = 3
  AND (SELECT count(*) FROM public.live_board_snapshots) = 3);
SELECT pg_temp.ok('BaT: 3 lots, 2 with a bid, $50,000',
  (SELECT lots = 3 AND lots_with_bid = 2 AND bid_usd = 50000 FROM public.live_board_snapshots WHERE house = 'bringatrailer'));
SELECT pg_temp.ok('Collecting Cars: 3 lots, 2 with a bid, only the USD bid is added in ($20,000; the GBP bid is not)',
  (SELECT lots = 3 AND lots_with_bid = 2 AND bid_usd = 20000 FROM public.live_board_snapshots WHERE house = 'collecting-cars'));
SELECT pg_temp.ok('the snapshot is stamped on a quarter-hour', (SELECT bool_and(extract(minute FROM taken_at)::int % 15 = 0 AND extract(second FROM taken_at) = 0) FROM public.live_board_snapshots));
SELECT pg_temp.ok('a second run in the same quarter-hour writes nothing', public.record_live_board_snapshot() = 0
  AND (SELECT count(*) FROM public.live_board_snapshots) = 3);

-- earlier readings: two hours back for BaT and eBay, and one a week back for BaT only
INSERT INTO public.live_board_snapshots (taken_at, house, bid_usd, lots, lots_with_bid)
SELECT date_trunc('hour', now()) - interval '2 hours', h, 1, 1, 1 FROM unnest(ARRAY['bringatrailer', 'ebay-motors']) h;
INSERT INTO public.live_board_snapshots VALUES (date_trunc('hour', now()) - interval '7 days', 'bringatrailer', 48000, 3, 2);
SELECT pg_temp.ok('the reader lists hourly points over the window', jsonb_array_length(public.live_board_share(24)->'points') = 5);
SELECT pg_temp.ok('a house has a week-ago reading only when its own series reaches back a week (BaT yes, eBay no)',
  public.live_board_share(24)->'week_ago' ? 'bringatrailer' AND NOT (public.live_board_share(24)->'week_ago' ? 'ebay-motors')
  AND (public.live_board_share(24)->'week_ago'->'bringatrailer'->>'bid_usd')::numeric = 48000);
SELECT pg_temp.ok('the reader says how far back the series and each house go',
  public.live_board_share(24)->>'first_at' IS NOT NULL
  AND (public.live_board_share(24)->'first_at_by_house'->>'bringatrailer')::timestamptz < (public.live_board_share(24)->'first_at_by_house'->>'ebay-motors')::timestamptz);

SET ROLE anon;
SELECT jsonb_array_length(public.live_board_share(24)->'points') AS anon_points \gset
RESET ROLE;
SELECT pg_temp.ok('a visitor reads the series', :'anon_points'::int = 5);
SELECT pg_temp.ok('a visitor cannot write the series or run the recorder; service_role can record',
  NOT has_table_privilege('anon', 'public.live_board_snapshots', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.live_board_snapshots', 'DELETE')
  AND NOT has_function_privilege('anon', 'public.record_live_board_snapshot()', 'execute')
  AND has_function_privilege('service_role', 'public.record_live_board_snapshot()', 'execute')
  AND has_function_privilege('anon', 'public.live_board_share(integer)', 'execute'));
SELECT pg_temp.ok('the recorder job is registered once, every 15 minutes, bounded at 60 s',
  (SELECT count(*) FROM cron.job WHERE jobname = 'record-live-board-snapshot') = 1
  AND (SELECT schedule = '*/15 * * * *' AND command LIKE '%statement_timeout = ''60s''%record_live_board_snapshot()%' FROM cron.job WHERE jobname = 'record-live-board-snapshot'));

-- 20261022080000: quarter-hour points for the last 48 hours, hourly before that.
\ir ../migrations/20261022080000_live_board_share_quarter_hours.sql
\ir ../migrations/20261022080000_live_board_share_quarter_hours.sql
INSERT INTO public.live_board_snapshots (taken_at, house, bid_usd, lots, lots_with_bid) VALUES
  (date_trunc('hour', now()) - interval '5 hours', 'bringatrailer', 5, 1, 1), (date_trunc('hour', now()) - interval '5 hours' + interval '15 minutes', 'bringatrailer', 6, 1, 1),
  (date_trunc('hour', now()) - interval '5 hours' + interval '30 minutes', 'bringatrailer', 7, 1, 1),
  (date_trunc('hour', now()) - interval '60 hours', 'bringatrailer', 8, 1, 1), (date_trunc('hour', now()) - interval '60 hours' + interval '15 minutes', 'bringatrailer', 9, 1, 1);
SELECT pg_temp.ok('the last 48 hours come at every recorded quarter-hour',
  (SELECT count(*) FROM jsonb_array_elements(public.live_board_share(168)->'points') p
   WHERE p->>1 = 'bringatrailer' AND (p->>0)::timestamptz BETWEEN date_trunc('hour', now()) - interval '5 hours' AND date_trunc('hour', now()) - interval '4 hours 29 minutes') = 3);
SELECT pg_temp.ok('readings older than 48 hours are thinned to the last of each hour',
  (SELECT count(*) FROM jsonb_array_elements(public.live_board_share(168)->'points') p
   WHERE p->>1 = 'bringatrailer' AND (p->>0)::timestamptz BETWEEN date_trunc('hour', now()) - interval '61 hours' AND date_trunc('hour', now()) - interval '59 hours') = 1
  AND (SELECT (p->>2)::numeric FROM jsonb_array_elements(public.live_board_share(168)->'points') p
       WHERE p->>1 = 'bringatrailer' AND (p->>0)::timestamptz BETWEEN date_trunc('hour', now()) - interval '61 hours' AND date_trunc('hour', now()) - interval '59 hours') = 9);
