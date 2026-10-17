-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_market_sources_board -f this-file.sql
-- Contract for 20261018030000_market_sources_board.sql, 20261018031000_market_sources_live_window.sql and
-- 20261018032000_market_sources_rules_and_landing.sql (the reader in force). Synthetic rows only; never production.
--   * the migration applies twice and schedules its job once;
--   * record_market_source_day() writes one row per declared source holding data: held lots and when measured, the latest
--     whole-source census, map sales under the source's house, sales by sale date (12 months, the 12 before, 24 months);
--     a source with no data gets no row; a second call the same day replaces the day's rows;
--   * market_sources_read() ranks by held lots, counts only live lots with a future end read in the last two hours, and
--     carries each source's held lots a week earlier; with no rows it returns an empty list; a live lot counts when its
--     monitor was read within 24 hours;
--   * anon reads the board only through the reader; only service_role runs the writer;
--   * refresh-source-target-landed runs once a day at 10:27Z, its command untouched;
--   * auction houses, marketplaces, and dealers rank (auction houses first, then marketplaces, then dealers); capture
--     channels and aggregators are counted in not_ranked; each source carries the records it landed in the last 24 hours
--     and 7 days and 14 daily counts.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.market_source_days') IS NOT NULL THEN
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

-- pg_cron as the migration uses it
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, active boolean DEFAULT true);
CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command) RETURNING jobid $$;
CREATE FUNCTION cron.alter_job(job_id bigint, schedule text DEFAULT NULL, command text DEFAULT NULL, database text DEFAULT NULL,
  username text DEFAULT NULL, active boolean DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  UPDATE cron.job SET schedule = coalesce(alter_job.schedule, job.schedule), command = coalesce(alter_job.command, job.command),
         active = coalesce(alter_job.active, job.active) WHERE job.jobid = alter_job.job_id $$;
INSERT INTO cron.job (jobid, jobname, schedule, command, active) VALUES
  (524, 'refresh-source-target-landed', '12,42 * * * *',
   'SET statement_timeout = ''300s''; REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_source_target_landed', false);

-- the reads, with the columns the migration uses and their live types (2026-10-16)
CREATE TABLE public.observation_sources (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text, display_name text,
  category text, created_at timestamptz DEFAULT now(), business_id uuid);
CREATE TABLE public.organizations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), logo_url text, business_type text);
CREATE TABLE public.source_census (source_id uuid, universe_total integer, universe_historical integer, census_method text,
  census_confidence numeric(3,2), census_at timestamptz);
CREATE TABLE public.mv_source_target_landed (source_slug text, landed bigint, event_urls bigint, event_urls_without_target bigint,
  landed_lots bigint, measured_at timestamptz);
CREATE TABLE public.mv_treemap_outcomes (id uuid, brand_name text, model text, year integer, source_name text, outcome text,
  sale_basis text, sold_amount numeric, bat_bids integer, bat_watchers integer);
CREATE TABLE public.mv_family_sales (vehicle_id uuid, brand text, family_key text, model text, year integer, source text,
  usd bigint, sale_date date);
CREATE TABLE public.live_auction_sources (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text UNIQUE, display_name text);
CREATE TABLE public.monitored_auctions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id uuid, vehicle_id uuid,
  auction_end_time timestamptz, is_live boolean, updated_at timestamptz);
-- the landing log's source: rows landed per platform, at their own clocks (synthetic, this disposable database only)
CREATE TABLE public.vehicle_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_platform text, created_at timestamptz);
INSERT INTO public.vehicle_events (source_platform, created_at)
SELECT v.p, now() - v.ago FROM (VALUES
  ('mecum', interval '10 minutes'), ('mecum', interval '2 hours'), ('Mecum', interval '5 hours'),   -- three in the last day
  ('mecum', interval '3 days'), ('mecum', interval '20 days'),                                     -- one more in the week
  ('bat', interval '30 minutes'), ('craigslist', interval '6 days'), ('facebook_saved', interval '1 hour'),
  (NULL, interval '1 hour')) v(p, ago);
\ir ../migrations/20261016150000_market_venue_label.sql

