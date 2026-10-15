-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_family_year_prices -f this-file.sql
-- Contract for 20261015130000_family_year_prices.sql. Synthetic rows only; never production.
-- vehicles, mv_treemap_outcomes, mv_model_family_names, marketplace_listings and vehicle_events (here tables with the
-- columns the fold reads, 2026-10-15) feed mv_family_year_prices:
--   * a model year with 10 sales pools only itself; one with fewer widens 1, 2, 3 then 5 years until it has 10, and a
--     year with no sales of its own borrows its neighbours; under 10 at 5 years is thin and carries no percentiles;
--   * p10..p90 are percentile_cont over the pooled prices; prices is sorted, so width_bucket(ask, prices) counts the
--     recorded prices at or below an ask; offered counts unsold outcomes beside the sales; by_source and the dates add up;
--   * a vehicle outside its family's year range (one year of slack) and a name without a family are not claimed; a
--     sale whose own page names its model year but not its family is another car: not pooled, counted in conflicts;
--   * asks: Facebook listings and classified events in the 365 days before today, one per vehicle (its latest), never a
--     duplicate or blocked listing, never a private or deleted vehicle, never pooled with sales;
--   * (20261015218000) badge twins pool by canonical_models.platform, one row per family naming the platform;
--   * (20261015215000) venues: each source's count and its median from 5 prices, within the row's window;
--   * (20261015160000) the odometer: sorted readings, n_miles and the median over the same window and rows, zero and
--     out-of-range readings unknown, an ask carrying its own or its vehicle's reading; replacing the unbuilt view and
--     keeping a built one;
--   * it is created empty and the first refresh builds it; no vehicle or listing id is stored; anon reads it; later
--     refreshes run CONCURRENTLY; the migration applies twice and schedules its refresh once.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.mv_treemap_outcomes') IS NOT NULL THEN
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

-- pg_cron stand-in: the migration registers its refresh job through cron.schedule.
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, active boolean DEFAULT true);
CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS
$$ INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command) RETURNING jobid $$;

CREATE TABLE public.vehicles (id uuid PRIMARY KEY, make text, model text, year integer, sale_date date, bat_sale_date date,
  listing_url text, discovery_url text, mileage integer,
  deleted_at timestamptz, is_public boolean DEFAULT true, listing_kind text);
CREATE TABLE public.mv_treemap_outcomes (id uuid PRIMARY KEY, brand_name text, model text, year integer, source_name text,
  outcome text, sale_basis text, sold_amount numeric, bat_bids integer, bat_watchers integer);
CREATE TABLE public.mv_model_family_names (make_l text, model_l text, vehicles bigint, make text, family_id uuid,
  family text, matched text, year_start integer, year_end integer, PRIMARY KEY (make_l, model_l));
CREATE TABLE public.canonical_models (id uuid PRIMARY KEY, make text, canonical_model text, aliases text[], platform text);
CREATE TABLE public.marketplace_listings (id uuid PRIMARY KEY, vehicle_id uuid, price integer, status text,
  first_seen_at timestamptz, mileage integer);
CREATE TABLE public.vehicle_events (id uuid PRIMARY KEY, vehicle_id uuid, source_platform text, current_price numeric,
  created_at timestamptz);

-- Family A (Corvette, 1953..open) and family B (Electra, 1959..1976). "corvette stingray" and "corvette" are two names
-- of family A; "electra 225" is family B; "mystery" has no family.
INSERT INTO public.mv_model_family_names (make_l, model_l, vehicles, make, family_id, family, matched, year_start, year_end) VALUES
  ('chevrolet', 'corvette', 1, 'Chevrolet', '00000000-0000-4000-c000-00000000000a', 'Corvette', 'corvette', 1953, NULL),
  ('chevrolet', 'corvette stingray', 1, 'Chevrolet', '00000000-0000-4000-c000-00000000000a', 'Corvette', 'corvette stingray', 1953, NULL),
  ('buick', 'electra 225', 1, 'Buick', '00000000-0000-4000-c000-00000000000b', 'Electra', 'electra 225', 1959, 1976),
  ('buick', 'mystery', 1, 'Buick', NULL, NULL, NULL, NULL, NULL),
  -- Badge twins (20261015218000): the GMC K1500 (family C) and the Chevrolet K1500 (family D), one platform.
  ('gmc', 'k1500', 1, 'GMC', '00000000-0000-4000-c000-00000000000c', 'K1500', 'k1500', 1988, 1998),
  ('chevrolet', 'k1500', 1, 'Chevrolet', '00000000-0000-4000-c000-00000000000d', 'K1500', 'k1500', 1988, 1998);
