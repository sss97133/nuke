-- Isolated PostgreSQL 17 contract for 20261006130000_idx_auction_events_bat_lot_slug.sql and
-- 20261006131500_create_missing_bat_auction_events.sql. Synthetic rows only; never production.
-- Run in an empty disposable dm_refinement_* database:
--   createdb dm_refinement_missing_bat_lots_ci
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_missing_bat_lots_ci -f supabase/sql/test_missing_bat_lots.sql
-- Fixtures: auto_create_transfer_on_auction_close() is the live body (read 2026-10-06) with net.http_post stubbed to
-- a log table; key_auction_comment_lots comes from its migration (20261006110000) for the end-to-end check.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR to_regclass('public.auction_events') IS NOT NULL
     OR to_regclass('public.vehicle_events') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '30s';
SET lock_timeout = '3s';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

-- Prod shapes (columns the writer and the trigger touch; constraints as on prod 2026-10-06).
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text DEFAULT 'active',
  merged_into_vehicle_id uuid, deleted_at timestamptz
);
CREATE TABLE public.auction_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid, source text NOT NULL, source_url text, source_listing_id text, lot_number text,
  auction_start_date timestamptz, auction_end_date timestamptz,
  outcome text NOT NULL CONSTRAINT auction_events_outcome_check
    CHECK (outcome = ANY (ARRAY['sold','reserve_not_met','no_sale','bid_to','cancelled','relisted','pending','live'])),
  high_bid numeric, winning_bid numeric, winning_bidder text, seller_name text, total_bids integer,
  unique_bidders integer, page_views integer, watchers integer, comments_count integer,
  scraped_at timestamptz DEFAULT now(), raw_data jsonb,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.auction_events ADD CONSTRAINT auction_events_vehicle_id_fkey
  FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE RESTRICT NOT VALID;
CREATE UNIQUE INDEX idx_auction_events_vehicle_source_url ON public.auction_events (vehicle_id, source_url);
CREATE INDEX idx_auction_events_vehicle ON public.auction_events (vehicle_id);
CREATE TABLE public.vehicle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid NOT NULL, source_platform text NOT NULL,
  source_url text, source_listing_id text, event_type text NOT NULL DEFAULT 'auction', event_status text NOT NULL,
  ended_at timestamptz, sold_at timestamptz, current_price numeric, final_price numeric,
  bid_count integer DEFAULT 0, comment_count integer DEFAULT 0, view_count integer DEFAULT 0, watcher_count integer DEFAULT 0,
  seller_identifier text, buyer_identifier text, metadata jsonb DEFAULT '{}'::jsonb,
  extracted_at timestamptz DEFAULT now(), extraction_method text, extraction_source text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  pad text DEFAULT repeat('p', 5000)  -- test only: PLAIN storage puts one row per heap block
);
ALTER TABLE public.vehicle_events ALTER COLUMN pad SET STORAGE PLAIN;
CREATE INDEX idx_vehicle_events_source_url ON public.vehicle_events (source_url);
CREATE TABLE public.bat_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, bat_listing_url text NOT NULL UNIQUE,
  bat_lot_number text, auction_end_date date, sale_date date, sale_price integer, final_bid integer,
  seller_username text, buyer_username text, comment_count integer DEFAULT 0, bid_count integer DEFAULT 0,
  view_count integer DEFAULT 0, listing_status text, scraped_at timestamptz DEFAULT now(), raw_data jsonb,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.auction_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_event_id uuid REFERENCES public.auction_events(id) ON DELETE CASCADE,
  vehicle_id uuid, platform text, source_url text, content_hash text, comment_text text
);
CREATE INDEX idx_auction_comments_auction ON public.auction_comments (auction_event_id);
CREATE TABLE public.pipeline_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_name text NOT NULL, column_name text,
  owned_by text NOT NULL, description text NOT NULL, valid_values text[],
  do_not_write_directly boolean NOT NULL DEFAULT false, write_via text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (table_name, column_name)
);
-- The live transfer trigger, with pg_net stubbed: every call is logged.
CREATE TABLE public._app_secrets (key text PRIMARY KEY, value text);
CREATE SCHEMA net;
CREATE TABLE net.calls (id bigint GENERATED ALWAYS AS IDENTITY, url text, body jsonb);
CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds integer) RETURNS bigint
LANGUAGE sql AS $$ INSERT INTO net.calls (url, body) VALUES (url, body) RETURNING id $$;
CREATE OR REPLACE FUNCTION public.auto_create_transfer_on_auction_close()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE
  v_url text;
  v_key text;
BEGIN
  IF NEW.outcome IS DISTINCT FROM 'sold' THEN
    RETURN NEW;
  END IF;
  IF OLD.outcome = 'sold' THEN
    RETURN NEW;
  END IF;
  v_key := COALESCE(
    (SELECT value FROM public._app_secrets WHERE key = 'service_role_key' LIMIT 1),
    current_setting('app.settings.service_role_key', true),
    current_setting('app.service_role_key', true)
  );
  v_url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/transfer-automator';
  BEGIN
    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || COALESCE(v_key, '')),
      body := jsonb_build_object('action', 'seed_from_auction', 'auction_event_id', NEW.id::text),
      timeout_milliseconds := 30000
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[auto_create_transfer] pg_net call failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER trg_auto_create_transfer_on_auction_close AFTER INSERT OR UPDATE OF outcome ON public.auction_events
FOR EACH ROW EXECUTE FUNCTION public.auto_create_transfer_on_auction_close();

