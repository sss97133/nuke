\set ON_ERROR_STOP on
-- Contract for migration 20261114001000_bat_live_bid_freshness.sql (T7). Synthetic rows only; never production.
-- Run in an empty disposable dm_refinement_* database: scripts/ci/run-db-contracts.sh test_bat_live_bid_freshness.sql
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' THEN RAISE EXCEPTION 'refusing: not a dm_refinement_* database'; END IF;
  IF to_regclass('public.vehicles') IS NOT NULL THEN RAISE EXCEPTION 'refusing: database is not empty'; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

-- Fixture: the production columns the trigger and the catch-up read, and stand-ins for their dependencies.
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY, source text, listing_source text, discovery_source text, auction_source text,
  sale_status text, auction_outcome text, reserve_status text, listing_url text, discovery_url text,
  sale_price integer, winning_bid integer, bat_sold_price numeric, sold_price integer, high_bid integer,
  asking_price numeric, price integer, notes text, import_metadata jsonb, origin_metadata jsonb,
  created_at timestamptz DEFAULT now(), deleted_at timestamptz,
  canonical_platform text, canonical_outcome text, canonical_sold_price numeric);
CREATE FUNCTION public.resolve_platform_slug(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT lower($1) $$;
-- stand-in: the real rule reads status and platform sale markers; a 'sold' status is enough here
CREATE FUNCTION public.vehicle_sale_basis(text, text, text, text, text, numeric, text, jsonb, timestamptz)
  RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT CASE WHEN $1 = 'sold' THEN 'status' END $$;
CREATE TABLE public.live_auction_sources (id uuid PRIMARY KEY, slug text);
CREATE TABLE public.monitored_auctions (
  id uuid PRIMARY KEY, source_id uuid, vehicle_id uuid, external_auction_url text, auction_end_time timestamptz,
  is_live boolean, last_synced_at timestamptz, next_poll_at timestamptz, poll_interval_ms integer, stream_state jsonb);
CREATE TABLE public.auction_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, source_url text, high_bid numeric,
  updated_at timestamptz, duplicate_of uuid);
CREATE SCHEMA net;
CREATE TABLE net.calls (url text, headers jsonb, body jsonb, timeout_milliseconds integer);
CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}', params jsonb DEFAULT '{}', headers jsonb DEFAULT '{}',
  timeout_milliseconds integer DEFAULT 5000) RETURNS bigint LANGUAGE sql AS
  $$ INSERT INTO net.calls VALUES (url, headers, body, timeout_milliseconds); SELECT 1::bigint $$;
CREATE FUNCTION public.get_service_url() RETURNS text LANGUAGE sql AS $$ SELECT 'https://example.test' $$;
CREATE FUNCTION public.get_service_role_key_for_cron() RETURNS text LANGUAGE sql AS $$ SELECT 'test-key' $$;

INSERT INTO public.live_auction_sources VALUES ('00000000-0000-0000-0000-0000000000ba', 'bat'),
                                               ('00000000-0000-0000-0000-0000000000cb', 'carsandbids');
-- Live lots. Board = BaT's /auctions/ feed (origin_metadata.source_current_bid, source_read_at); stored = auction_events.
CREATE TEMP TABLE lots (k text, src text, board numeric, board_age interval, stored numeric, stored_age interval,
                        ends interval, synced_age interval, stream boolean);
INSERT INTO lots VALUES
  ('a206',  'ba', 39993, '90 minutes', 20993, '18 hours', '3 days',     '18 hours', false), -- #206: behind -> dispatch
  ('same',  'ba', 50000, '1 hour',  50000, '2 hours',  '2 days',     '5 hours',  false), -- in step
  ('soon',  'ba', 60000, '1 hour',  55000, '2 hours',  '10 minutes', '5 hours',  false), -- behind, stream window
  ('fresh', 'ba', 70000, '1 hour',  65000, '2 hours',  '2 days',     '5 minutes',false), -- behind, just dispatched
  ('none',  'ba', 12000, '30 minutes', NULL, NULL,     '4 days',     NULL,       false), -- no stored row -> dispatch
  ('newer', 'ba', 30000, '3 hours', 31000, '1 hour',   '2 days',     '5 hours',  false), -- stored is newer than board
  ('cb',    'cb', 80000, '1 hour',  70000, '5 hours',  '2 days',     '5 hours',  false), -- not BaT
  ('zero',  'ba', 0,     '1 hour',  NULL,  NULL,       '6 days',     '5 hours',  false), -- no bids yet
  ('strm',  'ba', 90000, '1 hour',  85000, '2 hours',  '1 day',      '5 hours',  true);  -- live stream connected
INSERT INTO public.vehicles (id, source, sale_status, high_bid, origin_metadata)
SELECT md5('v' || k)::uuid, 'bat', 'auction_live', board::int,
       jsonb_build_object('source_current_bid', board, 'source_read_at', now() - board_age)
