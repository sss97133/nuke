-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_horizon_movers -f this-file.sql
-- Contract for 20261018122000_family_horizon_movers_v2.sql. Synthetic rows only; never production.
-- Verifies:
--   1. The 2-argument treemap_family_share_movers(integer, integer) and family_share_movers_build(integer, integer)
--      continue to behave identically to 20261016211000_family_share_movers.sql.
--   2. The 3-argument treemap_family_share_movers(integer, integer, text) and family_share_movers_build(integer, integer, text)
--      support all 8 horizons: 'upcoming', '1d', '1w', '1m', '3m', '6m', '1y', '5y'.
--   3. Each horizon computes relative share moves against the venue's own move in that window, attaches 24 sparkline
--      bins per mover, and enforces its horizon-appropriate eligibility floor and Poisson z threshold.
--   4. '1d' uses live vehicle_events when >= 10 sold events exist in the last 24h and falls back to mv_family_sales otherwise.
--   5. 'upcoming' combines live BaT (market_pulse_live_snapshot) and scheduled calendar lots (mv_auction_calendar_lots)
--      over the next 30d against the past 30d measured sales in mv_family_sales.
--   6. mv_family_share_movers stores all 8 horizons (id = 1..8), refreshes cleanly, and is idempotent when applied twice.
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
CREATE FUNCTION cron.unschedule(job_name text) RETURNS boolean LANGUAGE sql AS
$$ DELETE FROM cron.job WHERE jobname = job_name RETURNING true $$;

CREATE TABLE public.mv_family_market (
  brand text, family_key text, family text, model_key text, sold bigint, bat_dated bigint,
  bat_sold_12m bigint, bat_sold_prior_12m bigint, bat_usd_12m bigint, bat_usd_prior_12m bigint, as_of timestamptz
);
INSERT INTO public.mv_family_market VALUES
  ('Lexus', 'gx', 'GX', 'gx 460', 300, 300, 110, 38, 4840000, 1900000, now()),
  ('Acura', 'integra', 'Integra', 'integra', 300, 300, 35, 100, 875000, 2500000, now()),
  ('Porsche', '911', '911', '911 carrera', 2000, 2000, 500, 500, 75000000, 75000000, now()),
  ('Ford', 'mustang', 'Mustang', 'mustang', 1000, 1000, 200, 200, 10000000, 10000000, now());

CREATE TABLE public.mv_family_sales (
  vehicle_id uuid, brand text, family_key text, year int, raw_model text,
  title text, sale_date date, usd numeric, mileage numeric, source text
);
CREATE INDEX mv_family_sales_family_date ON public.mv_family_sales (brand, family_key, sale_date DESC);

INSERT INTO public.mv_family_sales
SELECT gen_random_uuid(), 'Lexus', 'gx', 2018, 'GX 460', 'Lexus GX', current_date - (i % 5), 45000, 50000, 'BaT'
FROM generate_series(1, 20) s(i);
INSERT INTO public.mv_family_sales
SELECT gen_random_uuid(), 'Lexus', 'gx', 2018, 'GX 460', 'Lexus GX', current_date - 8 - (i % 5), 50000, 50000, 'BaT'
FROM generate_series(1, 4) s(i);

INSERT INTO public.mv_family_sales
SELECT gen_random_uuid(), 'Acura', 'integra', 1998, 'Integra', 'Acura Integra', current_date - (i % 5), 22000, 60000, 'BaT'
FROM generate_series(1, 4) s(i);
INSERT INTO public.mv_family_sales
SELECT gen_random_uuid(), 'Acura', 'integra', 1998, 'Integra', 'Acura Integra', current_date - 8 - (i % 5), 25000, 60000, 'BaT'
FROM generate_series(1, 20) s(i);

INSERT INTO public.mv_family_sales
SELECT gen_random_uuid(), 'Porsche', '911', 2015, '911 Carrera', 'Porsche 911', current_date - (i % 5), 110000, 30000, 'BaT'
FROM generate_series(1, 30) s(i);
INSERT INTO public.mv_family_sales
SELECT gen_random_uuid(), 'Porsche', '911', 2015, '911 Carrera', 'Porsche 911', current_date - 8 - (i % 5), 110000, 30000, 'BaT'
FROM generate_series(1, 30) s(i);

-- Supporting tables matching exact production schemas for 'upcoming' and '1d' live
CREATE TABLE public.mv_model_family_names (
  make_l text, model_l text, vehicles bigint, make text, family_id text, family text, matched text, year_start int, year_end int
);
CREATE UNIQUE INDEX mv_model_family_names_key ON public.mv_model_family_names (make_l, model_l);
INSERT INTO public.mv_model_family_names VALUES
  ('lexus', 'gx 460', 100, 'Lexus', 'gx', 'GX', 'gx', 2002, 2026),
  ('acura', 'integra', 100, 'Acura', 'integra', 'Integra', 'integra', 1986, 2026),
  ('porsche', '911 carrera', 500, 'Porsche', '911', '911', '911', 1964, 2026),
  ('ford', 'mustang', 300, 'Ford', 'mustang', 'Mustang', 'mustang', 1964, 2026);