-- Vehicles ------------------------------------------------------------------------------------------------------
CREATE TEMP TABLE v(name text PRIMARY KEY, id uuid);
INSERT INTO v SELECT n, gen_random_uuid() FROM unnest(ARRAY[
  'sold','bidto','exists_other','exists_case','holder','gone','merged','twin_a','twin_b','live','cheap','noresult',
  'endedsale','disagree','slash','versions','future','nobl','filler',
  'bl_sold','bl_slash','bl_owned','bl_twin_a','bl_twin_b','bl_cheap','bl_exists','bl_endedsale',
  'cv1','cv2a','cv2b','cv3','cv6','gone2']) n;
INSERT INTO public.vehicles (id, status, merged_into_vehicle_id)
SELECT id, CASE WHEN name = 'merged' THEN 'merged' ELSE 'active' END,
       CASE WHEN name = 'merged' THEN (SELECT id FROM v WHERE name = 'holder') END
FROM v WHERE name NOT IN ('gone', 'gone2');
CREATE FUNCTION pg_temp.vid(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM v WHERE name = n $$;
CREATE FUNCTION pg_temp.u(s text) RETURNS text LANGUAGE sql AS $$ SELECT 'https://bringatrailer.com/listing/' || s $$;

-- Existing lots (never touched): lot-x on 'holder'; LOT-Y written upper-case with a slash on 'holder';
-- a Cars and Bids lot; bl-exists's lot on 'holder'.
INSERT INTO public.auction_events (vehicle_id, source, source_url, outcome, high_bid, raw_data)
VALUES (pg_temp.vid('holder'), 'bat', pg_temp.u('lot-x'), 'sold', 50000, '{"extractor":"extract-bat-core"}'),
       (pg_temp.vid('holder'), 'bat', pg_temp.u('LOT-Y/'), 'bid_to', 7000, '{"extractor":"extract-bat-core"}'),
       (pg_temp.vid('holder'), 'cars_and_bids', 'https://carsandbids.com/auctions/abc/2001-bmw-m3', 'sold', 30000, NULL),
       (pg_temp.vid('holder'), 'bat', pg_temp.u('lot-blx'), 'sold', 9000, NULL);

-- Filler: BaT rows whose lot exists (lot-x on other vehicles is NOT that; these are 'holder' itself) and non-BaT rows,
-- padded so evidence spreads over many heap blocks.
INSERT INTO public.vehicle_events (vehicle_id, source_platform, source_url, event_status, current_price, metadata)
SELECT pg_temp.vid('holder'), CASE WHEN g % 3 = 0 THEN 'mecum' ELSE 'bat' END,
       CASE WHEN g % 3 = 0 THEN 'https://www.mecum.com/lots/' || g ELSE pg_temp.u('lot-x') || repeat('/', 1 + g % 2) END,
       'ended', 1000 + g, '{}'::jsonb
FROM generate_series(1, 300) g;

-- vehicle_events evidence. Each row: (vehicle, url, status, final, current, ended_at, sold_at, seller, buyer, meta).
INSERT INTO public.vehicle_events (vehicle_id, source_platform, source_url, event_status, final_price, current_price,
  ended_at, sold_at, seller_identifier, buyer_identifier, bid_count, comment_count, metadata, extraction_source)
VALUES
  (pg_temp.vid('sold'),        'bat', pg_temp.u('lot-sold'), 'sold', 25000, 25000, NULL, '2025-05-13 00:00Z', '', 'buyerA', 40, 90,
     '{"source":"extract-auction-comments","sold_at_method":"live_listing_title","images":["x"]}', 'extract-auction-comments'),
  (pg_temp.vid('bidto'),       'bat', pg_temp.u('lot-bidto'), 'ended', NULL, 12000, NULL, NULL, NULL, 'highbidderB', 20, 50,
     '{"source":"extract-auction-comments"}', 'extract-auction-comments'),
  (pg_temp.vid('exists_other'),'bat', pg_temp.u('lot-x'), 'sold', 50000, 50000, NULL, NULL, NULL, NULL, 1, 1, '{}', NULL),
  (pg_temp.vid('exists_case'), 'bat', pg_temp.u('lot-y'), 'ended', NULL, 7000, NULL, NULL, NULL, NULL, 1, 1, '{}', NULL),
  (pg_temp.vid('gone'),        'bat', pg_temp.u('lot-gone'), 'sold', 18000, 18000, NULL, NULL, NULL, NULL, 1, 1, '{}', NULL),
  (pg_temp.vid('merged'),      'bat', pg_temp.u('lot-merged'), 'sold', 18000, 18000, NULL, NULL, NULL, NULL, 1, 1, '{}', NULL),
  (pg_temp.vid('twin_a'),      'bat', pg_temp.u('lot-twin'), 'sold', 33000, 33000, NULL, NULL, NULL, NULL, 1, 1, '{}', NULL),
  (pg_temp.vid('twin_b'),      'bat', pg_temp.u('lot-twin') || '/', 'sold', 33000, 33000, NULL, NULL, NULL, NULL, 1, 1, '{}', NULL),
  (pg_temp.vid('live'),        'bat', pg_temp.u('lot-live'), 'active', NULL, 4000, NULL, NULL, NULL, NULL, 1, 1, '{}', NULL),
  (pg_temp.vid('cheap'),       'bat', pg_temp.u('lot-cheap'), 'sold', 190, 190, NULL, NULL, NULL, NULL, 28, 1, '{}', NULL),
  (pg_temp.vid('noresult'),    'bat', pg_temp.u('lot-noresult'), 'ended', NULL, NULL, NULL, NULL, NULL, NULL, 17, 1, '{}', NULL),
  (pg_temp.vid('endedsale'),   'bat', pg_temp.u('lot-endedsale'), 'ended', 46250, 46250, NULL, NULL, NULL, NULL, 1, 1, '{}', NULL),
  (pg_temp.vid('disagree'),    'bat', pg_temp.u('lot-disagree'), 'sold', 30000, 30000, NULL, NULL, NULL, NULL, 1, 1, '{}', NULL),
  (pg_temp.vid('slash'),       'bat', pg_temp.u('lot-slash') || '/', 'ended', NULL, 9100, '2026-01-20 18:00Z', NULL, 'sellerS', NULL, 1, 1, '{}', NULL),
  (pg_temp.vid('versions'),    'bat', pg_temp.u('lot-versions'), 'ended', NULL, 5000, NULL, NULL, NULL, NULL, 1, 1, '{}', NULL),
  (pg_temp.vid('versions'),    'bat', pg_temp.u('lot-versions') || '/', 'sold', 5500, 5500, NULL, NULL, NULL, NULL, 1, 1, '{}', NULL),
  (pg_temp.vid('future'),      'bat', pg_temp.u('lot-future'), 'ended', NULL, 8000, now() + interval '3 days', NULL, NULL, NULL, 1, 1, '{}', NULL),
  (pg_temp.vid('nobl'),        'bat', pg_temp.u('lot-nobl'), 'sold', 61000, 61000, '2026-01-02 19:05Z', '2026-01-02 00:00Z', NULL, NULL, 1, 1,
     '{"buyer_username":"buyerN","seller_username":"sellerN"}', NULL),
  (pg_temp.vid('filler'),      'bat', pg_temp.u('lot-bl-owned'), 'ended', NULL, NULL, NULL, NULL, NULL, NULL, 1, 1, '{}', NULL);

-- bat_listings evidence.
INSERT INTO public.bat_listings (vehicle_id, bat_listing_url, listing_status, sale_price, final_bid, auction_end_date, sale_date,
  seller_username, buyer_username, bat_lot_number, comment_count, bid_count, raw_data)
VALUES
  -- copies of vehicle_events reads (same vehicle, same URL)
  (pg_temp.vid('sold'),     pg_temp.u('lot-sold') || '/', 'sold', 25000, 25000, NULL, NULL, 'sellerA', 'buyerA', '12345', 90, 40,
     '{"source":"extract-auction-comments","auction_event_id":null}'),
  (pg_temp.vid('bidto'),    pg_temp.u('lot-bidto') || '/', 'ended', NULL, 12000, '2026-01-09', NULL, 'sellerB', 'highbidderB', NULL, 50, 20,
     '{"source":"extract-auction-comments"}'),
  (pg_temp.vid('disagree'), pg_temp.u('lot-disagree') || '/', 'sold', 31000, 31000, NULL, NULL, NULL, NULL, NULL, 1, 1, '{}'),
  -- bat_listings-only evidence
  (pg_temp.vid('bl_sold'),   pg_temp.u('lot-bl-sold') || '/', 'sold', 40000, 40000, '2026-02-03', '2026-02-03', 'sellerC', 'buyerC', NULL, 3, 2,
     '{"source":"extract-auction-comments"}'),
  (pg_temp.vid('bl_slash'),  pg_temp.u('lot-bl-slash') || '/', 'ended', NULL, 8000, NULL, NULL, 'sellerD', 'hbD', NULL, 1, 1, '{}'),
  (pg_temp.vid('bl_slash'),  pg_temp.u('lot-bl-slash'), 'ended', NULL, 8000, NULL, NULL, 'sellerD', 'hbD', NULL, 1, 1, '{}'),
  (NULL,                     pg_temp.u('lot-bl-feed') || '/', 'sold', 22000, 22000, '2026-03-01', '2026-03-01', NULL, NULL, NULL, 0, 0,
     '{"sync":"bat-closed-lots-sync:1.2.0"}'),
  (pg_temp.vid('bl_owned'),  pg_temp.u('lot-bl-owned') || '/', 'ended', NULL, 9900, NULL, NULL, NULL, NULL, NULL, 1, 1, '{}'),
  (pg_temp.vid('bl_twin_a'), pg_temp.u('lot-bl-twin') || '/', 'sold', 15000, 15000, NULL, NULL, NULL, NULL, NULL, 1, 1, '{}'),
  (pg_temp.vid('bl_twin_b'), pg_temp.u('lot-bl-twin'), 'sold', 15000, 15000, NULL, NULL, NULL, NULL, NULL, 1, 1, '{}'),
  (pg_temp.vid('bl_cheap'),  pg_temp.u('lot-bl-cheap') || '/', 'sold', 50, 50, NULL, NULL, NULL, NULL, NULL, 1, 1, '{}'),
  (pg_temp.vid('bl_exists'), pg_temp.u('lot-blx') || '/', 'sold', 9000, 9000, NULL, NULL, NULL, NULL, NULL, 1, 1, '{}'),
  (pg_temp.vid('bl_endedsale'), pg_temp.u('lot-bl-endedsale') || '/', 'ended', 7000, 7000, NULL, NULL, NULL, NULL, NULL, 1, 1, '{}'),
  -- feed rows (no vehicle) for the comment-vehicle pass
  (NULL, pg_temp.u('lot-cv-sold') || '/', 'sold', 22000, 22000, '2026-01-02', '2026-01-02', NULL, NULL, NULL, 0, 0,
     '{"sync":"bat-closed-lots-sync:1.2.0","id":777,"timestamp_end":1767380700,"sold_text":"Sold for USD $22,000"}'),
  (NULL, pg_temp.u('lot-cv-dissent') || '/', 'ended', NULL, 6000, '2026-01-03', NULL, NULL, NULL, NULL, 0, 0, '{"sync":"bat-closed-lots-sync:1.2.0"}'),
  (NULL, pg_temp.u('lot-cv-novehicle') || '/', 'ended', NULL, 7000, '2026-01-04', NULL, NULL, NULL, NULL, 0, 0, '{"sync":"bat-closed-lots-sync:1.2.0"}'),
  (NULL, pg_temp.u('lot-cv-gone') || '/', 'sold', 9000, 9000, '2026-01-05', '2026-01-05', NULL, NULL, NULL, 0, 0, '{"sync":"bat-closed-lots-sync:1.2.0"}'),
  (NULL, pg_temp.u('lot-cv-cheap') || '/', 'sold', 50, 50, '2026-01-06', '2026-01-06', NULL, NULL, NULL, 0, 0, '{"sync":"bat-closed-lots-sync:1.2.0"}'),
  (NULL, pg_temp.u('lot-noresult') || '/', 'ended', NULL, 5000, '2026-01-07', NULL, NULL, NULL, NULL, 0, 0, '{"sync":"bat-closed-lots-sync:1.2.0"}');

-- Comments waiting on their lot row (comment URLs carry the trailing slash, as extract-auction-comments wrote them).
INSERT INTO public.auction_comments (vehicle_id, platform, source_url, content_hash, comment_text)
SELECT pg_temp.vid(n), 'bat', pg_temp.u(s) || '/', n || g, 'c'
FROM (VALUES ('sold', 'lot-sold'), ('bidto', 'lot-bidto'), ('bl_sold', 'lot-bl-sold'), ('gone', 'lot-gone'), ('cheap', 'lot-cheap')) x(n, s),
     generate_series(1, 5) g;
-- Comments on feed-only lots: lot-cv-sold unanimous (cv1 x4); lot-cv-dissent two vehicles; lot-cv-novehicle one comment
-- with no vehicle; lot-cv-gone unanimous on a vehicle that no longer exists; lot-cv-cheap unanimous, price $50.
INSERT INTO public.auction_comments (vehicle_id, platform, source_url, content_hash, comment_text)
SELECT CASE WHEN n = 'none' THEN NULL ELSE pg_temp.vid(n) END, 'bat', pg_temp.u(s) || '/', n || s || g, 'c'
FROM (VALUES ('cv1', 'lot-cv-sold', 4), ('cv2a', 'lot-cv-dissent', 2), ('cv2b', 'lot-cv-dissent', 1),
             ('none', 'lot-cv-novehicle', 1), ('cv3', 'lot-cv-novehicle', 1), ('gone2', 'lot-cv-gone', 2),
             ('cv6', 'lot-cv-cheap', 2)) x(n, s, k),
     LATERAL generate_series(1, k) g;

CREATE TEMP TABLE lots_before AS SELECT * FROM public.auction_events;
TRUNCATE net.calls;  -- the fixture's own sold lots fired the trigger at setup
CREATE TEMP TABLE ve_before AS SELECT * FROM public.vehicle_events;
CREATE TEMP TABLE bl_before AS SELECT * FROM public.bat_listings;
INSERT INTO public.pipeline_registry (table_name, column_name, owned_by, description)
VALUES ('auction_events', NULL, 'stale-owner', 'stale registration');
ANALYZE;

-- The function migration first: without the index it must refuse to run.
\ir ../migrations/20261006131500_create_missing_bat_auction_events.sql

SELECT pg_temp.ok('migration writes no lot row', (SELECT count(*) FROM public.auction_events) = (SELECT count(*) FROM lots_before));
DO $$ BEGIN
  PERFORM public.create_missing_bat_auction_events(25, 0, 'vehicle_events', 200);
  RAISE EXCEPTION 'ran without the lot identity index';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%idx_auction_events_bat_lot_slug is required%' THEN RAISE; END IF;
END $$;

\ir ../migrations/20261006130000_idx_auction_events_bat_lot_slug.sql

SELECT pg_temp.ok('lot identity index is valid and keyed on the lower-cased slug',
  EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
          WHERE c.relname = 'idx_auction_events_bat_lot_slug' AND i.indisvalid)
  AND strpos(pg_get_indexdef('public.idx_auction_events_bat_lot_slug'::regclass),
             'lower("substring"(source_url, ''bringatrailer\.com/listing/([^/?#]+)''::text))') > 0);