-- The families' canonical rows: family A's own row (its id is the family_id) and a duplicate spelled "CHEVROLET" whose
-- alias "stingray" belongs to the same family; family B's row. A two-letter alias is too short to name anything.
INSERT INTO public.canonical_models (id, make, canonical_model, aliases, platform) VALUES
  ('00000000-0000-4000-c000-00000000000c', 'GMC', 'K1500', '{k1500}', 'gm-k1500'),
  ('00000000-0000-4000-c000-00000000000d', 'Chevrolet', 'K1500', '{k1500}', 'gm-k1500');
INSERT INTO public.canonical_models (id, make, canonical_model, aliases) VALUES
  ('00000000-0000-4000-c000-00000000000a', 'Chevrolet', 'Corvette', '{corvette,vette,"sting ray",cv}'),
  ('00000000-0000-4000-c000-0000000000aa', 'CHEVROLET', 'Corvette', '{stingray}'),
  ('00000000-0000-4000-c000-00000000000b', 'Buick', 'Electra', '{electra,"electra 225"}');

-- A 1967: 12 sales at 10,000 .. 120,000 (8 BaT, 4 Mecum; g 1..6 dated last year, g 7..9 dated 2015 by bat_sale_date,
-- g 10..12 undated) and 3 unsold. Half the names are "corvette stingray". Odometers (20261015160000): g 1..10 read
-- g x 1,000 miles; g 11 reads 2,500,000 and g 12 reads 0, both unknown.
INSERT INTO public.vehicles (id, make, model, year, sale_date, bat_sale_date, mileage)
SELECT ('00000000-0000-4000-a067-' || lpad(g::text, 12, '0'))::uuid, 'Chevrolet',
       CASE WHEN g % 2 = 0 THEN 'Corvette Stingray' ELSE 'Corvette' END, 1967,
       CASE WHEN g <= 6 THEN current_date - 300 END, CASE WHEN g BETWEEN 7 AND 9 THEN date '2015-06-01' END,
       CASE WHEN g <= 10 THEN g * 1000 WHEN g = 11 THEN 2500000 WHEN g = 12 THEN 0 END
FROM generate_series(1, 15) g;
INSERT INTO public.mv_treemap_outcomes (id, year, source_name, outcome, sold_amount)
SELECT ('00000000-0000-4000-a067-' || lpad(g::text, 12, '0'))::uuid, 1967,
       CASE WHEN g <= 8 THEN 'Bring a Trailer' WHEN g <= 12 THEN 'Mecum' ELSE NULL END,
       CASE WHEN g <= 12 THEN 'sold' ELSE 'not_sold' END, CASE WHEN g <= 12 THEN g * 10000 END
FROM generate_series(1, 15) g;
-- Pages: g 1 names the car ("1967-chevrolet-corvette-coupe-139"), g 2 is a title without a year (kept), g 3 a page
-- with no slug (kept). Two more "Corvette" sales are other cars by their own pages: a Camaro (BaT slug) and a Chevelle
-- (Mecum title, discovery_url); they are not pooled and count as conflicts.
UPDATE public.vehicles SET listing_url = 'https://bringatrailer.com/listing/1967-chevrolet-corvette-coupe-139/'
  WHERE id = '00000000-0000-4000-a067-000000000001';
UPDATE public.vehicles SET discovery_url = 'Corvette roadster, 4-speed' WHERE id = '00000000-0000-4000-a067-000000000002';
UPDATE public.vehicles SET listing_url = 'https://www.example.com/' WHERE id = '00000000-0000-4000-a067-000000000003';
-- g 4 is a "Corvette Stingray" (its name matched the longer phrase "corvette stingray") whose page says only
-- "corvette": the family is named, so it is the same car and stays (2026-10-15: the matched-phrase-only rule refused 535
-- of 548 Wrangler sales whose pages read "2000-jeep-wrangler-82").
UPDATE public.vehicles SET listing_url = 'https://bringatrailer.com/listing/1967-chevrolet-corvette-convertible-88/'
  WHERE id = '00000000-0000-4000-a067-000000000004';