CREATE TABLE public.market_pulse_live_snapshot (
  id int PRIMARY KEY, payload jsonb, built_at timestamptz, build_ms int
);
CREATE TABLE public.mv_auction_calendar_lots (
  event_id uuid, vehicle_id uuid, house text, source_url text, updated_at timestamptz, ended_at timestamptz,
  run_on date, sale_key text, sale_name text, sale_location text, sale_starts_on date, sale_ends_on date,
  has_reserve boolean, lot_number text, estimate_low text, estimate_high text, currency text,
  year int, make text, model text, image text, vin_present boolean, roster_first_seen timestamptz, prior_n bigint, built_at timestamptz
);

-- Upcoming next 30d: Ford Mustang surges in upcoming (18 upcoming vs 4 past 30d), Porsche 911 drops (6 upcoming vs 60 past 30d)
INSERT INTO public.mv_family_sales
SELECT gen_random_uuid(), 'Ford', 'mustang', 1969, 'Mustang', 'Ford Mustang', current_date - 2, 42000, 40000, 'BaT'
FROM generate_series(1, 4);

INSERT INTO public.market_pulse_live_snapshot VALUES (
  1,
  jsonb_build_object(
    'auctions',
    (
      SELECT jsonb_agg(elem) FROM (
        SELECT jsonb_build_array('bat-m-' || i, 1969, 'Ford', 'Mustang', 48000, (now() + ((i % 7) + 1) * interval '1 day')::text) AS elem
        FROM generate_series(1, 10) s(i)
        UNION ALL
        SELECT jsonb_build_array('bat-p-' || i, 2015, 'Porsche', '911 Carrera', 115000, (now() + ((i % 6) + 1) * interval '1 day')::text) AS elem
        FROM generate_series(1, 6) s(i)
      ) q
    )
  ),
  now(),
  10
);

INSERT INTO public.mv_auction_calendar_lots (make, model, estimate_low, estimate_high, run_on, sale_starts_on, built_at)
SELECT 'Ford', 'Mustang', '45000', '55000', current_date + ((i % 15) + 2), current_date + ((i % 15) + 2), now()
FROM generate_series(1, 8) s(i);

-- Active Facebook Marketplace captures
CREATE TABLE public.marketplace_listings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  vehicle_id uuid,
  suggested_vehicle_id uuid,
  title text,
  price integer,
  current_price numeric,
  location text,
  url text,
  scraped_at timestamptz,
  parsed_year integer,
  extracted_year integer,
  parsed_make text,
  parsed_model text,
  status text
);
INSERT INTO public.marketplace_listings (title, price, current_price, location, url, scraped_at, parsed_year, parsed_make, parsed_model, status)
VALUES
  ('1969 Ford Mustang Boss 302', 68000, 68000, 'Austin, TX', 'https://www.facebook.com/marketplace/item/101', now() - interval '2 hours', 1969, 'Ford', 'Mustang', 'active'),
  ('1970 Ford Mustang Mach 1', 54000, 54000, 'Dallas, TX', 'https://www.facebook.com/marketplace/item/102', now() - interval '6 hours', 1970, 'Ford', 'Mustang', 'active');

-- Live 24h vehicle_events for '1d'
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, make text, model text);
CREATE TABLE public.vehicle_events (
  id uuid DEFAULT gen_random_uuid(), vehicle_id uuid, event_status text, final_price numeric, current_price numeric, ended_at timestamptz
);

DO $$
DECLARE
  v_id uuid;
  i int;
BEGIN
  -- Ford Mustang: 10 sold in last 24h vs 1 in prior 24h
  FOR i IN 1..10 LOOP
    v_id := gen_random_uuid();
    INSERT INTO public.vehicles VALUES (v_id, 'Ford', 'Mustang');
    INSERT INTO public.vehicle_events (vehicle_id, event_status, final_price, ended_at)
    VALUES (v_id, 'sold', 55000, now() - (i || ' hours')::interval);
  END LOOP;
  v_id := gen_random_uuid();
  INSERT INTO public.vehicles VALUES (v_id, 'Ford', 'Mustang');
  INSERT INTO public.vehicle_events (vehicle_id, event_status, final_price, ended_at)
  VALUES (v_id, 'sold', 50000, now() - interval '36 hours');

  -- Porsche 911: 2 sold in last 24h vs 10 in prior 24h
  FOR i IN 1..2 LOOP
    v_id := gen_random_uuid();
    INSERT INTO public.vehicles VALUES (v_id, 'Porsche', '911 Carrera');
    INSERT INTO public.vehicle_events (vehicle_id, event_status, final_price, ended_at)
    VALUES (v_id, 'sold', 120000, now() - (i || ' hours')::interval);
  END LOOP;
  FOR i IN 1..10 LOOP
    v_id := gen_random_uuid();
    INSERT INTO public.vehicles VALUES (v_id, 'Porsche', '911 Carrera');
    INSERT INTO public.vehicle_events (vehicle_id, event_status, final_price, ended_at)
    VALUES (v_id, 'sold', 120000, now() - ((26 + i) || ' hours')::interval);
  END LOOP;
