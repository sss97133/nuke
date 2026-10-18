-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_listing_exit_models -f this-file.sql
-- Contract for 20261015140000_listing_exit_models.sql. Synthetic rows only; never production.
-- marketplace_listings and vehicle_events (here tables with the columns the view reads, 2026-10-15) feed
-- v_classified_exit_outcomes:
--   * Facebook: gone within 7 days of first sight is exited; gone later, or seen again 7+ days on, is stayed; seen once
--     is unknown; a removal stamped before first sight is not an exit; duplicate and blocked listings are left out;
--   * Craigslist: an ended listing with its 404 is exited or stayed by its ended_at; a live listing checked 8 days on
--     stayed; one never checked is unknown; events before 2026-10-13 (no revisit existed) and non-listing events are
--     left out;
--   * the view is the service role's only; listing_exit_models allows one active version, refuses an empty feature list
--     or a base rate outside (0, 1), and anon reads it; the migration applies twice.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.marketplace_listings') IS NOT NULL THEN
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

CREATE TABLE public.marketplace_listings (id uuid PRIMARY KEY, vehicle_id uuid, price integer, status text, location text,
  first_seen_at timestamptz, last_seen_at timestamptz, removed_at timestamptz, removal_reason text);
CREATE TABLE public.vehicle_events (id uuid PRIMARY KEY, vehicle_id uuid, source_platform text, event_type text,
  event_status text, current_price numeric, created_at timestamptz, ended_at timestamptz, metadata jsonb, source_url text);
CREATE TABLE public.vehicle_location_observations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid,
  source_type text, source_url text, observed_at timestamptz, region_code text);
GRANT SELECT ON public.marketplace_listings, public.vehicle_events, public.vehicle_location_observations
  TO anon, authenticated, service_role;

-- Places: listing f1 in San Antonio, TX; f2 at an unparsed place; Craigslist e1's listing place is NV (a later place
-- observation from another page says ME and is not its place).
INSERT INTO public.marketplace_listings (id, price, status, location, first_seen_at, last_seen_at, removed_at, removal_reason) VALUES
  ('00000000-0000-4000-f000-000000000001', 5000, 'removed', 'San Antonio, TX', '2026-03-01', '2026-03-03', '2026-03-04', 'not_seen_in_sweep'),
  ('00000000-0000-4000-f000-000000000002', 5000, 'removed', 'somewhere', '2026-03-01', '2026-03-20', '2026-03-21', 'not_seen_in_sweep');
INSERT INTO public.vehicle_location_observations (vehicle_id, source_type, source_url, observed_at, region_code) VALUES
  ('00000000-0000-4000-d000-000000000001', 'listing', 'https://cl/1', '2026-10-14', 'NV'),
  ('00000000-0000-4000-d000-000000000001', 'listing', 'https://other/2', '2026-10-15', 'ME');
INSERT INTO public.marketplace_listings (id, price, status, first_seen_at, last_seen_at, removed_at, removal_reason) VALUES
  ('00000000-0000-4000-f000-000000000003', 5000, 'active', '2026-03-01', '2026-03-09', NULL, NULL),
  ('00000000-0000-4000-f000-000000000004', 5000, 'active', '2026-03-01', '2026-03-01', NULL, NULL),
  ('00000000-0000-4000-f000-000000000005', 5000, 'active', '2026-03-05', '2026-03-01', '2026-03-02', 'not_seen_in_sweep'),
  ('00000000-0000-4000-f000-000000000006', 5000, 'duplicate', '2026-03-01', '2026-03-02', NULL, NULL),
  ('00000000-0000-4000-f000-000000000007', 5000, 'blocked', '2026-03-01', '2026-03-02', NULL, NULL);
INSERT INTO public.vehicle_events (id, vehicle_id, source_url, source_platform, event_type, event_status, current_price,
  created_at, ended_at, metadata) VALUES
  ('00000000-0000-4000-e000-000000000001', '00000000-0000-4000-d000-000000000001', 'https://cl/1', 'craigslist', 'listing',
     'ended', 9000, '2026-10-14 00:00Z', '2026-10-16 00:00Z', '{"removal": {"http_status": 404, "basis": "revisit"}}');
INSERT INTO public.vehicle_events (id, source_platform, event_type, event_status, current_price, created_at, ended_at, metadata) VALUES
  ('00000000-0000-4000-e000-000000000002', 'craigslist', 'listing', 'unknown', 9000, '2026-10-14 00:00Z', NULL,
     '{"last_checked_at": "2026-10-22T00:00:00.000Z"}'),
  ('00000000-0000-4000-e000-000000000003', 'craigslist', 'listing', 'unknown', 9000, '2026-10-14 00:00Z', NULL, '{}'),
  ('00000000-0000-4000-e000-000000000004', 'craigslist', 'listing', 'ended', 9000, '2026-10-14 00:00Z', '2026-10-30 00:00Z',
     '{"removal": {"http_status": 410}}'),
  ('00000000-0000-4000-e000-000000000005', 'craigslist', 'listing', 'sold', 9000, '2026-01-14 00:00Z', NULL, '{}'),
  ('00000000-0000-4000-e000-000000000006', 'craigslist', 'sale', 'ended', 9000, '2026-10-14 00:00Z', '2026-10-15 00:00Z', '{}'),
  ('00000000-0000-4000-e000-000000000007', 'bat', 'listing', 'ended', 9000, '2026-10-14 00:00Z', '2026-10-15 00:00Z', '{}');

