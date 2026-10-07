-- Isolated PostgreSQL 17 contract for 20261007033000_resolve_dangling_vehicle_events.sql.
-- Synthetic rows only; never production. Run in an empty disposable dm_refinement_* database:
--   createdb dm_refinement_dangling_vehicle_events_ci
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_dangling_vehicle_events_ci -f supabase/sql/test_dangling_vehicle_events.sql
-- The fixture is built, and the migration applied, as a non-superuser that owns the tables, the way prod's deploy role
-- (postgres, rolsuper false) owns them. Shapes read from prod on 2026-10-07: vehicle_events (31 columns, its partial
-- unique keys, the URL and BaT-slug indexes, the NOT VALID vehicle FK added after rows that point at no vehicle, which is
-- how prod holds them), vehicle_observations' restrict FK and its partial index, bat_bids' unique key, hammer_predictions,
-- auction_events and bat_listings with their slug indexes, external_listings' (platform, listing_url_key) key, vehicles'
-- URL columns, superseded_rows (20260928203000), write_receipts, pipeline_registry, normalize_listing_url_key and
-- preserve_bat_live_projection (live bodies), the #703 clock-lock guard (its migration), vehicle_latest_event (prod
-- definition). One dangling episode per class, plus twins, a live projection and a NULL URL; a dry run, a partial run,
-- two full passes and an idempotent third pass.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR to_regclass('public.vehicle_events') IS NOT NULL
     OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '30s';
SET lock_timeout = '3s';
SET TimeZone = 'UTC';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dm_contract_deployer') THEN CREATE ROLE dm_contract_deployer NOLOGIN; END IF;
END $$;
GRANT CREATE ON SCHEMA public TO dm_contract_deployer;
SET ROLE dm_contract_deployer;
DO $$ BEGIN
  IF (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'the contract must run as a non-superuser after SET ROLE';
  END IF;
END $$;

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

-- Live shapes -------------------------------------------------------------------------------------------------------
CREATE TABLE public.vehicles(
  id uuid PRIMARY KEY, status text DEFAULT 'active', deleted_at timestamptz, merged_into_vehicle_id uuid,
  discovery_url text, listing_url text, bat_auction_url text, year integer, make text, model text);
CREATE UNIQUE INDEX vehicles_discovery_url_unique ON public.vehicles (discovery_url) WHERE discovery_url IS NOT NULL;
CREATE INDEX idx_vehicles_listing_url ON public.vehicles (listing_url);
CREATE INDEX idx_vehicles_bat_auction_url ON public.vehicles (bat_auction_url);
CREATE TABLE public.organizations(id uuid PRIMARY KEY);
CREATE TABLE public.vehicle_events(
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  vehicle_id uuid NOT NULL,
  source_organization_id uuid REFERENCES public.organizations(id),
  source_platform text NOT NULL,
  source_url text,
  source_listing_id text,
  event_type text NOT NULL DEFAULT 'auction'::text,
  event_status text NOT NULL DEFAULT 'active'::text,
  started_at timestamptz,
  ended_at timestamptz,
  sold_at timestamptz,
  starting_price numeric,
  current_price numeric,
  final_price numeric,
  reserve_price numeric,
  buy_now_price numeric,
  bid_count integer DEFAULT 0,
  comment_count integer DEFAULT 0,
  view_count integer DEFAULT 0,
  watcher_count integer DEFAULT 0,
  seller_identifier text,
  buyer_identifier text,
  seller_external_identity_id uuid,
  buyer_external_identity_id uuid,
  metadata jsonb DEFAULT '{}'::jsonb,
  extracted_at timestamptz DEFAULT now(),
  extraction_method text,
  extraction_source text,
  extractor_version text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now());
CREATE UNIQUE INDEX idx_vehicle_events_dedup ON public.vehicle_events USING btree (vehicle_id, source_platform, source_listing_id)
  WHERE (source_listing_id IS NOT NULL);
CREATE UNIQUE INDEX idx_vehicle_events_dedup_url ON public.vehicle_events USING btree (vehicle_id, source_platform, source_url)
  WHERE ((source_url IS NOT NULL) AND (source_listing_id IS NULL));
CREATE INDEX idx_vehicle_events_vehicle ON public.vehicle_events USING btree (vehicle_id);
CREATE INDEX idx_vehicle_events_source_url ON public.vehicle_events USING btree (source_url);
CREATE INDEX idx_vehicle_events_created ON public.vehicle_events USING btree (created_at DESC);
CREATE INDEX idx_vehicle_events_bat_lot_slug ON public.vehicle_events USING btree
  (lower("substring"(source_url, 'bringatrailer\.com/listing/([^/?#]+)'::text))) WHERE (source_platform = 'bat'::text);
COMMENT ON COLUMN public.vehicle_events.vehicle_id IS
'Vehicle listed, FK to vehicles.id (NOT VALID, ON DELETE RESTRICT). NOT NULL. Unit: none. Source: the extractor that resolved the vehicle. Grain: one vehicle listing. Clock: n/a.';

CREATE TABLE public.vehicle_observations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid,
  extraction_method text, source_vehicle_event_id uuid);
CREATE INDEX idx_vehicle_observations_source_vehicle_event ON public.vehicle_observations USING btree (source_vehicle_event_id)
  WHERE (source_vehicle_event_id IS NOT NULL);
CREATE TABLE public.bat_bids(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bat_listing_id uuid NOT NULL,
  bat_username text NOT NULL, bid_amount numeric NOT NULL, bid_timestamp timestamptz NOT NULL);
CREATE UNIQUE INDEX bat_bids_unique_bid ON public.bat_bids USING btree (bat_listing_id, bat_username, bid_amount, bid_timestamp);
CREATE TABLE public.hammer_predictions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, external_listing_id uuid);
CREATE TABLE public.auction_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, source text NOT NULL, source_url text);
CREATE INDEX idx_auction_events_bat_lot_slug ON public.auction_events USING btree
  (lower("substring"(source_url, 'bringatrailer\.com/listing/([^/?#]+)'::text)));
CREATE TABLE public.bat_listings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, bat_listing_url text NOT NULL);
CREATE INDEX idx_bat_listings_lot_slug ON public.bat_listings USING btree
  (lower("substring"(bat_listing_url, 'bringatrailer\.com/listing/([^/?#]+)'::text)));
CREATE TABLE public.external_listings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid NOT NULL,
  platform text NOT NULL, listing_url text NOT NULL, listing_id text, listing_url_key text);
CREATE UNIQUE INDEX uq_external_listings_platform_url_key ON public.external_listings USING btree (platform, listing_url_key)
  WHERE (listing_url_key IS NOT NULL);
CREATE TABLE public.superseded_rows (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table  text        NOT NULL,
  row_id        uuid        NOT NULL,
  row_data      jsonb       NOT NULL,
  superseded_at timestamptz NOT NULL DEFAULT now(),
  asserted_by   text        NOT NULL,
  source        jsonb       NOT NULL,
  reason        text        NOT NULL,
  restored_at   timestamptz);