INSERT INTO public.observation_sources (slug, display_name, category, created_at) VALUES
  ('bat', 'Bring a Trailer', 'auction', '2025-01-01'),
  ('mecum', 'Mecum Auctions', 'auction', '2025-01-01'),
  ('cars-and-bids', 'Cars & Bids', 'auction', '2025-01-01'),
  ('carsandbids', 'Cars and Bids (dup)', 'auction', '2025-06-01'),
  ('craigslist', 'Craigslist', 'marketplace', '2025-01-01'),
  ('facebook_marketplace', 'Facebook Marketplace', 'marketplace', '2025-01-01'),
  ('facebook-saved', 'Facebook Saved Items', 'marketplace', '2025-01-01'),
  ('jamesedition', 'JamesEdition', 'aggregator', '2025-01-01'),
  ('streetside-classics', 'Streetside Classics', 'dealer', '2025-01-01'),
  ('nothing-yet', 'Nothing Yet', 'auction', '2025-01-01');
INSERT INTO public.source_census (source_id, universe_total, universe_historical, census_method, census_confidence, census_at)
SELECT id, v.t, v.h, v.m, v.c, v.at::timestamptz FROM public.observation_sources o JOIN (VALUES
  ('bat', 264746, 264000, 'enumerated', 0.90, '2026-09-27'),
  ('bat', 1200, NULL, 'live_only', 0.50, '2026-10-10'),          -- a newer live-only count: not the whole source
  ('mecum', 250000, 249000, 'enumerated', 0.85, '2026-10-01'),
  ('mecum', 268979, 268000, 'enumerated', 0.85, '2026-10-15')) v(slug, t, h, m, c, at) ON v.slug = o.slug;
INSERT INTO public.mv_source_target_landed VALUES
  ('bat', 250000, 0, 0, 252399, '2026-10-15 02:12Z'),
  ('mecum', 60000, 0, 0, 62314, '2026-10-15 02:12Z'),
  ('carsandbids', 0, 0, 0, 18659, '2026-10-15 02:12Z'),
  ('craigslist', 0, 0, 0, 8411, '2026-10-15 02:12Z'),
  ('facebookmarketplace', 0, 0, 0, 11744, '2026-10-15 02:12Z'),
  ('facebooksaved', 0, 0, 0, 460, '2026-10-15 02:12Z'),
  ('jamesedition', 0, 0, 0, 838, '2026-10-15 02:12Z'),
  ('streetsideclassics', 0, 0, 0, 15, '2026-10-15 02:12Z');
INSERT INTO public.mv_treemap_outcomes (id, source_name, outcome, sold_amount)
SELECT gen_random_uuid(), v.h, v.o, v.a FROM (VALUES
  ('Bring a Trailer', 'sold', 50000), ('Bring a Trailer', 'sold', 70000), ('Bring a Trailer', 'not_sold', 40000),
  ('Bring a Trailer', 'sold', 0), ('Mecum', 'sold', 30000), ('Cars & Bids', 'sold', 45000), (NULL, 'sold', 99000)) v(h, o, a);
INSERT INTO public.mv_family_sales (vehicle_id, source, usd, sale_date)
SELECT gen_random_uuid(), v.s, v.u, (current_date - v.d)::date FROM (VALUES
  ('Bring a Trailer', 50000, 10), ('Bring a Trailer', 70000, 40), ('Bring a Trailer', 60000, 400),
  ('Bring a Trailer', 0, 20), ('Bring a Trailer', 90000, 900), ('Mecum', 30000, 5), (NULL, 10000, 5)) v(s, u, d);
INSERT INTO public.live_auction_sources (slug, display_name) VALUES ('bat', 'Bring a Trailer'), ('cars-and-bids', 'Cars & Bids');
INSERT INTO public.monitored_auctions (source_id, auction_end_time, is_live, updated_at)
SELECT s.id, v.e, v.l, v.u FROM public.live_auction_sources s JOIN (VALUES
  ('bat', now() + interval '1 day', true, now() - interval '5 minutes'),
  ('bat', now() + interval '2 days', true, now() - interval '30 minutes'),
  ('bat', now() + interval '5 days', true, now() - interval '10 hours'),      -- far from its close, read daily: live
  ('bat', now() + interval '3 days', true, now() - interval '30 hours'),      -- not read in a day: not counted
  ('bat', now() - interval '1 day', true, now() - interval '5 minutes'),       -- ended: not live
  ('bat', now() + interval '1 day', false, now()),                             -- not live
  ('cars-and-bids', now() + interval '1 day', true, now() - interval '200 days') -- stale since February: not live
  ) v(slug, e, l, u) ON v.slug = s.slug;