-- g 6 and g 8 name the car only by an alias: "sting ray" (the family row) and "stingray" (its duplicate row). They stay.
UPDATE public.vehicles SET listing_url = 'https://bringatrailer.com/listing/1967-chevrolet-sting-ray-coupe/'
  WHERE id = '00000000-0000-4000-a067-000000000006';
UPDATE public.vehicles SET listing_url = 'https://www.mecum.com/lots/123/1967-chevrolet-stingray-427/'
  WHERE id = '00000000-0000-4000-a067-000000000008';
INSERT INTO public.vehicles (id, make, model, year, listing_url, discovery_url) VALUES
  ('00000000-0000-4000-a067-000000000101', 'Chevrolet', 'Corvette', 1967, 'https://bringatrailer.com/listing/1967-chevrolet-camaro-ss-12/', NULL),
  ('00000000-0000-4000-a067-000000000102', 'Chevrolet', 'Corvette Stingray', 1967, NULL, '1967 Chevrolet Chevelle SS 396'),
  -- a C10 whose only overlap with the family is the two-letter alias "cv" (in "cv joints"): too short to name it.
  ('00000000-0000-4000-a067-000000000103', 'Chevrolet', 'Corvette', 1967, 'https://bringatrailer.com/listing/1967-chevrolet-c10-cv-joints/', NULL);
INSERT INTO public.mv_treemap_outcomes (id, year, source_name, outcome, sold_amount) VALUES
  ('00000000-0000-4000-a067-000000000101', 1967, 'Bring a Trailer', 'sold', 1000),
  ('00000000-0000-4000-a067-000000000102', 1967, 'Mecum', 'sold', 500000),
  ('00000000-0000-4000-a067-000000000103', 1967, 'Bring a Trailer', 'sold', 2000);
-- Twins: 2 GMC K1500 sales (1995, 3,000 and 4,000, Mecum) and 12 Chevrolet K1500 sales (1995, 1,000 .. 12,000, BaT).
INSERT INTO public.vehicles (id, make, model, year)
SELECT ('00000000-0000-4000-d095-' || lpad(g::text, 12, '0'))::uuid, CASE WHEN g <= 2 THEN 'GMC' ELSE 'Chevrolet' END,
       'K1500', 1995 FROM generate_series(1, 14) g;
INSERT INTO public.mv_treemap_outcomes (id, year, source_name, outcome, sold_amount)
SELECT ('00000000-0000-4000-d095-' || lpad(g::text, 12, '0'))::uuid, 1995,
       CASE WHEN g <= 2 THEN 'Mecum' ELSE 'Bring a Trailer' END, 'sold',
       CASE WHEN g <= 2 THEN 2000 + g * 1000 ELSE (g - 2) * 1000 END FROM generate_series(1, 14) g;
-- A 1966: 4 sales at 1,000 .. 4,000 (Mecum).
INSERT INTO public.vehicles (id, make, model, year)
SELECT ('00000000-0000-4000-a066-' || lpad(g::text, 12, '0'))::uuid, 'Chevrolet', 'Corvette', 1966 FROM generate_series(1, 4) g;
INSERT INTO public.mv_treemap_outcomes (id, year, source_name, outcome, sold_amount)
SELECT ('00000000-0000-4000-a066-' || lpad(g::text, 12, '0'))::uuid, 1966, 'Mecum', 'sold', g * 1000 FROM generate_series(1, 4) g;
-- B: 1970 x3, 1971 x2, 1973 x4 sales at 5,000 each (Bring a Trailer) + a 1990 "electra 225" outside the family's
-- years + a "mystery" without a family.
INSERT INTO public.vehicles (id, make, model, year)
SELECT ('00000000-0000-4000-b000-' || lpad(g::text, 12, '0'))::uuid, 'Buick',
       CASE WHEN g = 11 THEN 'Mystery' ELSE 'Electra 225' END,
       CASE WHEN g <= 3 THEN 1970 WHEN g <= 5 THEN 1971 WHEN g <= 9 THEN 1973 WHEN g = 10 THEN 1990 ELSE 1971 END