SELECT pg_temp.ok('registry: one table-level row for auction_events, stale owner replaced',
  (SELECT count(*) FROM public.pipeline_registry WHERE table_name = 'auction_events') = 1
  AND EXISTS (SELECT 1 FROM public.pipeline_registry WHERE table_name = 'auction_events' AND column_name IS NULL
              AND owned_by = 'extract-bat-core' AND do_not_write_directly
              AND write_via LIKE '%create_missing_bat_auction_events%'));
SELECT pg_temp.ok('not callable by anon or authenticated; callable by service_role',
  NOT has_function_privilege('anon', 'public.create_missing_bat_auction_events(integer, bigint, text, integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.create_missing_bat_auction_events(integer, bigint, text, integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.create_missing_bat_auction_events(integer, bigint, text, integer)', 'EXECUTE'));
SELECT pg_temp.ok('fixed search_path ending in pg_temp',
  (SELECT proconfig @> ARRAY['search_path=public, pg_temp'] FROM pg_proc
   WHERE oid = 'public.create_missing_bat_auction_events(integer, bigint, text, integer)'::regprocedure));

-- Guards ------------------------------------------------------------------------------------------------------
SET statement_timeout = 0;
DO $$ BEGIN
  PERFORM public.create_missing_bat_auction_events(25, 0, 'vehicle_events', 200);
  RAISE EXCEPTION 'unbounded call was accepted';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%caller must set statement_timeout%' THEN RAISE; END IF;