FROM lots;
INSERT INTO public.monitored_auctions
SELECT md5('m' || k)::uuid, ('00000000-0000-0000-0000-0000000000' || src)::uuid, md5('v' || k)::uuid,
       'https://bringatrailer.com/listing/lot-' || k, now() + ends, true, now() - synced_age, now() + interval '1 hour',
       3600000,
       CASE WHEN stream THEN jsonb_build_object('sessions', jsonb_build_object('s1', jsonb_build_object('connected', true, 'at', now())))
            ELSE '{}'::jsonb END
FROM lots;
INSERT INTO public.auction_events (vehicle_id, source_url, high_bid, updated_at)
SELECT md5('v' || k)::uuid, 'https://bringatrailer.com/listing/lot-' || k || '/', stored, now() - stored_age
FROM lots WHERE stored IS NOT NULL;
-- a merged duplicate row is never the stored bid
INSERT INTO public.auction_events (vehicle_id, source_url, high_bid, updated_at, duplicate_of)
VALUES (md5('vsame')::uuid, 'https://bringatrailer.com/listing/lot-same', 1, now(), gen_random_uuid());
CREATE TEMP TABLE before_rows AS
  SELECT 'v' t, row(v.*)::text r FROM public.vehicles v UNION ALL SELECT 'm', row(m.*)::text FROM public.monitored_auctions m
  UNION ALL SELECT 'a', row(a.*)::text FROM public.auction_events a;

\ir ../migrations/20261114001000_bat_live_bid_freshness.sql

DO $$ BEGIN
  IF (SELECT count(*) FROM (
        SELECT 'v' t, row(v.*)::text r FROM public.vehicles v UNION ALL SELECT 'm', row(m.*)::text FROM public.monitored_auctions m
        UNION ALL SELECT 'a', row(a.*)::text FROM public.auction_events a
        EXCEPT SELECT t, r FROM pg_temp.before_rows) d) <> 0 OR (SELECT count(*) FROM net.calls) <> 0
  THEN RAISE EXCEPTION 'the migration changed rows or dispatched'; END IF;
  RAISE NOTICE 'PASS migration changes no rows and dispatches nothing';
END $$;

-- 1. canonical_sold_price
CREATE TRIGGER trg_resolve_canonical_columns BEFORE INSERT OR UPDATE ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.trg_resolve_canonical_columns();
INSERT INTO public.vehicles (id, source, sale_status, high_bid, sale_price, asking_price, reserve_status) VALUES
  ('10000000-0000-0000-0000-000000000049', 'bat', 'auction_live', 350000, NULL, NULL, NULL),  -- the unsold GT3 RS #49
  ('10000000-0000-0000-0000-000000000002', 'bat', 'upcoming', 1000, NULL, NULL, NULL),
  ('10000000-0000-0000-0000-000000000003', 'bat', 'sold', 90000, 90000, NULL, NULL),
  ('10000000-0000-0000-0000-000000000004', 'bat', 'not_sold', 41000, NULL, NULL, 'reserve_not_met'),
  ('10000000-0000-0000-0000-000000000005', 'bat', 'for_sale', NULL, NULL, 25000, NULL),
  ('10000000-0000-0000-0000-000000000006', 'bat', 'ended', 33000, NULL, NULL, NULL);
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('10000000-0000-0000-0000-000000000049'::uuid, 'active', NULL::numeric),
      ('10000000-0000-0000-0000-000000000002', 'active', NULL),
      ('10000000-0000-0000-0000-000000000003', 'sold', 90000),
      ('10000000-0000-0000-0000-000000000004', 'reserve_not_met', 41000),
      ('10000000-0000-0000-0000-000000000005', 'for_sale', 25000),
      ('10000000-0000-0000-0000-000000000006', 'ended', 33000)) x(id, outcome, price)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = r.id AND v.canonical_outcome = r.outcome
                   AND v.canonical_sold_price IS NOT DISTINCT FROM r.price)
    THEN RAISE EXCEPTION 'canonical for %: % %', r.id,
      (SELECT canonical_outcome FROM public.vehicles WHERE id = r.id), (SELECT canonical_sold_price FROM public.vehicles WHERE id = r.id);
    END IF;
  END LOOP;
  -- a live bid that rises stays out; the hammer lands it
  UPDATE public.vehicles SET high_bid = 360000 WHERE id = '10000000-0000-0000-0000-000000000049';
  IF (SELECT canonical_sold_price FROM public.vehicles WHERE id = '10000000-0000-0000-0000-000000000049') IS NOT NULL
  THEN RAISE EXCEPTION 'live bid written as canonical_sold_price'; END IF;
  UPDATE public.vehicles SET sale_status = 'sold', sale_price = 360000 WHERE id = '10000000-0000-0000-0000-000000000049';
  IF (SELECT canonical_sold_price FROM public.vehicles WHERE id = '10000000-0000-0000-0000-000000000049') IS DISTINCT FROM 360000
  THEN RAISE EXCEPTION 'sold price not resolved'; END IF;
  RAISE NOTICE 'PASS live/upcoming lots get no canonical_sold_price; sold, reserve-not-met, for-sale and ended unchanged';
