-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_live_upsert_end_unknown -f this-file.sql
-- Contract for 20261023101500_live_upsert_keep_end_date_when_unknown.sql, on the live function as of 2026-10-16 plus
-- 20261018040000 and 20261022070000: a payload with no close (NULL auction_end_date) keeps the close on record and is
-- not a change by itself; a real close still overwrites; a new row with no close is inserted with NULL; the migration
-- is idempotent; a drifted function stops it unchanged.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
SET TimeZone = 'UTC';
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
\ir ../migrations/20261018040000_live_auction_upsert_skip_closed_lots.sql
\ir ../migrations/20261022070000_live_upsert_merge_origin_metadata.sql
CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF; RAISE NOTICE 'PASS %', label;
END $$;

INSERT INTO public.vehicles (listing_url, title, year, make, model, auction_status, sale_status, auction_end_date, platform_source, origin_metadata, is_public)
VALUES ('https://example.test/lot/1', 'x', 1970, 'Ford', 'Mustang', 'active', 'auction_live', '2026-12-01T00:00:00Z', 'mecum', '{}', true);
SELECT public.upsert_live_auction_vehicles('[{"listing_url":"https://example.test/lot/1","title":"x","year":"1970","make":"Ford","model":"Mustang","sale_status":"auction_live","auction_end_date":null,"platform_source":"mecum","origin_metadata":{"auction_end_date_missing_reason":"r"}}]'::jsonb) AS before_n \gset
SELECT pg_temp.ok('before the migration a payload with no close erases the close on record (the defect, reproduced)',
  (SELECT auction_end_date IS NULL FROM public.vehicles WHERE listing_url = 'https://example.test/lot/1'));

\ir ../migrations/20261023101500_live_upsert_keep_end_date_when_unknown.sql
\ir ../migrations/20261023101500_live_upsert_keep_end_date_when_unknown.sql
SELECT pg_temp.ok('re-applying the migration is a no-op (one coalesce)',
  (SELECT count(*) FROM regexp_matches((SELECT prosrc FROM pg_proc WHERE proname = 'upsert_live_auction_vehicles'), 'coalesce\(excluded\.auction_end_date', 'g')) = 1);

INSERT INTO public.vehicles (listing_url, title, year, make, model, auction_status, sale_status, auction_end_date, platform_source, origin_metadata, is_public)
VALUES ('https://example.test/lot/2', 'y', 1971, 'Ford', 'Mustang', 'active', 'auction_live', '2026-12-01T00:00:00Z', 'mecum', '{}', true);
SELECT public.upsert_live_auction_vehicles('[{"listing_url":"https://example.test/lot/2","title":"y","year":"1971","make":"Ford","model":"Mustang","sale_status":"auction_live","auction_end_date":null,"platform_source":"mecum","origin_metadata":{}}]'::jsonb) AS unchanged_n \gset
SELECT pg_temp.ok('a payload with no close keeps the close on record and is not a change by itself',
  :'unchanged_n'::int = 0 AND (SELECT auction_end_date = '2026-12-01T00:00:00Z' FROM public.vehicles WHERE listing_url = 'https://example.test/lot/2'));
SELECT public.upsert_live_auction_vehicles('[{"listing_url":"https://example.test/lot/2","title":"y","year":"1971","make":"Ford","model":"Mustang","sale_status":"auction_live","auction_end_date":"2026-12-03T00:00:00Z","platform_source":"mecum","origin_metadata":{}}]'::jsonb) AS changed_n \gset
SELECT pg_temp.ok('a real close still overwrites', :'changed_n'::int = 1
  AND (SELECT auction_end_date = '2026-12-03T00:00:00Z' FROM public.vehicles WHERE listing_url = 'https://example.test/lot/2'));
SELECT public.upsert_live_auction_vehicles('[{"listing_url":"https://example.test/lot/3","title":"z","year":"1972","make":"Ford","model":"Mustang","sale_status":"auction_live","auction_end_date":null,"platform_source":"mecum","origin_metadata":{"auction_end_date_missing_reason":"r"}}]'::jsonb) AS inserted_n \gset
SELECT pg_temp.ok('a new lot with no close is inserted with NULL and the reason', :'inserted_n'::int = 1
  AND (SELECT auction_end_date IS NULL AND origin_metadata->>'auction_end_date_missing_reason' = 'r' FROM public.vehicles WHERE listing_url = 'https://example.test/lot/3'));

CREATE OR REPLACE FUNCTION public.upsert_live_auction_vehicles(p_rows jsonb) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
\set ON_ERROR_STOP off
\ir ../migrations/20261023101500_live_upsert_keep_end_date_when_unknown.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok('a drifted function stops the migration unchanged',
  (SELECT prosrc FROM pg_proc WHERE proname = 'upsert_live_auction_vehicles') = ' SELECT 0 ');