END $$;
SET statement_timeout = '61s';
DO $$ BEGIN
  PERFORM public.create_missing_bat_auction_events(25, 0, 'vehicle_events', 200);
  RAISE EXCEPTION 'a statement_timeout above 60 s was accepted';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%caller must set statement_timeout%' THEN RAISE; END IF;
END $$;
SET statement_timeout = '30s';
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES
      (0, 0::bigint, 'vehicle_events', 200, '%p_batch must be%'),
      (501, 0::bigint, 'vehicle_events', 200, '%p_batch must be%'),
      (25, -1::bigint, 'vehicle_events', 200, '%p_from_block must be%'),
      (25, 0::bigint, 'vehicle_events', 0, '%p_scan_blocks must be%'),
      (25, 0::bigint, 'vehicle_events', 5001, '%p_scan_blocks must be%'),
      (25, 0::bigint, 'auction_comments', 200, '%p_source must be%')) t(b, f, s, w, msg)
  LOOP
    BEGIN
      PERFORM public.create_missing_bat_auction_events(c.b, c.f, c.s, c.w);
      RAISE EXCEPTION 'accepted bad arguments %', row(c.b, c.f, c.s, c.w);
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM NOT LIKE c.msg THEN RAISE; END IF;
    END;
  END LOOP;
