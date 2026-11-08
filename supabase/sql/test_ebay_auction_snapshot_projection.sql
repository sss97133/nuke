-- Disposable PG17 only; synthetic eBay states. No production writes.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
SET statement_timeout = '30s';
SET TimeZone = 'UTC';

-- vehicles: the columns the upsert reads or writes, and the live partial unique key it conflicts on.
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_url text, title text, year integer, make text, model text,
  auction_status text, sale_status text, auction_end_date text, high_bid integer, sale_price integer,
  primary_image_url text, platform_source text, origin_metadata jsonb, is_public boolean,
  updated_at timestamptz DEFAULT now(), deleted_at timestamptz);
CREATE UNIQUE INDEX idx_vehicles_listing_url_unique ON public.vehicles (listing_url)
  WHERE deleted_at IS NULL AND listing_url IS NOT NULL AND listing_url <> '';
CREATE TABLE public.auction_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, source text, source_url text, outcome text,
  high_bid numeric, winning_bid numeric);
CREATE UNIQUE INDEX idx_auction_events_vehicle_source_url ON public.auction_events (vehicle_id, source_url);
\ir helpers/upsert_live_auction_vehicles_live_20261016.sql
\ir helpers/upsert_live_auction_vehicles_live_20261108.sql

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF; RAISE NOTICE 'PASS %', label;
END $$;

\ir ../migrations/20261108182528_ebay_auction_snapshot_projection.sql
\ir ../migrations/20261108182528_ebay_auction_snapshot_projection.sql
CREATE FUNCTION pg_temp.row(meta jsonb, house text DEFAULT 'ebay-motors') RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_array(jsonb_build_object('listing_url', 'https://ebay.com/itm/100000000001',
 'title', '1969 Chevrolet Camaro', 'year',1969,'make','Chevrolet','model','Camaro','auction_status','active',
 'sale_status','auction_live','auction_end_date','2026-11-09T12:00:00Z','sale_price',4100,'platform_source',house,
 'origin_metadata',meta)) $$;
CREATE TEMP TABLE state AS SELECT '{"bid_count":2,"currency":"USD","current_bid":"4100.10","auction_observation_id":"obs1","auction_snapshot_id":"snap1","source_observed_at":"2026-11-08T12:00:00Z"}'::jsonb AS meta;
SELECT pg_temp.ok('initial insert', public.upsert_live_auction_vehicles(pg_temp.row(meta)) = 1) FROM state;
SELECT pg_temp.ok('unchanged read does not touch', public.upsert_live_auction_vehicles(pg_temp.row(meta || '{"last_sync":"2026-11-08T12:15:00Z"}')) = 0) FROM state;
SELECT pg_temp.ok('count only changes', public.upsert_live_auction_vehicles(pg_temp.row(meta || '{"bid_count":3}')) = 1) FROM state;
SELECT pg_temp.ok('sub dollar changes', public.upsert_live_auction_vehicles(pg_temp.row(meta || '{"bid_count":3,"current_bid":"4100.20"}')) = 1) FROM state;
SELECT pg_temp.ok('currency changes', public.upsert_live_auction_vehicles(pg_temp.row(meta || '{"currency":"CAD"}')) = 1) FROM state;
SELECT pg_temp.ok('older read cannot regress', public.upsert_live_auction_vehicles(pg_temp.row(meta || '{"bid_count":1,"source_observed_at":"2026-11-08T11:00:00Z"}')) = 0) FROM state;
SELECT pg_temp.ok('missing provenance cannot project', public.upsert_live_auction_vehicles(pg_temp.row(meta - 'auction_observation_id')) = 0) FROM state;
UPDATE vehicles SET platform_source = 'pcarmarket';
SELECT pg_temp.ok('other house ownership preserved', public.upsert_live_auction_vehicles(pg_temp.row(meta)) = 0) FROM state;
UPDATE vehicles SET platform_source = 'ebay-motors';
INSERT INTO auction_events(vehicle_id,source_url,outcome) SELECT id,listing_url || '/','sold' FROM vehicles;
SELECT pg_temp.ok('terminal lot remains closed', public.upsert_live_auction_vehicles(pg_temp.row(meta)) = 0) FROM state;
SELECT pg_temp.ok('metadata and whole bid retained', (SELECT high_bid=4100 AND origin_metadata->>'currency'='CAD' FROM vehicles));