\ir ../migrations/20261018030000_market_sources_board.sql
\ir ../migrations/20261018030000_market_sources_board.sql
\ir ../migrations/20261018031000_market_sources_live_window.sql
\ir ../migrations/20261018031000_market_sources_live_window.sql
\ir ../migrations/20261018032000_market_sources_rules_and_landing.sql
\ir ../migrations/20261018032000_market_sources_rules_and_landing.sql
\ir ../migrations/20261018033000_market_sources_org_identity.sql
\ir ../migrations/20261018033000_market_sources_org_identity.sql
\ir ../migrations/20261018034000_market_sources_hourly_live_landing.sql
\ir ../migrations/20261018034000_market_sources_hourly_live_landing.sql
\ir ../migrations/20261018150000_source_pool_depth_estimator.sql
\ir ../migrations/20261018150000_source_pool_depth_estimator.sql
\ir ../migrations/20261018153000_market_sources_dealers_and_consignors.sql
\ir ../migrations/20261018153000_market_sources_dealers_and_consignors.sql

-- BaT's organization has a recorded logo; Craigslist has no organization
WITH org AS (INSERT INTO public.organizations (logo_url, business_type) VALUES ('https://example.test/bat-logo.png', 'auction_house') RETURNING id)
UPDATE public.observation_sources SET business_id = (SELECT id FROM org) WHERE slug = 'bat';

SELECT pg_temp.ok('the writer job is scheduled once, at 10:47Z',
  (SELECT count(*) FROM cron.job WHERE jobname = 'market-source-days') = 1
  AND (SELECT schedule FROM cron.job WHERE jobname = 'market-source-days') = '47 10 * * *'
  AND (SELECT command FROM cron.job WHERE jobname = 'market-source-days') LIKE '%record_market_source_day()%');
SELECT pg_temp.ok('the landing job is scheduled once, hourly at :09',
  (SELECT count(*) FROM cron.job WHERE jobname = 'market-source-hours') = 1
  AND (SELECT schedule FROM cron.job WHERE jobname = 'market-source-hours') = '9 * * * *');
SELECT pg_temp.ok('the capture channel names its market',
  (SELECT market_slug FROM public.observation_sources WHERE slug = 'facebook-saved') = 'facebook_marketplace');
SELECT pg_temp.ok('the held-lot fold runs daily at 10:27Z, active, its command untouched',
  (SELECT schedule = '27 10 * * *' AND active AND command LIKE 'SET statement_timeout = ''300s''; REFRESH%'
   FROM cron.job WHERE jobid = 524));

SET ROLE anon;
SELECT pg_temp.ok('before any reading: an empty board',
  public.market_sources_read()->'rows' = '[]'::jsonb AND public.market_sources_read()->'day' = 'null'::jsonb);
RESET ROLE;

SET ROLE service_role;
SELECT pg_temp.ok('the writer records the eight sources holding data', public.record_market_source_day() = 8);
RESET ROLE;
SELECT pg_temp.ok('one row per source holding data; none for a source with nothing',
  (SELECT array_agg(source_slug ORDER BY source_slug COLLATE "C") FROM public.market_source_days)
    = ARRAY['bat', 'cars-and-bids', 'craigslist', 'facebook-saved', 'facebook_marketplace', 'jamesedition', 'mecum',
            'streetside-classics']);
SELECT pg_temp.ok('BaT: held lots and when, the whole-source census, map sales with an amount, sales by sale date',
  (SELECT landed_lots = 252399 AND landed_at = '2026-10-15 02:12Z' AND population = 264746 AND population_method = 'enumerated'
      AND population_confidence = 0.90 AND map_sales = 2 AND map_usd = 120000 AND sales_12m = 2 AND usd_12m = 120000
      AND sales_prior_12m = 1 AND usd_prior_12m = 60000 AND house = 'Bring a Trailer'
   FROM public.market_source_days WHERE source_slug = 'bat'));
SELECT pg_temp.ok('Mecum: the latest whole-source census, its house named the map''s way',
  (SELECT population = 268979 AND house = 'Mecum' AND map_sales = 1 AND sales_12m = 1
   FROM public.market_source_days WHERE source_slug = 'mecum'));
SELECT pg_temp.ok('two spellings of one source make one row, under the first declared',
  (SELECT display_name = 'Cars & Bids' AND landed_lots = 18659 AND map_sales = 1 AND population IS NULL
   FROM public.market_source_days WHERE source_slug = 'cars-and-bids'));
