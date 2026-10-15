-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_share_movers -f this-file.sql
-- Contract for 20261016211000_family_share_movers.sql. Synthetic rows only; never production.
-- mv_family_market stands in as a plain table with the columns the reader uses. Requires: a family's move is its BaT
-- sales ratio over BaT's own; it is listed only at 2 standard errors or more, so a small sample with a big swing stays
-- out; too few sales, the "other" family and a family BaT does not hold half of are never listed; the average sale's
-- move is reported apart from volume (a family can gain share while its average sale falls); the BaT totals cover
-- every family; counts say how many families were read, eligible and significant; p_limit bounds each side; anon may
-- execute, PUBLIC may not; the migration applies twice.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.mv_family_market') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 dm_refinement_* database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, active boolean DEFAULT true);
CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS
$$ INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command) RETURNING jobid $$;

CREATE TABLE public.mv_family_market (brand text, family_key text, family text, sold bigint, bat_dated bigint,
  bat_sold_12m bigint, bat_sold_prior_12m bigint, bat_usd_12m bigint, bat_usd_prior_12m bigint, as_of timestamptz);
-- BaT overall over every row below, "other" included: 2,128 sales in each window, so BaT itself is flat and a
-- family's move is its own ratio.
INSERT INTO public.mv_family_market VALUES
  -- gains share clearly: 100 -> 200
  ('Ferrari', 'f360', '360', 400, 400, 200, 100, 30000000, 10000000, '2026-10-15 09:50:00+00'),
  -- gains share in volume while its average sale falls: 38 -> 109, average $50K -> $44K
  ('Lexus', 'gx', 'GX', 200, 200, 109, 38, 4796000, 1900000, '2026-10-15 09:50:00+00'),
  -- a big swing on a small sample: 31 -> 40 is under 2 standard errors
  ('BMW', 'z3', 'Z3', 100, 100, 40, 31, 800000, 600000, '2026-10-15 09:50:00+00'),
  -- loses share clearly: 100 -> 50
  ('Acura', 'integra', 'Integra', 300, 300, 50, 100, 1000000, 2500000, '2026-10-15 09:50:00+00'),
  -- too few in the last 12 months
  ('Volvo', '240', '240 Series', 300, 300, 29, 100, 400000, 1000000, '2026-10-15 09:50:00+00'),
  -- BaT holds under half its sales
  ('Chevrolet', 'corvette', 'Corvette', 5000, 2000, 400, 100, 20000000, 5000000, '2026-10-15 09:50:00+00'),
  -- names not yet keyed: in BaT's totals, never listed
  ('Ferrari', 'other', 'Other models', 900, 900, 300, 100, 9000000, 3000000, '2026-10-15 09:50:00+00'),
  -- grows with BaT (flat, as BaT is): no move to report
  ('Porsche', '911', '911', 9000, 9000, 1000, 1000, 300000000, 250000000, '2026-10-15 09:50:00+00'),
  -- more unkeyed names, a year earlier only: balances BaT to flat
  ('Ford', 'other', 'Other models', 600, 600, 0, 559, 0, 5590000, '2026-10-15 09:50:00+00');

\ir ../migrations/20261016211000_family_share_movers.sql
\ir ../migrations/20261016211000_family_share_movers.sql

SELECT public.treemap_family_share_movers()::text AS m \gset
SELECT pg_temp.ok('BaT totals cover every family, "other" included',
  (:'m')::jsonb->'bat' = jsonb_build_object('sold_12m', 200 + 109 + 40 + 50 + 29 + 400 + 300 + 1000 + 0,
    'sold_prior_12m', 100 + 38 + 31 + 100 + 100 + 100 + 100 + 1000 + 559,
    'usd_12m', 30000000 + 4796000 + 800000 + 1000000 + 400000 + 20000000 + 9000000 + 300000000 + 0,
    'usd_prior_12m', 10000000 + 1900000 + 600000 + 2500000 + 1000000 + 5000000 + 3000000 + 250000000 + 5590000)
  AND ((:'m')::jsonb->'bat'->>'sold_12m') = ((:'m')::jsonb->'bat'->>'sold_prior_12m'));
SELECT pg_temp.ok('families read, eligible and significant are counted',
  (:'m')::jsonb->'families' = '7'::jsonb AND (:'m')::jsonb->'eligible' = '5'::jsonb
  AND (:'m')::jsonb->'significant' = '3'::jsonb AND (:'m')::jsonb->'min_sales' = '30'::jsonb);
SELECT pg_temp.ok('gaining lists the clear gains, largest first; losing the clear loss',
  (SELECT array_agg(g->>'family' ORDER BY o) FROM jsonb_array_elements((:'m')::jsonb->'gaining') WITH ORDINALITY x(g, o)) = ARRAY['GX', '360']
  AND (SELECT array_agg(g->>'family') FROM jsonb_array_elements((:'m')::jsonb->'losing') g) = ARRAY['Integra']);