\ir ../migrations/20261015140000_listing_exit_models.sql
\ir ../migrations/20261015140000_listing_exit_models.sql

CREATE FUNCTION pg_temp.fate(ref text) RETURNS text LANGUAGE sql AS
$$ SELECT fate_7d FROM public.v_classified_exit_outcomes WHERE listing_ref::text LIKE '%' || ref $$;

SELECT pg_temp.ok('Facebook: gone in 3 days exited; gone on day 20 stayed; seen on day 8 stayed; seen once unknown',
  pg_temp.fate('f000-000000000001') = 'exited' AND pg_temp.fate('f000-000000000002') = 'stayed'
  AND pg_temp.fate('f000-000000000003') = 'stayed' AND pg_temp.fate('f000-000000000004') = 'unknown');
SELECT pg_temp.ok('Facebook: a removal stamped before first sight is not an exit',
  (SELECT exited_at IS NULL AND exit_evidence IS NULL AND fate_7d = 'unknown'
   FROM public.v_classified_exit_outcomes WHERE listing_ref = '00000000-0000-4000-f000-000000000005'));
SELECT pg_temp.ok('Facebook: duplicate and blocked listings are left out',
  pg_temp.fate('f000-000000000006') IS NULL AND pg_temp.fate('f000-000000000007') IS NULL);
SELECT pg_temp.ok('region: Facebook "City, ST" gives TX, an unparsed place none; Craigslist its listing place (NV, not ME)',
  (SELECT region_code FROM public.v_classified_exit_outcomes WHERE listing_ref = '00000000-0000-4000-f000-000000000001') = 'TX'
  AND (SELECT region_code FROM public.v_classified_exit_outcomes WHERE listing_ref = '00000000-0000-4000-f000-000000000002') IS NULL
  AND (SELECT region_code FROM public.v_classified_exit_outcomes WHERE listing_ref = '00000000-0000-4000-e000-000000000001') = 'NV');
SELECT pg_temp.ok('Facebook: the exit evidence and the days observed',
  (SELECT exit_evidence = 'not_seen_in_sweep' AND days_observed = 3 FROM public.v_classified_exit_outcomes
   WHERE listing_ref = '00000000-0000-4000-f000-000000000001'));
SELECT pg_temp.ok('Craigslist: a 404 two days in exited; checked live 8 days in stayed; never checked unknown; a 410 on day 16 stayed',
  pg_temp.fate('e000-000000000001') = 'exited' AND pg_temp.fate('e000-000000000002') = 'stayed'
  AND pg_temp.fate('e000-000000000003') = 'unknown' AND pg_temp.fate('e000-000000000004') = 'stayed');
SELECT pg_temp.ok('Craigslist: the revisit evidence travels as http_404',
  (SELECT exit_evidence = 'http_404' AND basis = 'craigslist_revisit' FROM public.v_classified_exit_outcomes
   WHERE listing_ref = '00000000-0000-4000-e000-000000000001'));
SELECT pg_temp.ok('Craigslist: before 2026-10-13, non-listing events and other sources are left out',
  pg_temp.fate('e000-000000000005') IS NULL AND pg_temp.fate('e000-000000000006') IS NULL
  AND pg_temp.fate('e000-000000000007') IS NULL);

INSERT INTO public.listing_exit_models (version, active, horizon_days, label, intercept, features, base_rate, trained_on, evaluated_on, receipt)
VALUES ('t1', true, 7, 'gone within 7 days', -2.0, '[{"name":"x","definition":"d","mean":0,"sd":1,"coef":0.5}]', 0.1, '{}', '{}', 'r');
DO $$ BEGIN
  BEGIN
    INSERT INTO public.listing_exit_models (version, active, horizon_days, label, intercept, features, base_rate, trained_on, evaluated_on, receipt)
    VALUES ('t2', true, 7, 'l', 0, '[{"name":"x"}]', 0.1, '{}', '{}', 'r');
    RAISE EXCEPTION 'a second active model was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.listing_exit_models (version, horizon_days, label, intercept, features, base_rate, trained_on, evaluated_on, receipt)
    VALUES ('t3', 7, 'l', 0, '[]', 0.1, '{}', '{}', 'r');
    RAISE EXCEPTION 'an empty feature list was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.listing_exit_models (version, horizon_days, label, intercept, features, base_rate, trained_on, evaluated_on, receipt)
    VALUES ('t4', 7, 'l', 0, '[{"name":"x"}]', 1.0, '{}', '{}', 'r');
    RAISE EXCEPTION 'a base rate of 1 was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
SELECT pg_temp.ok('one active model; an empty feature list and a base rate of 1 are refused', true);

SET ROLE anon;
SELECT pg_temp.ok('anon reads the models', (SELECT count(*) FROM public.listing_exit_models) = 1);
DO $$ BEGIN
  PERFORM 1 FROM public.v_classified_exit_outcomes;
  RAISE EXCEPTION 'anon read the exit outcomes';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
SELECT pg_temp.ok('anon cannot read the exit outcomes', true);
RESET ROLE;
SET ROLE service_role;
SELECT pg_temp.ok('the service role reads the exit outcomes', (SELECT count(*) FROM public.v_classified_exit_outcomes) = 9);
RESET ROLE;