END $$;
SELECT pg_temp.ok('refused calls changed nothing', (SELECT count(*) FROM public.auction_events) = (SELECT count(*) FROM lots_before));
SELECT pg_temp.ok('start blocks at or past the end return done without error',
  (SELECT bool_and((r->>'done')::boolean AND (r->>'created')::int = 0 AND (r->>'blocks_scanned')::int = 0)
   FROM (SELECT public.create_missing_bat_auction_events(25, b, s, 200) r
         FROM unnest(ARRAY['vehicle_events', 'bat_listings']) s,
              unnest(ARRAY[100000::bigint, 4294967294, 4294967295, 5000000000]) b) x));

-- Walk 1: bat_listings first (it must leave vehicle_events' lots alone), one block and one lot per call --------------
SELECT pg_temp.ok('evidence spans many heap blocks',
  pg_relation_size('public.vehicle_events') / current_setting('block_size')::bigint > 20);
CREATE TEMP TABLE walk(run text, step int, result jsonb);
CREATE FUNCTION pg_temp.walk(p_run text, p_source text, p_batch int, p_scan int) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r jsonb; b bigint := 0; i int := 0;
BEGIN
  LOOP
    r := public.create_missing_bat_auction_events(p_batch, b, p_source, p_scan);
    i := i + 1;
    INSERT INTO walk VALUES (p_run, i, r);
    EXIT WHEN (r->>'done')::boolean OR i > 100000;
    IF (r->>'next_block')::bigint = b AND (r->>'created')::int = 0 THEN RAISE EXCEPTION 'cursor stalled at %', b; END IF;
    b := (r->>'next_block')::bigint;
  END LOOP;
END $$;
CREATE FUNCTION pg_temp.skips(p_run text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT coalesce(jsonb_object_agg(k, n), '{}'::jsonb) FROM (
    SELECT k, sum(v::int) n FROM walk, jsonb_each_text(result->'skipped') e(k, v) WHERE run = p_run GROUP BY k) z $$;
CREATE FUNCTION pg_temp.total(p_run text, p_key text) RETURNS bigint LANGUAGE sql AS $$
  SELECT coalesce(sum((result->>p_key)::bigint), 0) FROM walk WHERE run = p_run $$;

SELECT pg_temp.walk('bl1', 'bat_listings', 1, 1);
SELECT pg_temp.ok('bat_listings pass: creates bl_sold, bl_slash (once), nothing for lots vehicle_events holds',
  pg_temp.total('bl1', 'created') = 2
  AND EXISTS (SELECT 1 FROM public.auction_events WHERE vehicle_id = pg_temp.vid('bl_sold'))
  AND (SELECT count(*) FROM public.auction_events WHERE vehicle_id = pg_temp.vid('bl_slash')) = 1
  AND NOT EXISTS (SELECT 1 FROM public.auction_events WHERE vehicle_id IN (pg_temp.vid('sold'), pg_temp.vid('bidto'), pg_temp.vid('filler'), pg_temp.vid('bl_owned'))));
SELECT pg_temp.ok('bat_listings pass: every evidence row counted once, by reason',
  pg_temp.skips('bl1') = jsonb_build_object(
    'vehicle_events_holds_lot', 4,   -- copies of lot-sold, lot-bidto, lot-disagree; lot-bl-owned (vehicle_events on another vehicle)
    'no_vehicle', 7,                 -- lot-bl-feed and the six comment-pass feed rows
    'lot_on_several_vehicles', 2,    -- lot-bl-twin on two vehicles
    'implausible_price', 1,          -- lot-bl-cheap at $50
    'lot_exists', 1,                 -- lot-blx already on 'holder'
    'conflicting_evidence', 1,       -- ended with a sale price
    'same_lot_other_row', 1)         -- the second slash spelling of lot-bl-slash
  AND pg_temp.total('bl1', 'evidence_rows_scanned') = (SELECT count(*) FROM public.bat_listings)
  AND pg_temp.total('bl1', 'created') + (SELECT sum(value::int) FROM jsonb_each_text(pg_temp.skips('bl1')))
      = (SELECT count(*) FROM public.bat_listings));
SELECT pg_temp.ok('whole blocks: both creatable rows of block 0 created in the first call although p_batch is 1',
  (SELECT (result->>'created')::int FROM walk WHERE run = 'bl1' AND step = 1) = 2);
SELECT pg_temp.ok('bat_listings lot: sold, copied fields, provenance names the evidence rows',
  EXISTS (SELECT 1 FROM public.auction_events a WHERE a.vehicle_id = pg_temp.vid('bl_sold')
          AND a.source = 'bat' AND a.source_url = pg_temp.u('lot-bl-sold') AND a.outcome = 'sold'
          AND a.high_bid = 40000 AND a.winning_bid = 40000 AND a.winning_bidder = 'buyerC' AND a.seller_name = 'sellerC'
          AND a.auction_end_date = timestamptz '2026-02-03 00:00Z' AND a.scraped_at IS NULL
          AND a.lot_number IS NULL AND a.total_bids IS NULL AND a.comments_count IS NULL
          AND a.raw_data->>'extractor' = 'create_missing_bat_auction_events'
          AND a.raw_data->>'derivation' = 'derived-from-retained-evidence 2026-10-06'
          AND a.raw_data->'evidence'->'bat_listing_ids' = to_jsonb(ARRAY(SELECT id FROM public.bat_listings WHERE vehicle_id = pg_temp.vid('bl_sold')))));
SELECT pg_temp.ok('bat_listings slash duplicates: one bid_to lot, both rows cited, no winner',
  EXISTS (SELECT 1 FROM public.auction_events a WHERE a.vehicle_id = pg_temp.vid('bl_slash')
          AND a.source_url = pg_temp.u('lot-bl-slash') AND a.outcome = 'bid_to' AND a.high_bid = 8000
          AND a.winning_bid IS NULL AND a.winning_bidder IS NULL AND a.seller_name = 'sellerD'
          AND jsonb_array_length(a.raw_data->'evidence'->'bat_listing_ids') = 2));

-- Walk 2: vehicle_events, one block and one lot per call ------------------------------------------------------
SELECT pg_temp.walk('ve1', 'vehicle_events', 1, 1);
SELECT pg_temp.ok('cursor: starts at 0; each call starts where the last ended; never jumps more than one block',
  (SELECT (result->>'from_block')::bigint FROM walk WHERE run = 've1' AND step = 1) = 0
  AND NOT EXISTS (SELECT 1 FROM walk w JOIN walk p ON p.run = w.run AND p.step = w.step - 1
                  WHERE w.run = 've1' AND (w.result->>'from_block')::bigint <> (p.result->>'next_block')::bigint)
  AND NOT EXISTS (SELECT 1 FROM walk WHERE run = 've1'
                  AND (result->>'next_block')::bigint - (result->>'from_block')::bigint > 1)
  AND NOT EXISTS (SELECT 1 FROM walk WHERE run = 've1' AND (result->>'created')::int > 1));
SELECT pg_temp.ok('vehicle_events pass: creates sold, bidto, slash, nobl and nothing else',
  pg_temp.total('ve1', 'created') = 4 AND pg_temp.total('ve1', 'created_sold') = 2 AND pg_temp.total('ve1', 'created_bid_to') = 2
  AND pg_temp.total('ve1', 'insert_conflicts') = 0
  AND (SELECT count(*) FROM public.auction_events a JOIN v ON v.id = a.vehicle_id
       WHERE a.raw_data->>'extractor' = 'create_missing_bat_auction_events' AND v.name IN ('sold', 'bidto', 'slash', 'nobl')) = 4);
SELECT pg_temp.ok('vehicle_events pass: every evidence row counted once, by reason',
  pg_temp.skips('ve1') = jsonb_build_object(
    'lot_exists', 202,                -- 200 BaT filler rows on lot-x, exists_other (lot-x), exists_case (LOT-Y/)
    'vehicle_missing', 1, 'vehicle_retired', 1, 'lot_on_several_vehicles', 2, 'read_while_live', 1,
    'implausible_price', 1, 'no_result', 2,     -- noresult; filler's lot-bl-owned (ended, no price)
    'conflicting_evidence', 5)        -- endedsale, disagree, versions x2, future
  AND pg_temp.total('ve1', 'evidence_rows_scanned') = (SELECT count(*) FROM public.vehicle_events WHERE source_platform = 'bat')
  AND pg_temp.total('ve1', 'created') + (SELECT sum(value::int) FROM jsonb_each_text(pg_temp.skips('ve1')))
      = (SELECT count(*) FROM public.vehicle_events WHERE source_platform = 'bat'));
SELECT pg_temp.ok('sold lot: sale price, winner, seller from bat_listings, end from sold_at, ids cited',
  EXISTS (SELECT 1 FROM public.auction_events a WHERE a.vehicle_id = pg_temp.vid('sold')
          AND a.source_url = pg_temp.u('lot-sold') AND a.outcome = 'sold' AND a.high_bid = 25000 AND a.winning_bid = 25000
          AND a.winning_bidder = 'buyerA' AND a.seller_name = 'sellerA' AND a.auction_end_date = timestamptz '2025-05-13 00:00Z'
          AND a.raw_data->'evidence'->>'vehicle_event_id' = (SELECT id::text FROM public.vehicle_events WHERE vehicle_id = pg_temp.vid('sold'))
          AND a.raw_data->'evidence'->>'end_date_from' = 'vehicle_events.sold_at'
          AND a.raw_data->'evidence'->>'bid_count' = '40' AND a.total_bids IS NULL
          AND NOT (a.raw_data->'evidence' ? 'images')));
SELECT pg_temp.ok('bid_to lot: high bid only; the high bidder is not a winner; end date from bat_listings at 00:00 UTC',
  EXISTS (SELECT 1 FROM public.auction_events a WHERE a.vehicle_id = pg_temp.vid('bidto')
          AND a.outcome = 'bid_to' AND a.high_bid = 12000 AND a.winning_bid IS NULL AND a.winning_bidder IS NULL
          AND a.seller_name = 'sellerB' AND a.auction_end_date = timestamptz '2026-01-09 00:00Z'));
SELECT pg_temp.ok('URL stored without the trailing slash; metadata handles used when agreeing',
  EXISTS (SELECT 1 FROM public.auction_events WHERE vehicle_id = pg_temp.vid('slash') AND source_url = pg_temp.u('lot-slash')
          AND auction_end_date = timestamptz '2026-01-20 18:00Z' AND seller_name = 'sellerS')
  AND EXISTS (SELECT 1 FROM public.auction_events WHERE vehicle_id = pg_temp.vid('nobl') AND winning_bidder = 'buyerN'
              AND seller_name = 'sellerN' AND auction_end_date = timestamptz '2026-01-02 19:05Z'));
SELECT pg_temp.ok('transfer trigger fired once per created sold lot, never for bid_to',
  (SELECT count(*) FROM net.calls) = (SELECT count(*) FROM public.auction_events
                                      WHERE raw_data->>'extractor' = 'create_missing_bat_auction_events' AND outcome = 'sold')
  AND (SELECT count(*) FROM net.calls) = 3);
SELECT pg_temp.ok('existing lots byte-identical; evidence tables untouched',
  NOT EXISTS (SELECT * FROM lots_before EXCEPT SELECT * FROM public.auction_events)
  AND NOT EXISTS (SELECT * FROM ve_before EXCEPT SELECT * FROM public.vehicle_events)
  AND NOT EXISTS (SELECT * FROM bl_before EXCEPT SELECT * FROM public.bat_listings));
SELECT pg_temp.ok('no lot created for a slug any vehicle already had, and no slug twice',
  (SELECT count(*) FROM public.auction_events WHERE lower(substring(source_url FROM 'bringatrailer\.com/listing/([^/?#]+)')) IS NOT NULL)
  = (SELECT count(DISTINCT lower(substring(source_url FROM 'bringatrailer\.com/listing/([^/?#]+)'))) FROM public.auction_events));

-- Walk 3: feed lots, vehicle from unanimous comment rows (lead's ruling) ---------------------------------------------
DO $$ BEGIN
  PERFORM public.create_missing_bat_auction_events(25, 0, 'bat_listings_comment_vehicle', 200);
  RAISE EXCEPTION 'comment pass ran without the unkeyed comment index';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%idx_auction_comments_unkeyed_lot_slug is required%' THEN RAISE; END IF;
END $$;
\ir ../migrations/20261006130500_idx_auction_comments_unkeyed_lot_slug.sql
SET statement_timeout = '30s';  -- the index file sets its own bounded session timeout for the build
SELECT pg_temp.ok('unkeyed comment index is valid and partial on auction_event_id IS NULL',
  EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
          WHERE c.relname = 'idx_auction_comments_unkeyed_lot_slug' AND i.indisvalid
            AND pg_get_expr(i.indpred, i.indrelid) = '(auction_event_id IS NULL)'));
SELECT pg_temp.walk('cv1', 'bat_listings_comment_vehicle', 1, 1);
SELECT pg_temp.ok('comment pass: creates only the unanimous feed lot; every row counted once, by reason',
  pg_temp.total('cv1', 'created') = 1 AND pg_temp.total('cv1', 'created_sold') = 1
  AND pg_temp.skips('cv1') = jsonb_build_object(
    'lot_exists', 6,                    -- copies of lot-sold, lot-bidto; bl_sold; bl_slash x2; lot-blx
    'bat_listings_names_vehicle', 6,    -- disagree copy, bl_owned, bl_twin_a/b, bl_cheap, bl_endedsale
    'vehicle_events_holds_lot', 1,      -- the feed row of lot-noresult (vehicle_events skipped it: no result)
    'no_comment_vehicle', 1,            -- lot-bl-feed
    'comment_vehicles_dissent', 2,      -- lot-cv-dissent (two vehicles), lot-cv-novehicle (a comment with no vehicle)
    'vehicle_missing', 1,               -- lot-cv-gone
    'implausible_price', 1)             -- lot-cv-cheap
  AND pg_temp.total('cv1', 'created') + (SELECT sum(value::int) FROM jsonb_each_text(pg_temp.skips('cv1')))
      = (SELECT count(*) FROM public.bat_listings));
SELECT pg_temp.ok('comment-vehicle lot: the comments'' vehicle, feed price and exact feed end time, basis and count cited, no handles',
  EXISTS (SELECT 1 FROM public.auction_events a WHERE a.vehicle_id = pg_temp.vid('cv1')
          AND a.source_url = pg_temp.u('lot-cv-sold') AND a.outcome = 'sold' AND a.high_bid = 22000 AND a.winning_bid = 22000
          AND a.winning_bidder IS NULL AND a.seller_name IS NULL
          AND a.auction_end_date = timestamptz '2026-01-02 19:05Z'
          AND a.raw_data->'evidence'->>'vehicle_basis' = 'vehicle_from_comment_rows'
          AND a.raw_data->'evidence'->>'comment_rows' = '4'
          AND a.raw_data->'evidence'->>'end_date_from' = 'bat_listings.raw_data.timestamp_end'
          AND a.raw_data->'evidence'->>'feed_listing_id' = '777')
  AND NOT EXISTS (SELECT 1 FROM public.auction_events WHERE source_url IN (pg_temp.u('lot-cv-dissent'), pg_temp.u('lot-cv-novehicle'),
                  pg_temp.u('lot-cv-gone'), pg_temp.u('lot-cv-cheap'), pg_temp.u('lot-noresult'), pg_temp.u('lot-bl-feed')))
  AND (SELECT count(*) FROM net.calls) = 4);

-- Idempotent: a second full walk of every source creates nothing and changes nothing --------------------------------
CREATE TEMP TABLE lots_after1 AS SELECT * FROM public.auction_events;
SELECT pg_temp.walk('ve2', 'vehicle_events', 25, 200);
SELECT pg_temp.walk('bl2', 'bat_listings', 25, 200);
SELECT pg_temp.walk('cv2', 'bat_listings_comment_vehicle', 25, 200);
SELECT pg_temp.ok('second walk creates nothing and leaves every lot unchanged',
  pg_temp.total('ve2', 'created') = 0 AND pg_temp.total('bl2', 'created') = 0 AND pg_temp.total('cv2', 'created') = 0
  AND (pg_temp.skips('cv2')->>'lot_exists')::int = 7
  AND (SELECT count(*) FROM public.auction_events) = (SELECT count(*) FROM lots_after1)
  AND NOT EXISTS (SELECT * FROM lots_after1 EXCEPT SELECT * FROM public.auction_events)
  AND (pg_temp.skips('ve2')->>'lot_exists')::int = 206 AND (SELECT count(*) FROM net.calls) = 4);

-- Batch cap inside one wide window: three creatable lots, p_batch 1 -----------------------------------------------
INSERT INTO public.vehicles (id) SELECT id FROM (VALUES (gen_random_uuid()), (gen_random_uuid()), (gen_random_uuid())) z(id);
CREATE TEMP TABLE cap AS SELECT id, row_number() OVER () AS n FROM public.vehicles
  WHERE id NOT IN (SELECT id FROM v) AND id NOT IN (SELECT vehicle_id FROM public.vehicle_events);
INSERT INTO public.vehicle_events (vehicle_id, source_platform, source_url, event_status, current_price)
SELECT id, 'bat', pg_temp.u('lot-cap-' || n), 'ended', 3000 + n FROM cap;
SELECT pg_temp.walk('cap', 'vehicle_events', 1, 5000);
SELECT pg_temp.ok('p_batch caps lots per call (one row per block here); the cursor resumes after the block; none skipped',
  pg_temp.total('cap', 'created') = 3 AND (SELECT count(*) FROM walk WHERE run = 'cap' AND (result->>'created')::int = 1) = 3
  AND NOT EXISTS (SELECT 1 FROM walk WHERE run = 'cap' AND (result->>'created')::int > 1)
  AND (SELECT count(*) FROM public.auction_events WHERE source_url LIKE '%/lot-cap-%') = 3);

-- End to end: lane L's keying function keys the waiting comments to the new lots -----------------------------------
\ir ../migrations/20261006110000_key_auction_comment_lots.sql
DO $$
DECLARE r jsonb; b bigint := 0;
BEGIN
  LOOP
    r := public.key_auction_comment_lots(1000, b);
    EXIT WHEN (r->>'done')::boolean;
    b := (r->>'next_block')::bigint;
  END LOOP;
END $$;
SELECT pg_temp.ok('comments on created lots are keyed; comments on skipped lots stay NULL',
  (SELECT count(*) FROM public.auction_comments c JOIN public.auction_events a ON a.id = c.auction_event_id
   WHERE a.raw_data->>'extractor' = 'create_missing_bat_auction_events') = 19
  AND (SELECT count(*) FROM public.auction_comments WHERE auction_event_id IS NULL) = 19
  AND NOT EXISTS (SELECT 1 FROM public.auction_comments WHERE auction_event_id IS NULL AND vehicle_id IS NOT NULL
                  AND vehicle_id NOT IN (SELECT pg_temp.vid(n) FROM unnest(ARRAY['gone','cheap','cv2a','cv2b','cv3','gone2','cv6']) n)));

SELECT 'test_missing_bat_lots: all contracts passed' AS result;