CREATE INDEX superseded_rows_source_row_idx ON public.superseded_rows (source_table, row_id);
COMMENT ON TABLE public.superseded_rows IS
'Rows retired from a live table by a sanctioned writer (never a raw DELETE): the full row as it was (row_data), the citation (source), the reason and who asserted it. Restore = re-insert row_data into source_table and set restored_at. Writers: correct_vehicle_event_link (2026-09-28: misattached events, duplicates) and supersede_vehicle_event_episode (2026-10-06: an episode superseded by a corrected row; source.replacement_event_id names it).';
CREATE TABLE public.write_receipts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(), tbl text NOT NULL, op text NOT NULL,
  rows integer NOT NULL, writer text NOT NULL, db_role text NOT NULL,
  app_name text, txid bigint NOT NULL);
CREATE TABLE public.pipeline_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_name text NOT NULL, column_name text,
  owned_by text NOT NULL, description text NOT NULL, valid_values text[],
  do_not_write_directly boolean NOT NULL DEFAULT false, write_via text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (table_name, column_name));

-- Live body (prod 2026-10-07; migration 20260112000002).
CREATE OR REPLACE FUNCTION public.normalize_listing_url_key(p_url text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT
    CASE
      WHEN p_url IS NULL THEN NULL
      ELSE NULLIF(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(lower(trim(p_url)), '[?#].*$', ''),
              '^https?://', ''
            ),
            '^www\.', ''
          ),
          '/+$', ''
        ),
        ''
      )
    END
$function$;
CREATE FUNCTION public.set_external_listings_url_key() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.listing_url_key := public.normalize_listing_url_key(NEW.listing_url); RETURN NEW; END $$;
CREATE TRIGGER trg_external_listings_url_key BEFORE INSERT OR UPDATE OF listing_url ON public.external_listings
  FOR EACH ROW EXECUTE FUNCTION public.set_external_listings_url_key();

-- Live body (prod 2026-10-07) and trigger.
CREATE OR REPLACE FUNCTION public.preserve_bat_live_projection()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE old_data jsonb; new_data jsonb; old_live jsonb; new_live jsonb; old_at timestamptz; new_at timestamptz;
BEGIN
  old_data:=CASE WHEN TG_TABLE_NAME='vehicle_events' THEN to_jsonb(OLD)->'metadata' ELSE to_jsonb(OLD)->'raw_data' END;
  new_data:=CASE WHEN TG_TABLE_NAME='vehicle_events' THEN to_jsonb(NEW)->'metadata' ELSE to_jsonb(NEW)->'raw_data' END;
  old_live:=old_data->'live_stream'; new_live:=new_data->'live_stream';
  IF old_live IS NULL THEN RETURN NEW; END IF;
  -- Organization/image metadata maintenance does not rewrite an auction fact.
  IF old_live IS NOT DISTINCT FROM new_live AND
    (SELECT jsonb_object_agg(key,value) FROM jsonb_each(to_jsonb(OLD)) WHERE key IN
      ('event_status','ended_at','sold_at','current_price','final_price','bid_count','view_count','watcher_count',
       'outcome','auction_end_date','high_bid','winning_bid','winning_bidder','total_bids','comments_count','page_views','watchers'))
    IS NOT DISTINCT FROM
    (SELECT jsonb_object_agg(key,value) FROM jsonb_each(to_jsonb(NEW)) WHERE key IN
      ('event_status','ended_at','sold_at','current_price','final_price','bid_count','view_count','watcher_count',
       'outcome','auction_end_date','high_bid','winning_bid','winning_bidder','total_bids','comments_count','page_views','watchers'))
    THEN RETURN NEW; END IF;
  IF EXISTS(SELECT 1 FROM public.vehicle_observations o WHERE o.id=coalesce(new_live->>'last_observation_id',new_live->>'observation_id')::uuid
      AND o.vehicle_id=NEW.vehicle_id AND o.extraction_method='bat_public_live_v1'
      AND o.xmin=(pg_current_xact_id()::text::bigint % 4294967296)::text::xid) THEN RETURN NEW; END IF;
  old_at:=coalesce(old_live->>'last_frame_received_at',old_live->>'received_at')::timestamptz;
  new_at:=(new_data#>>'{source_read,at}')::timestamptz;
  IF new_at IS NULL OR (old_at IS NOT NULL AND new_at<=old_at) THEN RETURN OLD; END IF;
  IF TG_TABLE_NAME='vehicle_events' THEN NEW.metadata:=NEW.metadata||jsonb_build_object('live_stream',old_live);
  ELSE NEW.raw_data:=NEW.raw_data||jsonb_build_object('live_stream',old_live); END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER preserve_bat_live_projection BEFORE UPDATE ON public.vehicle_events
  FOR EACH ROW EXECUTE FUNCTION public.preserve_bat_live_projection();

\ir ../migrations/20261006212500_guard_vehicle_event_clock_locks.sql

-- Reader, prod definition (pg_get_viewdef, 2026-10-06).
CREATE VIEW public.vehicle_latest_event AS
 SELECT DISTINCT ON (ve.vehicle_id) ve.id, ve.vehicle_id, ve.source_platform, ve.source_url, ve.source_listing_id,
    ve.event_status, ve.ended_at, ve.sold_at, ve.final_price, ve.created_at, ve.updated_at, v.year, v.make, v.model
   FROM (vehicle_events ve JOIN vehicles v ON ((v.id = ve.vehicle_id)))
  ORDER BY ve.vehicle_id, COALESCE(ve.ended_at, ve.sold_at, ve.started_at, ve.created_at) DESC;

-- Probe: the writer a statement-level trigger (record_write_receipt reads the same setting) sees on each write.
CREATE TABLE public.probe_writers(tbl text, op text, writer text);
CREATE FUNCTION public.probe_writers() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN INSERT INTO public.probe_writers VALUES (TG_TABLE_NAME, TG_OP, current_setting('app.writer', true)); RETURN NULL; END $$;
CREATE TRIGGER zz_probe_writers AFTER UPDATE OR DELETE ON public.vehicle_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.probe_writers();
CREATE TRIGGER zz_probe_writers AFTER INSERT ON public.superseded_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.probe_writers();

-- Vehicles and rows ----------------------------------------------------------------------------------------------------
-- Existing vehicles (V*) and ids that name no vehicle (X*). One dangling episode per class:
--   d1  bat lot-1, the same facts as V1's episode                     -> retire_duplicate (of V1's episode)
--   d2  bat lot-2, a price V2's episode lacks                         -> held_duplicate_adds_fact
--   d3  BJ lot-3, V3.listing_url is the non-www spelling              -> repoint to V3
--   d4  BJ lot-4, V4a.listing_url and V4b's external listing          -> held_ambiguous
--   d5  BJ lot-5, an 'unknown'-platform episode on V5                 -> held_other_platform
--   d6  mecum lot-6, no holder (last heap block)                      -> retire_missing
--   d7  bat, named by a vehicle_observations row                      -> held_referenced
--   d8  bat, named by a bat_bids row                                  -> held_referenced
--   d9  bonhams, named by a hammer_predictions row                    -> held_referenced
--   d10 gooding, locked by supersession                               -> held_locked
--   d11 BJ lot-11, holder V11 is deleted                              -> held_target_not_live
--   d12 BJ lot-12, holder V12 is merged                               -> held_target_not_live
--   d13 BJ lot-13, V13 already holds an episode with its key          -> held_target_key_taken
--   d14 BJ lot-14, metadata is a JSON array                           -> held_metadata_not_object
--   d15 bat lot-15, an auction_events row on V15 (trailing slash)     -> repoint to V15
--   d16 bat lot-16, the same facts as soft-deleted V16's episode      -> retire_duplicate
--   d17a/b mecum lot-17 on two missing vehicles                       -> retire_missing, both
--   d18a/b BJ lot-18, both on missing vehicles, V18.listing_url       -> pass 1: repoint d18a, held_dangling_twin d18b;
--                                                                        pass 2: d18b retire_duplicate (of d18a)
--   d19 bat lot-19 with a BaT live projection, bat_listings on V19    -> repoint; live_stream untouched
--   d20 BJ, NULL URL                                                  -> retire_missing
CREATE TEMP TABLE v(name text PRIMARY KEY, id uuid);
INSERT INTO v SELECT n, gen_random_uuid() FROM unnest(string_to_array(
  'V1,V2,V3,V4a,V4b,V5,V11,V12,V13,V14,V15,V16,V18,V19,VF,X1,X2,X3,X4,X5,X6,X7,X8,X9,X10,X11,X12,X13,X14,X15,X16,X17a,X17b,X18a,X18b,X19,X20', ',')) n;