SELECT pg_temp.ok('a move is the family''s sales ratio over BaT''s, with a ±2 standard error band around it',
  abs(((:'m')::jsonb->'gaining'->1->>'share_move')::numeric
      - ((200.0 / 100) / (2128.0 / 2128) - 1)) < 0.0001
  AND ((:'m')::jsonb->'gaining'->1->>'se')::numeric = round(sqrt(1.0 / 200 + 1.0 / 100), 4)
  AND ((:'m')::jsonb->'gaining'->1->>'share_lo')::numeric < ((:'m')::jsonb->'gaining'->1->>'share_move')::numeric
  AND ((:'m')::jsonb->'gaining'->1->>'share_hi')::numeric > ((:'m')::jsonb->'gaining'->1->>'share_move')::numeric
  AND ((:'m')::jsonb->'gaining'->1->>'share_lo')::numeric > 0);
SELECT pg_temp.ok('the average sale moves apart from volume: GX gains share while its average sale falls',
  ((:'m')::jsonb->'gaining'->0->>'share_move')::numeric > 1
  AND abs(((:'m')::jsonb->'gaining'->0->>'avg_price_move')::numeric - ((4796000.0 / 109) / (1900000.0 / 38) - 1)) < 0.0001
  AND ((:'m')::jsonb->'gaining'->0->>'avg_price_move')::numeric < 0);
SELECT pg_temp.ok('never listed: a small-sample swing, too few sales, a family BaT holds under half of, "other", no move',
  NOT EXISTS (SELECT 1 FROM jsonb_array_elements(((:'m')::jsonb->'gaining') || ((:'m')::jsonb->'losing')) g
              WHERE g->>'family' IN ('Z3', '240 Series', 'Corvette', 'Other models', '911')));
SELECT pg_temp.ok('p_limit bounds each side, at most 25; min_sales is the caller''s',
  jsonb_array_length(public.treemap_family_share_movers(1)->'gaining') = 1
  AND (public.treemap_family_share_movers(1)->'gaining'->0->>'family') = 'GX'
  AND (public.treemap_family_share_movers(5, 25)->'eligible') = '6'::jsonb
  AND (public.treemap_family_share_movers(500)->'min_sales') = '30'::jsonb);
SELECT pg_temp.ok('PUBLIC cannot execute the reader; anon can',
  NOT has_function_privilege('public', 'public.treemap_family_share_movers(integer, integer)', 'execute')
  AND has_function_privilege('anon', 'public.treemap_family_share_movers(integer, integer)', 'execute'));
SELECT pg_temp.ok('the refresh job is registered once, daily after the family market, bounded',
  (SELECT count(*) FROM cron.job WHERE jobname = 'refresh-family-share-movers') = 1
  AND (SELECT schedule = '5 10 * * *' AND command LIKE '%statement_timeout = ''5min''%REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_family_share_movers%'
       FROM cron.job WHERE jobname = 'refresh-family-share-movers'));
SELECT pg_temp.ok('a visitor reads the stored value',
  has_table_privilege('anon', 'public.mv_family_share_movers', 'SELECT')
  AND has_function_privilege('anon', 'public.family_share_movers_build(integer, integer)', 'execute'));

-- BaT doubles (more unkeyed names in the last 12 months): a family that doubled kept its share, a flat one lost half.
INSERT INTO public.mv_family_market VALUES
  ('Mazda', 'other', 'Other models', 2200, 2200, 2128, 0, 0, 0, '2026-10-15 09:50:00+00');
SELECT pg_temp.ok('the default read is the stored value until the view refreshes; the build sees the new rows now',
  public.treemap_family_share_movers() = (:'m')::jsonb
  AND public.family_share_movers_build()->'bat'->'sold_12m' = to_jsonb(2128 + 2128));
REFRESH MATERIALIZED VIEW public.mv_family_share_movers;
SELECT public.treemap_family_share_movers()::text AS d \gset
SELECT pg_temp.ok('moves are relative to BaT: when BaT doubles, a doubled family reads no move and a flat one loses share',
  NOT EXISTS (SELECT 1 FROM jsonb_array_elements((:'d')::jsonb->'gaining') g WHERE g->>'family' = '360')
  AND EXISTS (SELECT 1 FROM jsonb_array_elements((:'d')::jsonb->'losing') g
              WHERE g->>'family' = '911' AND abs((g->>'share_move')::numeric - (-0.5)) < 0.0001)
  AND EXISTS (SELECT 1 FROM jsonb_array_elements((:'d')::jsonb->'losing') g
              WHERE g->>'family' = 'Integra' AND abs((g->>'share_move')::numeric - (-0.75)) < 0.0001));
TRUNCATE public.mv_family_market;
REFRESH MATERIALIZED VIEW public.mv_family_share_movers;
SELECT pg_temp.ok('with no rows the lists are empty and the counts zero',
  public.treemap_family_share_movers()->'gaining' = '[]'::jsonb AND public.treemap_family_share_movers()->'losing' = '[]'::jsonb
  AND public.treemap_family_share_movers()->'eligible' = '0'::jsonb);