END $$;

\ir ../migrations/20261016211000_family_share_movers.sql
\ir ../migrations/20261018122000_family_horizon_movers_v2.sql
\ir ../migrations/20261018123000_treemap_horizon_sync_and_supply.sql
\ir ../migrations/20261018123000_treemap_horizon_sync_and_supply.sql

SELECT pg_temp.ok('mv_family_share_movers holds all 8 horizons',
  (SELECT count(*) FROM public.mv_family_share_movers) = 8);

SELECT pg_temp.ok('refresh-family-share-movers cron runs hourly',
  (SELECT schedule FROM cron.job WHERE jobname = 'refresh-family-share-movers') = '5 * * * *');

SELECT pg_temp.ok('2-arg treemap_family_share_movers still reads 1y movers unchanged',
  (public.treemap_family_share_movers(5, 30)->'gaining'->0->>'family') = 'GX'
  AND (public.treemap_family_share_movers(5, 30)->'losing'->0->>'family') = 'Integra');

SELECT public.treemap_family_share_movers(5, 0, '1w')::text AS w1 \gset
SELECT pg_temp.ok('1w horizon identifies GX gaining and Integra losing with 24 sparkline bins and treemap overlays',
  (:'w1')::jsonb->>'horizon' = '1w'
  AND ((:'w1')::jsonb->'gaining'->0->>'family') = 'GX'
  AND ((:'w1')::jsonb->'losing'->0->>'family') = 'Integra'
  AND jsonb_array_length((:'w1')::jsonb->'gaining'->0->'bins') = 24
  AND ((:'w1')::jsonb->'brand_moves'->'Lexus'->>0)::int = 20
  AND ((:'w1')::jsonb->'family_moves'->'Lexus|gx'->>0)::int = 20);

SELECT public.treemap_family_share_movers(5, 0, '1d')::text AS d1 \gset
SELECT pg_temp.ok('1d horizon reads live 24h vehicle_events + FB captures against prior 24h with 24 bins',
  (:'d1')::jsonb->>'horizon' = '1d'
  AND ((:'d1')::jsonb->'gaining'->0->>'family') = 'Mustang'
  AND ((:'d1')::jsonb->'losing'->0->>'family') = '911'
  AND jsonb_array_length((:'d1')::jsonb->'gaining'->0->'bins') = 24
  AND ((:'d1')::jsonb->'brand_moves'->'Ford'->>0)::int = 12);

SELECT public.treemap_family_share_movers(5, 0, 'upcoming')::text AS up1 \gset
SELECT pg_temp.ok('upcoming horizon compares next 30d live BaT + calendar + FB Marketplace against past 30d sales',
  (:'up1')::jsonb->>'horizon' = 'upcoming'
  AND ((:'up1')::jsonb->'gaining'->0->>'family') = 'Mustang'
  AND ((:'up1')::jsonb->'gaining'->0->>'sold_12m')::int = 20
  AND ((:'up1')::jsonb->'gaining'->0->>'sold_prior_12m')::int = 4
  AND ((:'up1')::jsonb->'sources'->>'bat_live')::int = 16
  AND ((:'up1')::jsonb->'sources'->>'auction_calendar')::int = 8
  AND ((:'up1')::jsonb->'sources'->>'facebook_marketplace')::int = 2
  AND ((:'up1')::jsonb->'losing'->0->>'family') = '911'
  AND jsonb_array_length((:'up1')::jsonb->'gaining'->0->'bins') = 24);

SELECT public.treemap_family_upcoming_supply('Ford', 'mustang')::text AS sup1 \gset
SELECT pg_temp.ok('treemap_family_upcoming_supply returns live BaT, calendar, and FB Marketplace lots for a family',
  ((:'sup1')::jsonb->'counts'->>'bat_live')::int = 10
  AND ((:'sup1')::jsonb->'counts'->>'auction_calendar')::int = 8
  AND ((:'sup1')::jsonb->'counts'->>'facebook_marketplace')::int = 2
  AND ((:'sup1')::jsonb->'counts'->>'total')::int = 20);

SELECT pg_temp.ok('PUBLIC cannot execute 3-arg reader or upcoming supply reader; anon can',
  NOT has_function_privilege('public', 'public.treemap_family_share_movers(integer, integer, text)', 'execute')
  AND has_function_privilege('anon', 'public.treemap_family_share_movers(integer, integer, text)', 'execute')
  AND NOT has_function_privilege('public', 'public.family_share_movers_build(integer, integer, text)', 'execute')
  AND has_function_privilege('anon', 'public.family_share_movers_build(integer, integer, text)', 'execute')
  AND NOT has_function_privilege('public', 'public.treemap_family_upcoming_supply(text, text)', 'execute')
  AND has_function_privilege('anon', 'public.treemap_family_upcoming_supply(text, text)', 'execute'));