CREATE FUNCTION pg_temp.vid(p text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM v WHERE name = p $$;
INSERT INTO public.vehicles (id, status, deleted_at, merged_into_vehicle_id, discovery_url, listing_url, bat_auction_url, year, make, model)
VALUES
  (pg_temp.vid('V1'), 'active', NULL, NULL, NULL, NULL, NULL, 1989, 'Kawasaki', 'Ninja'),
  (pg_temp.vid('V2'), 'active', NULL, NULL, NULL, NULL, NULL, 1970, 'Rupp', 'Go Joe'),
  (pg_temp.vid('V3'), 'inactive', NULL, NULL, NULL, 'https://barrett-jackson.com/scottsdale-2024/docket/vehicle/lot-3-100', NULL, 2005, 'BMW', '645ci'),
  (pg_temp.vid('V4a'), 'active', NULL, NULL, NULL, 'https://www.barrett-jackson.com/las-vegas-2014/docket/vehicle/lot-4-200', NULL, 1981, 'DeLorean', 'DMC-12'),
  (pg_temp.vid('V4b'), 'active', NULL, NULL, NULL, NULL, NULL, 1981, 'DeLorean', 'DMC-12'),
  (pg_temp.vid('V5'), 'active', NULL, NULL, NULL, NULL, NULL, 1955, 'Chevrolet', '210'),
  (pg_temp.vid('V11'), 'archived', now(), NULL, 'https://www.barrett-jackson.com/reno-2014/docket/vehicle/lot-11-300', NULL, NULL, 1968, 'Ford', 'Thunderbird'),
  (pg_temp.vid('V12'), 'merged', NULL, pg_temp.vid('V1'), NULL, 'https://www.barrett-jackson.com/reno-2015/docket/vehicle/lot-12-400', NULL, 1968, 'Ford', 'Mustang'),
  (pg_temp.vid('V13'), 'active', NULL, NULL, NULL, 'https://www.barrett-jackson.com/houston-2023/docket/vehicle/lot-13-500', NULL, 2020, 'Jeep', 'Wrangler'),
  (pg_temp.vid('V14'), 'active', NULL, NULL, NULL, 'https://www.barrett-jackson.com/houston-2023/docket/vehicle/lot-14-600', NULL, 2022, 'Jeep', 'Wrangler'),
  (pg_temp.vid('V15'), 'active', NULL, NULL, NULL, NULL, NULL, 1964, 'Honda', 'CT200'),
  (pg_temp.vid('V16'), 'archived', now(), NULL, NULL, NULL, NULL, 1987, 'Suzuki', 'GSX-R'),
  (pg_temp.vid('V18'), 'pending', NULL, NULL, NULL, 'https://www.barrett-jackson.com/palm-beach-2022/docket/vehicle/lot-18-700', NULL, 1958, 'Packard', 'Custom'),
  (pg_temp.vid('V19'), 'active', NULL, NULL, NULL, NULL, NULL, 1978, 'Porsche', '911'),
  (pg_temp.vid('VF'), 'active', NULL, NULL, NULL, NULL, NULL, 1990, 'Filler', 'Filler');

-- d1 first: it lands in heap block 0.
INSERT INTO public.vehicle_events (id, vehicle_id, source_platform, source_url, source_listing_id, event_status, ended_at, sold_at, final_price, metadata, created_at, updated_at)
VALUES (gen_random_uuid(), pg_temp.vid('X1'), 'bat', 'https://bringatrailer.com/listing/lot-1', '141753', 'sold', '2024-04-01', '2024-04-01', 17000,
        '{"source":"extract-auction-comments"}', '2026-01-24', '2026-01-24');
-- Filler: 1,500 rows on an existing vehicle, spread over many heap blocks.
INSERT INTO public.vehicle_events (vehicle_id, source_platform, source_url, source_listing_id, event_status, metadata, created_at, updated_at)
SELECT pg_temp.vid('VF'), 'bat', 'https://bringatrailer.com/listing/filler-' || g, 'filler-' || g, 'sold',
       jsonb_build_object('pad', repeat('x', 200)), '2026-01-01', '2026-01-02'
FROM generate_series(1, 1500) g;
INSERT INTO public.vehicle_events (vehicle_id, source_platform, source_url, source_listing_id, event_status, ended_at, sold_at, final_price, metadata, created_at, updated_at)
VALUES
  -- Live episodes of existing vehicles (holders); never touched.
  (pg_temp.vid('V1'), 'bat', 'https://bringatrailer.com/listing/lot-1/', 'bringatrailer.com/listing/lot-1', 'sold', '2024-04-01', '2024-04-01', 17000, '{"source":"extract-bat-core"}', '2026-03-01', '2026-03-01'),
  (pg_temp.vid('V2'), 'bat', 'https://bringatrailer.com/listing/lot-2', 'bringatrailer.com/listing/lot-2', 'ended', '2024-09-24', NULL, NULL, '{"source":"extract-bat-core"}', '2026-03-01', '2026-03-01'),
  (pg_temp.vid('V5'), 'unknown', 'https://www.barrett-jackson.com/palm-beach-2012/docket/vehicle/lot-5-125536', NULL, 'sold', NULL, NULL, NULL, '{}', '2026-03-01', '2026-03-01'),
  (pg_temp.vid('V13'), 'barrettjackson', 'https://www.barrett-jackson.com/other-auction/docket/vehicle/lot-13-alt', '500', 'sold', NULL, NULL, NULL, '{}', '2026-03-01', '2026-03-01'),
  (pg_temp.vid('V16'), 'bat', 'https://bringatrailer.com/listing/lot-16', '83243', 'sold', '2023-04-27', '2023-04-27', 5300, '{}', '2026-03-01', '2026-03-01'),
  -- Dangling episodes.
  (pg_temp.vid('X2'), 'bat', 'https://bringatrailer.com/listing/lot-2', '163928', 'sold', '2024-09-24', NULL, 4500, '{"source":"extract-auction-comments"}', '2026-01-31', '2026-02-05'),
  (pg_temp.vid('X3'), 'barrettjackson', 'https://www.barrett-jackson.com/scottsdale-2024/docket/vehicle/lot-3-100', '100', 'sold', NULL, '2024-01-15', 16500, '{"note":"kept"}', '2026-02-25', '2026-02-25'),
  (pg_temp.vid('X4'), 'barrettjackson', 'https://www.barrett-jackson.com/las-vegas-2014/docket/vehicle/lot-4-200', '200', 'sold', NULL, '2014-06-15', 22000, '{}', '2026-02-27', '2026-02-27'),
  (pg_temp.vid('X5'), 'barrettjackson', 'https://www.barrett-jackson.com/palm-beach-2012/docket/vehicle/lot-5-125536', '125536', 'sold', NULL, '2012-04-15', 30000, '{}', '2026-02-17', '2026-02-17'),
  (pg_temp.vid('X7'), 'bat', 'https://bringatrailer.com/listing/lot-7', '7', 'sold', NULL, NULL, 7000, '{}', '2026-01-24', '2026-01-24'),
  (pg_temp.vid('X8'), 'bat', 'https://bringatrailer.com/listing/lot-8', '8', 'sold', NULL, NULL, 8000, '{}', '2026-01-24', '2026-01-24'),
  (pg_temp.vid('X9'), 'bonhams', 'https://bonhams.com/auction/1/lot/9', '9', 'sold', NULL, NULL, 9000, '{}', '2026-02-24', '2026-02-24'),
  (pg_temp.vid('X10'), 'gooding', 'https://www.goodingco.com/lot/lot-10', 'goodingco.com/lot/lot-10', 'sold', NULL, NULL, NULL,
     '{"episode_supersessions":[{"supersedes_event_id":"00000000-0000-0000-0000-000000000010"}],"clock_locked_by_supersession":{"fields":["sold_at"]}}',
     '2026-01-20', '2026-10-06'),
  (pg_temp.vid('X11'), 'barrettjackson', 'https://www.barrett-jackson.com/reno-2014/docket/vehicle/lot-11-300', '300', 'sold', NULL, '2014-08-15', 11000, '{}', '2026-02-27', '2026-02-27'),
  (pg_temp.vid('X12'), 'barrettjackson', 'https://www.barrett-jackson.com/reno-2015/docket/vehicle/lot-12-400', '400', 'sold', NULL, '2015-08-15', 12000, '{}', '2026-02-27', '2026-02-27'),
  (pg_temp.vid('X13'), 'barrettjackson', 'https://www.barrett-jackson.com/houston-2023/docket/vehicle/lot-13-500', '500', 'sold', NULL, '2023-04-15', 13000, '{}', '2026-02-27', '2026-02-27'),
  (pg_temp.vid('X14'), 'barrettjackson', 'https://www.barrett-jackson.com/houston-2023/docket/vehicle/lot-14-600', '600', 'sold', NULL, '2023-04-15', 14000, '[1, 2]', '2026-02-27', '2026-02-27'),
  (pg_temp.vid('X15'), 'bat', 'https://bringatrailer.com/listing/lot-15', '15', 'ended', NULL, NULL, NULL, '{}', '2026-01-31', '2026-01-31'),
  (pg_temp.vid('X16'), 'bat', 'https://bringatrailer.com/listing/lot-16', '83243', 'sold', '2023-04-27', '2023-04-27', 5300, '{}', '2026-01-31', '2026-01-31'),
  (pg_temp.vid('X17a'), 'mecum', 'https://www.mecum.com/lots/1164095/lot-17', '1164095', 'ended', NULL, NULL, NULL, '{}', '2025-12-28', '2025-12-28'),
  (pg_temp.vid('X17b'), 'mecum', 'https://www.mecum.com/lots/1164095/lot-17', '1164095', 'ended', NULL, NULL, NULL, '{}', '2025-12-29', '2025-12-29'),
  (pg_temp.vid('X18a'), 'barrettjackson', 'https://www.barrett-jackson.com/palm-beach-2022/docket/vehicle/lot-18-700', '700', 'sold', NULL, '2022-04-15', 95700, '{}', '2026-02-17', '2026-02-17'),
  (pg_temp.vid('X18b'), 'barrettjackson', 'https://barrett-jackson.com/palm-beach-2022/docket/vehicle/lot-18-700/', '700', 'sold', NULL, '2022-04-15', 95700, '{}', '2026-02-18', '2026-02-18'),
  (pg_temp.vid('X19'), 'bat', 'https://bringatrailer.com/listing/lot-19', '19', 'active', NULL, NULL, NULL,
     '{"live_stream":{"received_at":"2026-10-01T00:00:00Z","bid":6000}}', '2026-01-24', '2026-01-24'),
  (pg_temp.vid('X20'), 'barrettjackson', NULL, '800', 'sold', NULL, '2020-01-15', 44000, '{}', '2026-02-17', '2026-02-17');
-- d6 last: it lands in the last heap block.
INSERT INTO public.vehicle_events (vehicle_id, source_platform, source_url, source_listing_id, event_status, metadata, created_at, updated_at)
VALUES (pg_temp.vid('X6'), 'mecum', 'https://www.mecum.com/lots/1161035/lot-6', '1161035', 'ended', '{}', '2026-01-07', '2026-01-07');

-- Lot records and references.
INSERT INTO public.external_listings (vehicle_id, platform, listing_url) VALUES
  (pg_temp.vid('V4b'), 'barrettjackson', 'https://www.barrett-jackson.com/las-vegas-2014/docket/vehicle/lot-4-200');
INSERT INTO public.auction_events (vehicle_id, source, source_url) VALUES
  (pg_temp.vid('V15'), 'bat', 'https://bringatrailer.com/listing/lot-15/'),
  (pg_temp.vid('X1'), 'bat', 'https://bringatrailer.com/listing/lot-1');      -- an orphaned lot row on the missing vehicle
INSERT INTO public.bat_listings (vehicle_id, bat_listing_url) VALUES (pg_temp.vid('V19'), 'https://bringatrailer.com/listing/lot-19');
INSERT INTO public.vehicle_observations (vehicle_id, source_vehicle_event_id)
  SELECT pg_temp.vid('X7'), id FROM public.vehicle_events WHERE vehicle_id = pg_temp.vid('X7');
INSERT INTO public.bat_bids (bat_listing_id, bat_username, bid_amount, bid_timestamp)
  SELECT id, 'bidder', 8000, '2026-01-01' FROM public.vehicle_events WHERE vehicle_id = pg_temp.vid('X8');
INSERT INTO public.hammer_predictions (vehicle_id, external_listing_id)
  SELECT pg_temp.vid('X9'), id FROM public.vehicle_events WHERE vehicle_id = pg_temp.vid('X9');
INSERT INTO public.hammer_predictions (vehicle_id, external_listing_id) SELECT NULL, NULL FROM generate_series(1, 50);

-- The keys as prod has them: NOT VALID, added over rows that already point at no vehicle.
ALTER TABLE public.vehicle_events ADD CONSTRAINT vehicle_events_vehicle_id_fkey
  FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.vehicle_observations ADD CONSTRAINT vehicle_observations_source_vehicle_event_id_fkey
  FOREIGN KEY (source_vehicle_event_id) REFERENCES public.vehicle_events(id) ON DELETE RESTRICT NOT VALID;

CREATE TEMP TABLE before_rows AS SELECT * FROM public.vehicle_events;
CREATE TEMP TABLE d(name text PRIMARY KEY, id uuid);
INSERT INTO d SELECT 'd' || substr(v.name, 2), e.id FROM public.vehicle_events e JOIN v ON v.id = e.vehicle_id WHERE v.name LIKE 'X%';
CREATE TEMP TABLE edge_blocks AS
  SELECT d.name, ((e.ctid::text)::point)[0]::bigint AS blk FROM public.vehicle_events e JOIN d ON d.id = e.id WHERE d.name IN ('d1', 'd6');
INSERT INTO public.pipeline_registry (table_name, column_name, owned_by, description)
VALUES ('vehicle_events', 'vehicle_id', 'stale-owner', 'stale registration');
ANALYZE public.vehicle_events;

SELECT pg_temp.ok('fixture: 22 dangling episodes, d1 in block 0 and d6 in the last block',
  (SELECT count(*) FROM public.vehicle_events e WHERE NOT EXISTS (SELECT 1 FROM public.vehicles x WHERE x.id = e.vehicle_id)) = 22
  AND (SELECT blk FROM edge_blocks WHERE name = 'd1') = 0
  AND (SELECT blk FROM edge_blocks WHERE name = 'd6') = pg_relation_size('public.vehicle_events') / current_setting('block_size')::bigint - 1);

\ir ../migrations/20261007033000_resolve_dangling_vehicle_events.sql

-- The migration itself ---------------------------------------------------------------------------------------------
SELECT pg_temp.ok('migration changes no row',
  (SELECT count(*) FROM public.vehicle_events) = (SELECT count(*) FROM before_rows)
  AND NOT EXISTS (SELECT 1 FROM public.superseded_rows));
SELECT pg_temp.ok('registry row for vehicle_events.vehicle_id names both correction writers, replacing a stale owner',
  (SELECT count(*) FROM public.pipeline_registry WHERE table_name = 'vehicle_events' AND column_name = 'vehicle_id') = 1
  AND EXISTS (SELECT 1 FROM public.pipeline_registry WHERE table_name = 'vehicle_events' AND column_name = 'vehicle_id'
              AND write_via LIKE '%correct_vehicle_event_link%resolve_dangling_vehicle_events(p_batch, p_from_block, p_actions)%'));
SELECT pg_temp.ok('the column and the archive name the writer once, keeping their live text',
  col_description('public.vehicle_events'::regclass,
    (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.vehicle_events'::regclass AND attname = 'vehicle_id'))
    LIKE 'Vehicle listed, FK to vehicles.id%resolve_dangling_vehicle_events()%'
  AND obj_description('public.superseded_rows'::regclass, 'pg_class') LIKE 'Rows retired from a live table%Also resolve_dangling_vehicle_events%');
SELECT pg_temp.ok('callable by service_role only; fixed search_path and lock_timeout; no custom parameter in its SET clauses',
  NOT has_function_privilege('anon', 'public.resolve_dangling_vehicle_events(integer, bigint, text[])', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.resolve_dangling_vehicle_events(integer, bigint, text[])', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.resolve_dangling_vehicle_events(integer, bigint, text[])', 'EXECUTE')
  AND (SELECT proconfig = ARRAY['search_path=public, pg_temp', 'lock_timeout=5s'] FROM pg_proc
       WHERE oid = 'public.resolve_dangling_vehicle_events(integer, bigint, text[])'::regprocedure));

-- Guards ---------------------------------------------------------------------------------------------------------------
SET statement_timeout = 0;
DO $$ BEGIN
  PERFORM public.resolve_dangling_vehicle_events(500, 0);
  RAISE EXCEPTION 'unbounded call was accepted';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%caller must set statement_timeout%' THEN RAISE; END IF;
END $$;
SET statement_timeout = '61s';
DO $$ BEGIN
  PERFORM public.resolve_dangling_vehicle_events(500, 0);
  RAISE EXCEPTION 'a statement_timeout above 60 s was accepted';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%caller must set statement_timeout%' THEN RAISE; END IF;
END $$;
SET statement_timeout = '30s';
DO $$
DECLARE bad text[];
BEGIN
  FOREACH bad SLICE 1 IN ARRAY ARRAY[ARRAY['delete_all', 'repoint'], ARRAY['repoint', NULL]] LOOP
    BEGIN
      PERFORM public.resolve_dangling_vehicle_events(500, 0, bad);
      RAISE EXCEPTION 'p_actions % was accepted', bad;
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM NOT LIKE '%p_actions must be a subset%' THEN RAISE; END IF;
    END;
  END LOOP;
  BEGIN
    PERFORM public.resolve_dangling_vehicle_events(500, 0, NULL);
    RAISE EXCEPTION 'NULL p_actions was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%p_actions must be a subset%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.resolve_dangling_vehicle_events(0, 0);
    RAISE EXCEPTION 'p_batch 0 was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%p_batch must be%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.resolve_dangling_vehicle_events(500, -1);
    RAISE EXCEPTION 'a negative start block was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%p_from_block must be%' THEN RAISE; END IF;
  END;
END $$;
-- Without a valid index on vehicle_observations.source_vehicle_event_id, retire actions refuse; counting and re-pointing do not.
ALTER INDEX public.idx_vehicle_observations_source_vehicle_event RENAME TO idx_vo_sve_parked;
DO $$ BEGIN
  PERFORM public.resolve_dangling_vehicle_events(100000, 0);
  RAISE EXCEPTION 'retire actions ran without the restrict-FK index';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%idx_vehicle_observations_source_vehicle_event is missing or invalid%' THEN RAISE; END IF;
END $$;
SELECT pg_temp.ok('without the index, an empty p_actions still counts',
  (public.resolve_dangling_vehicle_events(100000, 0, '{}'::text[]) ->> 'dangling_seen')::int > 0);
ALTER INDEX public.idx_vo_sve_parked RENAME TO idx_vehicle_observations_source_vehicle_event;
SELECT pg_temp.ok('refused calls and counting changed nothing',
  (SELECT count(*) FROM public.vehicle_events) = (SELECT count(*) FROM before_rows)
  AND NOT EXISTS (SELECT 1 FROM public.vehicle_events e JOIN before_rows b USING (id) WHERE to_jsonb(e) IS DISTINCT FROM to_jsonb(b))
  AND NOT EXISTS (SELECT 1 FROM public.superseded_rows) AND NOT EXISTS (SELECT 1 FROM public.write_receipts));
SELECT pg_temp.ok('start blocks at or past the end, and past the tid range, return done without error',
  (SELECT bool_and((r->>'done')::boolean AND (r->>'dangling_seen')::int = 0 AND (r->>'blocks_scanned')::int = 0)
   FROM (SELECT public.resolve_dangling_vehicle_events(200, b) r
         FROM unnest(ARRAY[pg_relation_size('public.vehicle_events') / current_setting('block_size')::bigint,
                           1000000, 4294967294, 4294967295, 5000000000]) b) s));

-- The walks ------------------------------------------------------------------------------------------------------------
CREATE TEMP TABLE walk(run text, step int, result jsonb, writer_after text);
CREATE FUNCTION pg_temp.walk(p_run text, p_batch int, p_actions text[]) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r jsonb; b bigint := 0; i int := 0;
BEGIN
  LOOP
    r := public.resolve_dangling_vehicle_events(p_batch, b, p_actions);
    i := i + 1;
    INSERT INTO walk VALUES (p_run, i, r, current_setting('app.writer', true));
    EXIT WHEN (r->>'done')::boolean OR i > 100000;
    b := (r->>'next_block')::bigint;
  END LOOP;
END $$;
CREATE FUNCTION pg_temp.total(p_run text, p_key text) RETURNS bigint LANGUAGE sql AS $$
  SELECT coalesce(sum((result ->> p_key)::bigint), 0) FROM walk WHERE run = p_run $$;

-- 1. Counting only (empty p_actions), one block per call.
SET app.writer = 'caller-writer';
SELECT pg_temp.walk('dry', 1, '{}'::text[]);
SELECT pg_temp.ok('dry walk: cursor starts at 0, each call starts where the last ended, one block per call, one done',
  (SELECT (result->>'from_block')::bigint FROM walk WHERE run = 'dry' AND step = 1) = 0
  AND NOT EXISTS (SELECT 1 FROM walk w JOIN walk p ON p.run = w.run AND p.step = w.step - 1
                  WHERE w.run = 'dry' AND (w.result->>'from_block')::bigint <> (p.result->>'next_block')::bigint)
  AND NOT EXISTS (SELECT 1 FROM walk WHERE run = 'dry' AND (result->>'next_block')::bigint - (result->>'from_block')::bigint <> 1)
  AND (SELECT count(*) FROM walk WHERE run = 'dry' AND (result->>'done')::boolean) = 1);
SELECT pg_temp.ok('dry walk: every dangling row seen once, each in its class, nothing written',
  pg_temp.total('dry', 'dangling_seen') = 22
  AND pg_temp.total('dry', 'planned_retire_duplicate') = 2       -- d1, d16
  AND pg_temp.total('dry', 'planned_retire_missing') = 4         -- d6, d17a, d17b, d20
  AND pg_temp.total('dry', 'held_duplicate_adds_fact') = 1       -- d2
  AND pg_temp.total('dry', 'held_ambiguous') = 1                 -- d4
  AND pg_temp.total('dry', 'held_other_platform') = 1            -- d5
  AND pg_temp.total('dry', 'held_referenced') = 3                -- d7, d8, d9
  AND pg_temp.total('dry', 'held_locked') = 1                    -- d10
  AND pg_temp.total('dry', 'held_target_not_live') = 2           -- d11, d12
  AND pg_temp.total('dry', 'held_target_key_taken') = 1          -- d13
  AND pg_temp.total('dry', 'held_metadata_not_object') = 1       -- d14
  AND pg_temp.total('dry', 'planned_repoint') + pg_temp.total('dry', 'held_dangling_twin') = 5   -- d3, d15, d19, d18a, d18b
  AND pg_temp.total('dry', 'held_dangling_twin') <= 1            -- d18b, only when it shares a one-block call with d18a
  AND pg_temp.total('dry', 'retired_duplicate') + pg_temp.total('dry', 'retired_missing') + pg_temp.total('dry', 'repointed') = 0
  AND NOT EXISTS (SELECT 1 FROM public.vehicle_events e JOIN before_rows b USING (id) WHERE to_jsonb(e) IS DISTINCT FROM to_jsonb(b))
  AND NOT EXISTS (SELECT 1 FROM public.superseded_rows) AND NOT EXISTS (SELECT 1 FROM public.write_receipts));

-- 2. Only retire_duplicate applies; everything else is counted and left alone.
SELECT pg_temp.walk('dups', 100000, ARRAY['retire_duplicate']);
SELECT pg_temp.ok('a partial run applies only its action',
  pg_temp.total('dups', 'retired_duplicate') = 2 AND pg_temp.total('dups', 'retired_missing') = 0
  AND pg_temp.total('dups', 'repointed') = 0 AND pg_temp.total('dups', 'planned_retire_missing') = 4
  AND (SELECT count(*) FROM public.superseded_rows) = 2
  AND NOT EXISTS (SELECT 1 FROM public.vehicle_events WHERE id IN (SELECT id FROM d WHERE name IN ('d1', 'd16')))
  AND (SELECT count(*) FROM public.vehicle_events e WHERE NOT EXISTS (SELECT 1 FROM public.vehicles x WHERE x.id = e.vehicle_id)) = 20);

-- 3. Pass 1, all actions, one call over the whole heap: d18a and d18b meet in one call.
SELECT pg_temp.walk('pass1', 100000, ARRAY['retire_duplicate', 'repoint', 'retire_missing']);
SELECT pg_temp.ok('pass 1: retires the missing, re-points the held-by-one, holds the twin',
  pg_temp.total('pass1', 'retired_duplicate') = 0 AND pg_temp.total('pass1', 'retired_missing') = 4
  AND pg_temp.total('pass1', 'repointed') = 4 AND pg_temp.total('pass1', 'held_dangling_twin') = 1
  AND (SELECT vehicle_id FROM public.vehicle_events WHERE id = (SELECT id FROM d WHERE name = 'd18a')) = pg_temp.vid('V18')
  AND (SELECT vehicle_id FROM public.vehicle_events WHERE id = (SELECT id FROM d WHERE name = 'd18b')) = pg_temp.vid('X18b'));

-- 4. Pass 2: the twin now finds the moved episode of its lot on V18 and is a duplicate of it.
SELECT pg_temp.walk('pass2', 400, ARRAY['retire_duplicate', 'repoint', 'retire_missing']);
SELECT pg_temp.ok('pass 2: the held twin is retired as a duplicate of the episode pass 1 moved',
  pg_temp.total('pass2', 'retired_duplicate') = 1 AND pg_temp.total('pass2', 'repointed') = 0
  AND pg_temp.total('pass2', 'retired_missing') = 0
  AND (SELECT source ->> 'duplicate_of_event' FROM public.superseded_rows WHERE row_id = (SELECT id FROM d WHERE name = 'd18b'))
      = (SELECT id FROM d WHERE name = 'd18a')::text);

-- 5. Pass 3: idempotent. Only the holds remain and are counted again.
SELECT pg_temp.walk('pass3', 400, ARRAY['retire_duplicate', 'repoint', 'retire_missing']);
SELECT pg_temp.ok('pass 3 changes nothing and counts the 11 holds',
  pg_temp.total('pass3', 'retired_duplicate') + pg_temp.total('pass3', 'retired_missing') + pg_temp.total('pass3', 'repointed') = 0
  AND pg_temp.total('pass3', 'dangling_seen') = 11
  AND (SELECT count(*) FROM public.vehicle_events e WHERE NOT EXISTS (SELECT 1 FROM public.vehicles x WHERE x.id = e.vehicle_id)) = 11);

-- Outcomes per row -------------------------------------------------------------------------------------------------------
SELECT pg_temp.ok('retired rows are gone from vehicle_events and archived whole, once each',
  NOT EXISTS (SELECT 1 FROM public.vehicle_events WHERE id IN (SELECT id FROM d WHERE name IN ('d1', 'd16', 'd6', 'd17a', 'd17b', 'd20', 'd18b')))
  AND (SELECT count(*) FROM public.superseded_rows) = 7
  AND (SELECT count(DISTINCT row_id) FROM public.superseded_rows) = 7
  AND NOT EXISTS (SELECT 1 FROM public.superseded_rows s JOIN before_rows b ON b.id = s.row_id
                  WHERE s.source_table <> 'vehicle_events' OR s.row_data IS DISTINCT FROM to_jsonb(b)
                     OR s.asserted_by <> 'resolve-dangling-vehicle-events' OR s.restored_at IS NOT NULL));
SELECT pg_temp.ok('archive source: class, missing vehicle, lot and, for duplicates, the kept episode and its vehicle',
  (SELECT source ->> 'class' = 'retire_duplicate'
          AND source ->> 'missing_vehicle_id' = pg_temp.vid('X1')::text
          AND source ->> 'duplicate_of_event' = (SELECT id::text FROM public.vehicle_events WHERE vehicle_id = pg_temp.vid('V1'))
          AND source ->> 'lot_vehicle_id' = pg_temp.vid('V1')::text
          AND source -> 'lot' ->> 'bat_slug' = 'lot-1'
          AND source ->> 'operator' = 'caller-writer' AND source ->> 'type' = 'rule'
          AND reason LIKE 'Dangling vehicle_id: no vehicles row has id%retired as a duplicate of that episode.'
   FROM public.superseded_rows WHERE row_id = (SELECT id FROM d WHERE name = 'd1'))
  AND (SELECT bool_and(source ->> 'class' = 'retire_missing' AND source ->> 'duplicate_of_event' IS NULL
                       AND source ->> 'lot_vehicle_id' IS NULL AND reason LIKE '%no vehicle holds this lot%')
       FROM public.superseded_rows WHERE row_id IN (SELECT id FROM d WHERE name IN ('d6', 'd17a', 'd17b', 'd20')))
  AND (SELECT source -> 'lot' ->> 'url_key' IS NULL FROM public.superseded_rows WHERE row_id = (SELECT id FROM d WHERE name = 'd20')));
SELECT pg_temp.ok('restore round-trip: row_data re-populates the exact original row',
  NOT EXISTS (SELECT 1 FROM public.superseded_rows s JOIN before_rows b ON b.id = s.row_id
              WHERE to_jsonb(jsonb_populate_record(NULL::public.vehicle_events, s.row_data)) IS DISTINCT FROM to_jsonb(b)));
SELECT pg_temp.ok('re-pointed: d3 to V3 (non-www listing_url), d15 to V15 (auction_events slug), d19 to V19 (bat_listings), d18a to V18',
  (SELECT vehicle_id FROM public.vehicle_events WHERE id = (SELECT id FROM d WHERE name = 'd3')) = pg_temp.vid('V3')
  AND (SELECT vehicle_id FROM public.vehicle_events WHERE id = (SELECT id FROM d WHERE name = 'd15')) = pg_temp.vid('V15')
  AND (SELECT vehicle_id FROM public.vehicle_events WHERE id = (SELECT id FROM d WHERE name = 'd19')) = pg_temp.vid('V19')
  AND (SELECT vehicle_id FROM public.vehicle_events WHERE id = (SELECT id FROM d WHERE name = 'd18a')) = pg_temp.vid('V18'));
SELECT pg_temp.ok('a re-point changes vehicle_id, appends one link correction, sets updated_at, and keeps everything else',
  NOT EXISTS (
    SELECT 1 FROM public.vehicle_events e JOIN before_rows b USING (id)
    WHERE e.id IN (SELECT id FROM d WHERE name IN ('d3', 'd15', 'd19', 'd18a'))
      AND ((to_jsonb(e) - 'vehicle_id' - 'metadata' - 'updated_at') IS DISTINCT FROM (to_jsonb(b) - 'vehicle_id' - 'metadata' - 'updated_at')
           OR (e.metadata - 'link_corrections') IS DISTINCT FROM (b.metadata - 'link_corrections')
           OR jsonb_array_length(e.metadata -> 'link_corrections') <> 1
           OR e.metadata -> 'link_corrections' -> 0 ->> 'from_vehicle_id' <> b.vehicle_id::text
           OR e.metadata -> 'link_corrections' -> 0 ->> 'to_vehicle_id' <> e.vehicle_id::text
           OR e.metadata -> 'link_corrections' -> 0 -> 'source' ->> 'class' <> 'repoint'
           OR e.metadata -> 'link_corrections' -> 0 ->> 'asserted_by' <> 'resolve-dangling-vehicle-events'
           OR e.updated_at <= b.updated_at))
  AND (SELECT metadata ->> 'note' = 'kept' FROM public.vehicle_events WHERE id = (SELECT id FROM d WHERE name = 'd3')));
SELECT pg_temp.ok('each re-point names the record that holds the lot',
  (SELECT metadata -> 'link_corrections' -> 0 -> 'source' -> 'held_by'
          @> jsonb_build_array(jsonb_build_object('source', 'vehicles.listing_url', 'vehicle_id', pg_temp.vid('V3')))
   FROM public.vehicle_events WHERE id = (SELECT id FROM d WHERE name = 'd3'))
  AND (SELECT metadata -> 'link_corrections' -> 0 -> 'source' -> 'held_by'
          @> jsonb_build_array(jsonb_build_object('source', 'auction_events', 'vehicle_id', pg_temp.vid('V15')))
   FROM public.vehicle_events WHERE id = (SELECT id FROM d WHERE name = 'd15'))
  AND (SELECT metadata -> 'link_corrections' -> 0 -> 'source' -> 'held_by'
          @> jsonb_build_array(jsonb_build_object('source', 'bat_listings', 'vehicle_id', pg_temp.vid('V19')))
   FROM public.vehicle_events WHERE id = (SELECT id FROM d WHERE name = 'd19')));
SELECT pg_temp.ok('the live projection survives a re-point',
  (SELECT metadata -> 'live_stream' = '{"received_at":"2026-10-01T00:00:00Z","bid":6000}'::jsonb
   FROM public.vehicle_events WHERE id = (SELECT id FROM d WHERE name = 'd19')));
SELECT pg_temp.ok('held rows are untouched: ambiguous, other platform, adds a fact, referenced, locked, target not live, key taken, metadata not an object',
  NOT EXISTS (SELECT 1 FROM public.vehicle_events e JOIN before_rows b USING (id)
              WHERE e.id IN (SELECT id FROM d WHERE name IN ('d2', 'd4', 'd5', 'd7', 'd8', 'd9', 'd10', 'd11', 'd12', 'd13', 'd14'))
                AND to_jsonb(e) IS DISTINCT FROM to_jsonb(b))
  AND (SELECT count(*) FROM public.vehicle_events WHERE id IN (SELECT id FROM d WHERE name IN ('d2', 'd4', 'd5', 'd7', 'd8', 'd9', 'd10', 'd11', 'd12', 'd13', 'd14'))) = 11);
SELECT pg_temp.ok('rows with a vehicle are untouched, holders included',
  NOT EXISTS (SELECT 1 FROM public.vehicle_events e JOIN before_rows b USING (id)
              WHERE EXISTS (SELECT 1 FROM public.vehicles x WHERE x.id = b.vehicle_id)
                AND to_jsonb(e) IS DISTINCT FROM to_jsonb(b))
  AND (SELECT count(*) FROM public.vehicle_events e JOIN before_rows b USING (id)
       WHERE EXISTS (SELECT 1 FROM public.vehicles x WHERE x.id = b.vehicle_id)) = 1505);
SELECT pg_temp.ok('the reader shows the re-pointed episode on its vehicle',
  (SELECT id FROM public.vehicle_latest_event WHERE vehicle_id = pg_temp.vid('V3')) = (SELECT id FROM d WHERE name = 'd3')
  AND (SELECT final_price FROM public.vehicle_latest_event WHERE vehicle_id = pg_temp.vid('V3')) = 16500);
SELECT pg_temp.ok('a lander''s read by (vehicle, platform, key) finds the re-pointed episode, and the key refuses a second one',
  (SELECT count(*) FROM public.vehicle_events WHERE vehicle_id = pg_temp.vid('V3') AND source_platform = 'barrettjackson'
     AND source_listing_id = '100') = 1);
DO $$ BEGIN
  INSERT INTO public.vehicle_events (vehicle_id, source_platform, source_url, source_listing_id)
  VALUES (pg_temp.vid('V3'), 'barrettjackson', 'https://www.barrett-jackson.com/scottsdale-2024/docket/vehicle/lot-3-100', '100');
  RAISE EXCEPTION 'a second episode for the re-pointed lot was accepted';
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

-- Receipts, declared writer, caller's writer ---------------------------------------------------------------------------
SELECT pg_temp.ok('receipts: vehicle_events DELETE and superseded_rows INSERT sum to the retired rows; UPDATE to the re-pointed',
  (SELECT sum(rows) FROM public.write_receipts WHERE tbl = 'vehicle_events' AND op = 'DELETE') = 7
  AND (SELECT sum(rows) FROM public.write_receipts WHERE tbl = 'superseded_rows' AND op = 'INSERT') = 7
  AND (SELECT sum(rows) FROM public.write_receipts WHERE tbl = 'vehicle_events' AND op = 'UPDATE') = 4
  AND NOT EXISTS (SELECT 1 FROM public.write_receipts WHERE writer <> 'resolve-dangling-vehicle-events'));
SELECT pg_temp.ok('triggers on the writer''s statements see the declared writer; the caller''s writer is restored after every call',
  NOT EXISTS (SELECT 1 FROM public.probe_writers WHERE writer IS DISTINCT FROM 'resolve-dangling-vehicle-events')
  AND EXISTS (SELECT 1 FROM public.probe_writers WHERE tbl = 'vehicle_events' AND op = 'DELETE')
  AND EXISTS (SELECT 1 FROM public.probe_writers WHERE tbl = 'superseded_rows' AND op = 'INSERT')
  AND NOT EXISTS (SELECT 1 FROM walk WHERE writer_after IS DISTINCT FROM 'caller-writer')
  AND current_setting('app.writer') = 'caller-writer' AND current_setting('lock_timeout') = '3s');
RESET app.writer;

-- Re-applying the migration changes nothing (registry and comments are written once).
\ir ../migrations/20261007033000_resolve_dangling_vehicle_events.sql
SELECT pg_temp.ok('re-apply: one registry row, the writer named once in each comment',
  (SELECT count(*) FROM public.pipeline_registry WHERE table_name = 'vehicle_events' AND column_name = 'vehicle_id') = 1
  AND (SELECT count(*) FROM regexp_matches(col_description('public.vehicle_events'::regclass,
    (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.vehicle_events'::regclass AND attname = 'vehicle_id')),
    'resolve_dangling_vehicle_events', 'g')) = 1
  AND (SELECT count(*) FROM regexp_matches(obj_description('public.superseded_rows'::regclass, 'pg_class'),
    'resolve_dangling_vehicle_events', 'g')) = 1);

RESET ROLE;
DO $$ BEGIN RAISE NOTICE 'ALL PASS test_dangling_vehicle_events'; END $$;