SELECT pg_temp.ok('a marketplace with held lots and no sales is on the board',
  (SELECT landed_lots = 8411 AND house IS NULL AND map_sales IS NULL AND population IS NULL
   FROM public.market_source_days WHERE source_slug = 'craigslist'));
SELECT pg_temp.ok('estimate_source_population supports windowed extrapolation and turnover flow regimes',
  (SELECT population = 37783 AND population_method = 'window_extrapolated' AND population_confidence BETWEEN 0.50 AND 0.78
   FROM public.estimate_source_population(
     19305, now(), 'auction', 180, NULL, NULL, NULL, NULL,
     11279, NULL, NULL, NULL, '{"missing": 8496}'::jsonb, now()
   ))
  AND (SELECT population = 37000 AND population_method = 'turnover_model' AND population_confidence BETWEEN 0.40 AND 0.72
   FROM public.estimate_source_population(
     3018, now(), 'marketplace', 30, NULL, NULL, NULL, NULL,
     NULL, 500, 100, NULL, '{"horizon_days": 365}'::jsonb, now()
   )));
SELECT pg_temp.ok('24 months of points, oldest first, each [month, sales, dollars]; nothing older, nothing unpriced',
  (SELECT sum((x->>1)::int) = 3 AND sum((x->>2)::numeric) = 180000
          AND bool_and(x->>0 >= to_char(date_trunc('month', current_date) - interval '23 months', 'YYYY-MM'))
          AND array_agg(x->>0 ORDER BY ord) = array_agg(x->>0 ORDER BY x->>0)
   FROM public.market_source_days, jsonb_array_elements(months) WITH ORDINALITY e(x, ord) WHERE source_slug = 'bat'));

UPDATE public.mv_source_target_landed SET landed_lots = 70000, measured_at = '2026-10-16 10:27Z' WHERE source_slug = 'mecum';
SET ROLE service_role;
SELECT pg_temp.ok('a second reading the same day replaces the day''s rows', public.record_market_source_day() = 8);
SELECT pg_temp.ok('fourteen days of landings fill in one call', public.record_market_source_hours(336) > 0);
SELECT pg_temp.ok('a later hourly run writes its last three hours again', public.record_market_source_hours(3) > 0);
RESET ROLE;
SELECT pg_temp.ok('and replaces them, never adding to them',
  (SELECT sum(records) FROM public.market_source_hours) = 7);   -- 8 rows with a platform, one 20 days old
SELECT pg_temp.ok('still one row per source, with the new count and its time',
  (SELECT count(*) FROM public.market_source_days) = 8
  AND (SELECT landed_lots = 70000 AND landed_at = '2026-10-16 10:27Z' FROM public.market_source_days WHERE source_slug = 'mecum'));

-- a week earlier
INSERT INTO public.market_source_days (day, source_slug, display_name, landed_lots)
VALUES (current_date - 8, 'mecum', 'Mecum Auctions', 48934), (current_date - 3, 'mecum', 'Mecum Auctions', 60000);

SET ROLE anon;
DO $$
DECLARE b jsonb := public.market_sources_read();
  r jsonb;