END $$;
DROP TRIGGER trg_resolve_canonical_columns ON public.vehicles;
DELETE FROM public.vehicles WHERE id::text LIKE '10000000-%';

-- 2. lag reader
DO $$ DECLARE lag jsonb := public.bat_live_bid_lag(); behind_set text; BEGIN
  SELECT string_agg(split_part(lot_url, 'lot-', 2), ',' ORDER BY lot_url) INTO behind_set FROM public.bat_live_bid_lag_rows() WHERE behind;
  IF behind_set IS DISTINCT FROM 'a206,fresh,none,soon,strm' THEN RAISE EXCEPTION 'behind set %', behind_set; END IF;
  IF (lag->>'live_lots')::int <> 8 OR (lag->>'behind')::int <> 5 OR (lag->>'behind_over_1h')::int <> 1
     OR (lag->>'no_stored_row')::int <> 2 OR (lag->>'max_lag_minutes')::int <> 90
  THEN RAISE EXCEPTION 'lag %', lag; END IF;
  IF (SELECT stored_bid FROM public.bat_live_bid_lag_rows() WHERE lot_url LIKE '%lot-same') <> 50000
  THEN RAISE EXCEPTION 'duplicate auction_events row used as the stored bid'; END IF;
  RAISE NOTICE 'PASS lag reader: #206-type lot behind; equal, newer-stored, no-bid and non-BaT lots not behind (%)', lag;
END $$;

-- 3. catch-up
DO $$ DECLARE res jsonb; c record; BEGIN
  res := public.bat_live_bid_catchup(1);  -- the earliest-closing eligible lot only
  IF (res->>'dispatched')::int <> 1 OR (SELECT count(*) FROM net.calls) <> 1
     OR (SELECT body->>'url' FROM net.calls) <> 'https://bringatrailer.com/listing/lot-a206'
  THEN RAISE EXCEPTION 'p_max 1: % %', res, (SELECT json_agg(x) FROM net.calls x); END IF;
  res := public.bat_live_bid_catchup(20);
  IF (res->>'dispatched')::int <> 1 OR (SELECT string_agg(body->>'url', ',' ORDER BY body->>'url') FROM net.calls)
     <> 'https://bringatrailer.com/listing/lot-a206,https://bringatrailer.com/listing/lot-none'
  THEN RAISE EXCEPTION 'second run: % %', res, (SELECT json_agg(x) FROM net.calls x); END IF;
  SELECT * INTO c FROM net.calls WHERE body->>'url' LIKE '%a206';
  IF c.url <> 'https://example.test/functions/v1/extract-bat-core' OR c.headers->>'Authorization' <> 'Bearer test-key'
     OR (c.body->'prefer_snapshot')::boolean IS NOT false
  THEN RAISE EXCEPTION 'dispatch shape %', row_to_json(c); END IF;
  IF (SELECT last_synced_at FROM public.monitored_auctions WHERE external_auction_url LIKE '%lot-a206') < now()
     OR (SELECT next_poll_at FROM public.monitored_auctions WHERE external_auction_url LIKE '%lot-a206') <> now() + interval '1 hour'
  THEN RAISE EXCEPTION 'monitor bookkeeping not updated'; END IF;
  -- spacing: a third run in the same 30 min sends nothing
  res := public.bat_live_bid_catchup(20);
  IF (res->>'dispatched')::int <> 0 THEN RAISE EXCEPTION 'redispatched %', res; END IF;
  -- the catch-up never writes vehicles or auction_events itself (the dispatched reader does)
  IF (SELECT count(*) FROM (SELECT 'v' t, row(v.*)::text r FROM public.vehicles v UNION ALL SELECT 'a', row(a.*)::text FROM public.auction_events a
      EXCEPT SELECT t, r FROM pg_temp.before_rows) d) <> 0 THEN RAISE EXCEPTION 'catch-up wrote vehicles or auction_events'; END IF;
  RAISE NOTICE 'PASS catch-up dispatches extract-bat-core for #206-type and no-row lots only (not closing <15 min, just dispatched, or streaming), earliest close first, once per 30 min';
END $$;

-- 4. grants
DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['public.bat_live_bid_lag_rows()', 'public.bat_live_bid_lag()', 'public.bat_live_bid_catchup(integer)'] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE')
       OR NOT has_function_privilege('service_role', f, 'EXECUTE') THEN RAISE EXCEPTION 'grant on % is not service_role only', f; END IF;
  END LOOP;
  RAISE NOTICE 'PASS execute granted to service_role only';
END $$;