FROM generate_series(1, 11) g;
INSERT INTO public.mv_treemap_outcomes (id, year, source_name, outcome, sold_amount)
SELECT v.id, v.year, 'Bring a Trailer', 'sold', 5000 FROM public.vehicles v WHERE v.make = 'Buick';

-- Asks on A 1967: 10 Facebook listings at 5,000 .. 50,000 first seen yesterday at 06:00 (vehicles a1..a10); a duplicate and a
-- blocked listing; one first seen today and one 400 days ago; vehicle a1 also has a newer Craigslist event at 6,000 (yesterday 12:00)
-- (its latest ask) and an older KSL one; a private vehicle's and a deleted vehicle's asks. Odometers: the Facebook
-- listings a1..a5 state g x 2,000 miles; vehicle a1 reads 77,000 (its Craigslist ask carries the vehicle's reading).
INSERT INTO public.vehicles (id, make, model, year, is_public, deleted_at, mileage)
SELECT ('00000000-0000-4000-e067-' || lpad(g::text, 12, '0'))::uuid, 'Chevrolet', 'Corvette', 1967,
       g <> 15, CASE WHEN g = 16 THEN now() END, CASE WHEN g = 1 THEN 77000 END
FROM generate_series(1, 16) g;
INSERT INTO public.marketplace_listings (id, vehicle_id, price, status, first_seen_at, mileage)
SELECT gen_random_uuid(), ('00000000-0000-4000-e067-' || lpad(g::text, 12, '0'))::uuid,
       CASE WHEN g <= 10 THEN g * 5000 ELSE 99000 END,
       CASE g WHEN 11 THEN 'duplicate' WHEN 12 THEN 'blocked' ELSE 'active' END,
       CASE g WHEN 13 THEN current_date + interval '1 minute' WHEN 14 THEN current_date - 400
            ELSE current_date - 1 + interval '6 hours' END,
       CASE WHEN g <= 5 THEN g * 2000 END
FROM generate_series(1, 16) g;
INSERT INTO public.vehicle_events (id, vehicle_id, source_platform, current_price, created_at) VALUES
  (gen_random_uuid(), '00000000-0000-4000-e067-000000000001', 'craigslist', 6000, current_date - 1 + interval '12 hours'),
  (gen_random_uuid(), '00000000-0000-4000-e067-000000000001', 'ksl', 7000, current_date - 3 + interval '12 hours'),
  (gen_random_uuid(), '00000000-0000-4000-e067-000000000002', 'bat', 80000, current_date - 2 + interval '12 hours');

\ir ../migrations/20261015130000_family_year_prices.sql
-- A second application changes nothing and passes its own guard and checks.
\ir ../migrations/20261015130000_family_year_prices.sql
-- 20261015160000 replaces the unbuilt view with the odometer columns; applied twice, the second changes nothing.
\ir ../migrations/20261015160000_family_year_prices_miles.sql
\ir ../migrations/20261015160000_family_year_prices_miles.sql
-- 20261015215000 replaces it again with venues (each source's count and median); applied twice.
\ir ../migrations/20261015215000_family_year_prices_venues.sql
\ir ../migrations/20261015215000_family_year_prices_venues.sql
-- 20261015218000 replaces it again, pooling badge twins by canonical_models.platform; applied twice.
\ir ../migrations/20261015218000_family_year_prices_platforms.sql
\ir ../migrations/20261015218000_family_year_prices_platforms.sql
SELECT pg_temp.ok('created empty: the deploy reads nothing; the first build is the refresh',
  NOT (SELECT relispopulated FROM pg_class WHERE oid = 'public.mv_family_year_prices'::regclass));
SELECT public.refresh_family_year_prices();
SELECT pg_temp.ok('the first refresh builds it (plain, not concurrently)',
  (SELECT relispopulated FROM pg_class WHERE oid = 'public.mv_family_year_prices'::regclass));

CREATE FUNCTION pg_temp.r(f text, y integer, b text) RETURNS public.mv_family_year_prices LANGUAGE sql AS
$$ SELECT * FROM public.mv_family_year_prices WHERE family_id = ('00000000-0000-4000-c000-00000000000' || f)::uuid AND year = y AND basis = b $$;

SELECT pg_temp.ok('A 1967 sold: its own 12 sales, offered 15, not thin; the Camaro, the Chevelle and the C10 are 3 conflicts; pages naming an alias (sting ray, stingray) stay',
  (SELECT year_from = 1967 AND year_to = 1967 AND n = 12 AND offered = 15 AND conflicts = 3 AND NOT thin
   FROM pg_temp.r('a', 1967, 'sold')));
SELECT pg_temp.ok('A 1967 sold: p10 21,000, p25 37,500, p50 65,000, p75 92,500, p90 109,000 (percentile_cont)',
  (SELECT p10 = 21000 AND p25 = 37500 AND p50 = 65000 AND p75 = 92500 AND p90 = 109000 FROM pg_temp.r('a', 1967, 'sold')));
SELECT pg_temp.ok('A 1967 sold: prices sorted; width_bucket counts sales at or below an ask (22,000 -> 2; 60,000 -> 6; 5,000 -> 0)',
  (SELECT prices = ARRAY[10000,20000,30000,40000,50000,60000,70000,80000,90000,100000,110000,120000]
      AND width_bucket(22000, prices) = 2 AND width_bucket(60000, prices) = 6 AND width_bucket(5000, prices) = 0
   FROM pg_temp.r('a', 1967, 'sold')));
SELECT pg_temp.ok('A 1967 sold: 8 BaT + 4 Mecum; 9 dated, first 2015-06-01, 6 in the last 24 months',
  (SELECT by_source = '{"Bring a Trailer": 8, "Mecum": 4}'::jsonb AND dated = 9 AND first_on = date '2015-06-01'
      AND last_on = current_date - 300 AND n_24m = 6 FROM pg_temp.r('a', 1967, 'sold')));
SELECT pg_temp.ok('A 1966 (4 sales) widens to 1965..1967: 16 sales, p50 over both years',
  (SELECT year_from = 1965 AND year_to = 1967 AND n = 16 AND NOT thin AND prices[1] = 1000 AND cardinality(prices) = 16
   FROM pg_temp.r('a', 1966, 'sold')));
SELECT pg_temp.ok('A 1968 (no sales of its own) borrows 1967: 1967..1969, 12 sales',
  (SELECT year_from = 1967 AND year_to = 1969 AND n = 12 FROM pg_temp.r('a', 1968, 'sold')));
SELECT pg_temp.ok('B 1971: 9 sales even at 1966..1976, thin, no percentiles; the 1990 Electra and the Mystery are not claimed',
  (SELECT year_from = 1966 AND year_to = 1976 AND n = 9 AND thin AND p50 IS NULL AND p10 IS NULL FROM pg_temp.r('b', 1971, 'sold'))
  AND NOT EXISTS (SELECT 1 FROM public.mv_family_year_prices WHERE family_id = '00000000-0000-4000-c000-00000000000b' AND year >= 1985));
SELECT pg_temp.ok('A 1967 asked: 10 asks, one per vehicle, a1 at its latest (Craigslist 6,000); never pooled with sales',
  (SELECT n = 10 AND offered IS NULL AND prices = ARRAY[6000,10000,15000,20000,25000,30000,35000,40000,45000,50000]
      AND by_source = '{"Craigslist": 1, "Facebook Marketplace": 9}'::jsonb FROM pg_temp.r('a', 1967, 'asked')));
SELECT pg_temp.ok('twins pool: the GMC K1500 row holds 14 sales (its 2 and the Chevrolet''s 12), names gm-k1500, venues by badge',
  (SELECT n = 14 AND platform = 'gm-k1500' AND year_from = 1995 AND year_to = 1995
      AND venues = '{"Bring a Trailer": {"n": 12, "p50": 6500}, "Mecum": {"n": 2, "p50": null}}'::jsonb
   FROM pg_temp.r('c', 1995, 'sold'))
  AND (SELECT n = 14 AND platform = 'gm-k1500' FROM pg_temp.r('d', 1995, 'sold')));
SELECT pg_temp.ok('a family without a platform pools alone and names none',
  (SELECT platform IS NULL AND n = 12 FROM pg_temp.r('a', 1967, 'sold')));
SELECT pg_temp.ok('A 1967 sold venues: Bring a Trailer 8 (median 45,000), Mecum 4 (under 5 prices, no median)',
  (SELECT venues = '{"Bring a Trailer": {"n": 8, "p50": 45000}, "Mecum": {"n": 4, "p50": null}}'::jsonb
   FROM pg_temp.r('a', 1967, 'sold')));
SELECT pg_temp.ok('A 1967 asked venues: Facebook 9 (median 30,000), Craigslist 1',
  (SELECT venues = '{"Craigslist": {"n": 1, "p50": null}, "Facebook Marketplace": {"n": 9, "p50": 30000}}'::jsonb
   FROM pg_temp.r('a', 1967, 'asked')));
SELECT pg_temp.ok('A 1967 sold miles: 10 readings 1,000 .. 10,000, median 5,000 (a zero and a 2,500,000 reading are unknown)',
  (SELECT n_miles = 10 AND miles = ARRAY[1000,2000,3000,4000,5000,6000,7000,8000,9000,10000] AND miles_p50 = 5000
   AND width_bucket(7500, miles) = 7 FROM pg_temp.r('a', 1967, 'sold')));
SELECT pg_temp.ok('A 1966 pools the window''s readings (1965..1967): the 1967 sales'' 10',
  (SELECT n_miles = 10 FROM pg_temp.r('a', 1966, 'sold')));
SELECT pg_temp.ok('A 1967 asked miles: 5 readings; the Craigslist ask carries its vehicle''s 77,000; under 10, no median',
  (SELECT n_miles = 5 AND miles = ARRAY[4000,6000,8000,10000,77000] AND miles_p50 IS NULL FROM pg_temp.r('a', 1967, 'asked')));
SELECT pg_temp.ok('B 1971 (no readings): no miles, n_miles 0',
  (SELECT n_miles = 0 AND miles = '{}'::integer[] FROM pg_temp.r('b', 1971, 'sold')));
SELECT pg_temp.ok('no duplicate, blocked, same-day, year-old, private or deleted ask; no auction event counts as an ask',
  (SELECT NOT (prices && ARRAY[99000, 80000]) FROM pg_temp.r('a', 1967, 'asked')));
SELECT pg_temp.ok('no vehicle or listing id column',
  NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.mv_family_year_prices'::regclass AND attnum > 0
              AND (attname LIKE '%vehicle%' OR attname LIKE '%listing%' OR attname = 'id')));

SET ROLE anon;
SELECT pg_temp.ok('anon reads it', (SELECT count(*) > 0 FROM public.mv_family_year_prices));
RESET ROLE;
SET ROLE anon;
DO $$ BEGIN
  PERFORM public.refresh_family_year_prices();
  RAISE EXCEPTION 'anon refreshed the fold';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;
SELECT pg_temp.ok('anon cannot run the refresh', true);
SELECT public.refresh_family_year_prices();
SELECT pg_temp.ok('refreshes concurrently through refresh_family_year_prices(), scheduled once at 09:40',
  (SELECT count(*) FROM cron.job WHERE jobname = 'refresh-family-year-prices') = 1
  AND (SELECT schedule FROM cron.job WHERE jobname = 'refresh-family-year-prices') = '40 9 * * *'
  AND (SELECT command FROM cron.job WHERE jobname = 'refresh-family-year-prices') LIKE '%refresh_family_year_prices()%'
  AND (SELECT n FROM public.mv_family_year_prices WHERE year = 1967 AND basis = 'sold'
         AND family_id = '00000000-0000-4000-c000-00000000000a') = 12);
-- After the first build, 20261015160000 and 20261015215000 apply again without dropping or emptying the built view.
\ir ../migrations/20261015160000_family_year_prices_miles.sql
\ir ../migrations/20261015215000_family_year_prices_venues.sql
\ir ../migrations/20261015218000_family_year_prices_platforms.sql
SELECT pg_temp.ok('re-applying the odometer migration after the build keeps the built view',
  (SELECT relispopulated FROM pg_class WHERE oid = 'public.mv_family_year_prices'::regclass)
  AND (SELECT n_miles FROM public.mv_family_year_prices WHERE year = 1967 AND basis = 'sold'
         AND family_id = '00000000-0000-4000-c000-00000000000a') = 10);