BEGIN
  PERFORM pg_temp.ok('the board names its columns',
    b->'columns' = '["source","name","category","house","held_lots","held_at","population","population_method","population_confidence","population_at","map_sales","map_usd","sales_12m","usd_12m","sales_prior_12m","usd_prior_12m","months","live_lots","live_at","held_lots_before","before_day","landed_24h","landed_7d","last_landed","days14","logo_url","business_type"]'::jsonb);
  SELECT x INTO r FROM jsonb_array_elements(b->'rows') x WHERE x->>0 = 'bat';
  PERFORM pg_temp.ok('a market carries its organization''s recorded logo and type',
    r->>25 = 'https://example.test/bat-logo.png' AND r->>26 = 'auction_house');
  SELECT x INTO r FROM jsonb_array_elements(b->'rows') x WHERE x->>0 = 'craigslist';
  PERFORM pg_temp.ok('a market without an organization carries none', r->25 = 'null'::jsonb AND r->26 = 'null'::jsonb);
  PERFORM pg_temp.ok('markets and dealers: auction houses by held lots, marketplaces by held listings, dealers by held vehicles',
    (b->>'day')::date = current_date AND (SELECT array_agg(x->>0 ORDER BY ord) FROM jsonb_array_elements(b->'rows') WITH ORDINALITY e(x, ord))
      = ARRAY['bat', 'mecum', 'cars-and-bids', 'facebook_marketplace', 'craigslist', 'streetside-classics']);
  PERFORM pg_temp.ok('the capture channel and the aggregator are counted, not ranked',
    b->'not_ranked' = '{"capture channels": 1, "aggregator": 1}'::jsonb);
  SELECT x INTO r FROM jsonb_array_elements(b->'rows') x WHERE x->>0 = 'mecum';
  PERFORM pg_temp.ok('landing: three records in the last day, four in the week, 14 daily counts, the last landing hour',
    (r->>21)::int = 3 AND (r->>22)::int = 4 AND jsonb_array_length(r->24) = 14
    AND (r->>23)::timestamptz >= date_trunc('hour', now()) - interval '1 hour'
    AND (SELECT sum(v::int) FROM jsonb_array_elements_text(r->24) v) = 4);
  SELECT x INTO r FROM jsonb_array_elements(b->'rows') x WHERE x->>0 = 'craigslist';
  PERFORM pg_temp.ok('a market that landed nothing today: zero today, its week and its last landing kept',
    (r->>21)::int = 0 AND (r->>22)::int = 1 AND r->>23 IS NOT NULL);
  SELECT x INTO r FROM jsonb_array_elements(b->'rows') x WHERE x->>0 = 'bat';
  PERFORM pg_temp.ok('live lots: live, a future end, read in the last 24 hours', (r->>17)::int = 3 AND r->>18 IS NOT NULL);
  SELECT x INTO r FROM jsonb_array_elements(b->'rows') x WHERE x->>0 = 'cars-and-bids';
  PERFORM pg_temp.ok('a live row stale since February is not live', (r->>17)::int = 0);
  SELECT x INTO r FROM jsonb_array_elements(b->'rows') x WHERE x->>0 = 'mecum';
  PERFORM pg_temp.ok('held lots a week earlier: the latest reading at least seven days old',
    (r->>19)::bigint = 48934 AND (r->>20)::date = current_date - 8 AND (r->>4)::bigint = 70000);
  SELECT x INTO r FROM jsonb_array_elements(b->'rows') x WHERE x->>0 = 'craigslist';
  PERFORM pg_temp.ok('no week-earlier reading: null, not zero', r->19 = 'null'::jsonb);
  PERFORM pg_temp.ok('the board carries 24 hourly counts and 12 five-minute counts per source under landing',
    jsonb_array_length(b->'landing'->'sources'->'mecum'->'hours24') = 24
    AND jsonb_array_length(b->'landing'->'sources'->'mecum'->'mins60') = 12
    AND (b->'landing'->'sources'->'mecum'->>'landed_24h')::int = 3);
  PERFORM pg_temp.ok('market_source_landing_read drills into a single source down to the hour and recent events',
    (public.market_source_landing_read('mecum')->>'landed_24h')::int = 3
    AND jsonb_array_length(public.market_source_landing_read('mecum')->'hours24') = 24
    AND jsonb_array_length(public.market_source_landing_read('mecum')->'recent') >= 3);
END $$;
SELECT pg_temp.fails('anon cannot read the table', $s$SELECT count(*) FROM public.market_source_days$s$);
SELECT pg_temp.fails('anon cannot write the board', $s$SELECT public.record_market_source_day()$s$);
RESET ROLE;
SET ROLE authenticated;
SELECT pg_temp.ok('authenticated reads the board', jsonb_array_length(public.market_sources_read()->'rows') = 5);
SELECT pg_temp.fails('authenticated cannot write the landing log', $s$SELECT public.record_market_source_hours(3)$s$);
SELECT pg_temp.fails('authenticated cannot write the board', $s$SELECT public.record_market_source_day()$s$);
RESET ROLE;
SELECT pg_temp.ok('all three functions are definers with a pinned search_path',
  (SELECT bool_and(p.prosecdef AND p.proconfig @> ARRAY['search_path=public, pg_temp']) FROM pg_proc p
   WHERE p.proname IN ('record_market_source_day', 'market_sources_read', 'market_source_landing_read')));
SELECT pg_temp.ok('PUBLIC executes none of them',
  NOT has_function_privilege('public', 'public.record_market_source_day()', 'execute')
  AND NOT has_function_privilege('public', 'public.market_sources_read()', 'execute')
  AND NOT has_function_privilege('public', 'public.market_source_landing_read(text, timestamptz)', 'execute'));
