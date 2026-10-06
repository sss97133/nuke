-- Isolated PostgreSQL 17 regression: synthetic rows only, never production data.
-- Contract for migrations 20261006141000_idx_vehicle_observations_source_vehicle_event.sql (the restrict-FK index) and
-- 20261006141500_supersede_vehicle_event_episode.sql (the episode supersession writer):
--   * the index migration drops an INVALID leftover of its name, builds the index and asserts it is valid;
--   * an RM map-day episode is replaced by the page-stated day, cited to its auction's page (code recorded); a Gooding
--     episode is replaced by its page's day when the page states one, and by NULL when the page carries a placeholder;
--     a PCARMARKET write clock is replaced by NULL; a lot row of the same vehicle and URL is a valid citation;
--   * the original row is never updated: it is retired whole into superseded_rows and a corrected row with a new id,
--     the same listing key and created_at, and clock_locked_by_supersession takes its place;
--   * refused, writing nothing: uncited plans, citations that exist but belong to another listing or auction or were
--     not fetched with HTTP 200, a NULL without a finding even beside a cited date, naive timestamps, a caller
--     statement_timeout over 60 s, a generated column on vehicle_events;
--   * no write: stale expected values, episodes referenced by an observation, a bid or a hammer prediction (listed),
--     a missing index; a second call is a no-op;
--   * readers (the live definitions of vehicle_latest_event and vehicle_event_summary, and valuation_by_ymm's
--     recorded_day expression) return the replacement with no reader change;
--   * app.writer is declared only when the writer writes, and the batch restores the caller's; lock_timeout is 3 s;
--   * the batch counts by status (referenced included) and caps at 100 rows; EXECUTE is service-role only;
--   * re-applying the writer migration is a no-op and a drifted body is refused.
-- Fixture tables carry the live columns the writer reads or writes and the live keys, read from the prod catalog on
-- 2026-10-06: vehicle_events (all 31 columns, its two partial unique keys, PK), the restrict FK from
-- vehicle_observations.source_vehicle_event_id, bat_bids_unique_bid, hammer_predictions (id, vehicle_id,
-- external_listing_id), superseded_rows (as in 20260928203000) and pipeline_registry's unique (table_name,
-- column_name). The two views are pg_get_viewdef of prod, verbatim.
-- Execute in an empty dm_vehicle_event_supersession_ci database with no auth schema, as a superuser.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT IN ('dm_vehicle_event_supersession_ci')
   OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='auth')
   OR EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p','v','m')) THEN
 RAISE EXCEPTION 'Refusing fixtures outside isolated DB'; END IF;
END $$;
SET statement_timeout='30s';
SET lock_timeout='3s';
SET TimeZone='UTC';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

CREATE TABLE public.vehicles(id uuid PRIMARY KEY, year integer, make text, model text);
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
ALTER TABLE public.vehicle_events ADD CONSTRAINT vehicle_events_vehicle_id_fkey
  FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE RESTRICT NOT VALID;
CREATE UNIQUE INDEX idx_vehicle_events_dedup ON public.vehicle_events USING btree (vehicle_id, source_platform, source_listing_id)
  WHERE (source_listing_id IS NOT NULL);
CREATE UNIQUE INDEX idx_vehicle_events_dedup_url ON public.vehicle_events USING btree (vehicle_id, source_platform, source_url)
  WHERE ((source_url IS NOT NULL) AND (source_listing_id IS NULL));
CREATE TABLE public.vehicle_observations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid,
  source_vehicle_event_id uuid);
ALTER TABLE public.vehicle_observations ADD CONSTRAINT vehicle_observations_source_vehicle_event_id_fkey
  FOREIGN KEY (source_vehicle_event_id) REFERENCES public.vehicle_events(id) ON DELETE RESTRICT NOT VALID;
CREATE TABLE public.bat_bids(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bat_listing_id uuid NOT NULL,
  bat_username text, bid_amount numeric, bid_timestamp timestamptz);
CREATE UNIQUE INDEX bat_bids_unique_bid ON public.bat_bids USING btree (bat_listing_id, bat_username, bid_amount, bid_timestamp);
CREATE TABLE public.hammer_predictions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid,
  external_listing_id uuid);
CREATE INDEX idx_hammer_predictions_vehicle ON public.hammer_predictions USING btree (vehicle_id);
CREATE TABLE public.listing_page_snapshots(id uuid PRIMARY KEY, platform text, listing_url text, http_status integer,
  success boolean);
CREATE TABLE public.auction_events(id uuid PRIMARY KEY, vehicle_id uuid, source_url text);
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
  'Rows retired from a live table by a sanctioned writer (never a raw DELETE): the full row as it was (row_data), the citation (source), the reason and who asserted it. Restore = re-insert row_data into source_table and set restored_at. First writer: correct_vehicle_event_link (2026-09-28).';
COMMENT ON COLUMN public.vehicle_events.sold_at IS 'When the vehicle sold through this listing; NULL if not sold. Unit: timestamptz (UTC). Source: extract-bat-core sets it to ended_at when a sale price exists; ingest_bat_live_events sets the frame sale time. Grain: one vehicle listing. Clock: event (source sale).';
COMMENT ON COLUMN public.vehicle_events.ended_at IS 'A description written by another lane after 2026-10-06.';
CREATE TABLE public.pipeline_registry(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_name text NOT NULL, column_name text, owned_by text NOT NULL,
  description text NOT NULL, valid_values text[], do_not_write_directly boolean NOT NULL DEFAULT false, write_via text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (table_name, column_name));

-- Readers, verbatim from prod (pg_get_viewdef, 2026-10-06).
CREATE VIEW public.vehicle_latest_event AS
 SELECT DISTINCT ON (ve.vehicle_id) ve.id, ve.vehicle_id, ve.source_organization_id, ve.source_platform, ve.source_url,
    ve.source_listing_id, ve.event_type, ve.event_status, ve.started_at, ve.ended_at, ve.sold_at, ve.starting_price,
    ve.current_price, ve.final_price, ve.reserve_price, ve.buy_now_price, ve.bid_count, ve.comment_count, ve.view_count,
    ve.watcher_count, ve.seller_identifier, ve.buyer_identifier, ve.seller_external_identity_id,
    ve.buyer_external_identity_id, ve.metadata, ve.extracted_at, ve.extraction_method, ve.extraction_source,
    ve.extractor_version, ve.created_at, ve.updated_at, v.year, v.make, v.model
   FROM (vehicle_events ve
     JOIN vehicles v ON ((v.id = ve.vehicle_id)))
  ORDER BY ve.vehicle_id, COALESCE(ve.ended_at, ve.sold_at, ve.started_at, ve.created_at) DESC;
CREATE VIEW public.vehicle_event_summary AS
 SELECT vehicle_id, count(*) AS total_events,
    count(CASE WHEN (event_status = 'sold'::text) THEN 1 ELSE NULL::integer END) AS times_sold,
    count(DISTINCT source_platform) AS platforms_seen,
    array_agg(DISTINCT source_platform ORDER BY source_platform) AS platform_list,
    min(started_at) AS first_event_date,
    max(COALESCE(ended_at, sold_at, started_at)) AS last_event_date,
    max(final_price) AS highest_sale_price,
    min(final_price) FILTER (WHERE (final_price > (0)::numeric)) AS lowest_sale_price,
    round(avg(final_price) FILTER (WHERE (final_price IS NOT NULL)), 2) AS avg_sale_price,
    sum(bid_count) AS total_bids, sum(comment_count) AS total_comments, sum(view_count) AS total_views
   FROM vehicle_events
  GROUP BY vehicle_id;

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF; RAISE NOTICE 'PASS %', label;
END $$;
-- Synthetic ids: u('e001', 7) is 00000000-0000-0000-e001-000000000007.
CREATE FUNCTION pg_temp.u(grp text, n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('00000000-0000-0000-' || grp || '-' || lpad(to_hex(n), 12, '0'))::uuid $$;
-- valuation_by_ymm's day expression (prod body lines 86-89, 2026-10-06), applied to one vehicle's live episodes.
CREATE FUNCTION pg_temp.valuation_day(p_vehicle uuid) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN isfinite(coalesce(e.sold_at, e.ended_at))
          THEN to_char(coalesce(e.sold_at, e.ended_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD') END
   FROM public.vehicle_events e WHERE e.vehicle_id = p_vehicle $$;
-- Expect an error whose message contains a fragment; nothing else counts.
CREATE FUNCTION pg_temp.refuses(label text, call text, fragment text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE call;
  RAISE EXCEPTION 'Contract failed: % (no error raised)', label;
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'Contract failed:%' THEN RAISE; END IF;
  IF position(fragment IN SQLERRM) = 0 THEN
    RAISE EXCEPTION 'Contract failed: % (wrong error: %)', label, SQLERRM;
  END IF;
  RAISE NOTICE 'PASS % (refused: %)', label, SQLERRM;
END $$;
CREATE FUNCTION pg_temp.writes() RETURNS bigint LANGUAGE sql STABLE AS $$ SELECT count(*) FROM public.superseded_rows $$;

-- Fixture rows.
--  e1 RM mo24 map day   e2 Gooding placeholder   e3 Gooding real session   e4 PCARMARKET write clock
--  e5 cited by an observation   e6 keyed by a bid   e7 RM pa25 (stale plans; batch abort)   e8, e9 PCARMARKET (batch)
--  e10 lot-row citation   e11 keyed by a hammer prediction (on another vehicle_id)
INSERT INTO public.vehicles(id, year, make, model)
SELECT pg_temp.u('a001', n), 1950 + n, 'Make', 'Model ' || n FROM generate_series(1, 12) n;
INSERT INTO public.listing_page_snapshots(id, platform, listing_url, http_status, success) VALUES
 (pg_temp.u('5001', 1), 'rmsothebys', 'https://rmsothebys.com/auctions/mo24', 200, false),
 (pg_temp.u('5001', 2), 'gooding', 'https://www.goodingco.com/lot/placeholder-session-lot', 200, true),
 (pg_temp.u('5001', 3), 'gooding', 'https://goodingco.com/lot/Real-Session-Lot/?utm=x', 200, true),
 (pg_temp.u('5001', 4), 'rmsothebys', 'https://rmsothebys.com/auctions/pa25/', 200, false),
 (pg_temp.u('5001', 5), 'gooding', 'https://www.goodingco.com/lot/placeholder-session-lot', 404, false);
INSERT INTO public.vehicle_events(id, vehicle_id, source_platform, source_url, source_listing_id, event_type, event_status,
  sold_at, final_price, metadata, extracted_at, extraction_method, created_at, updated_at) VALUES
 (pg_temp.u('e001', 1), pg_temp.u('a001', 1), 'rm-sothebys', 'https://rmsothebys.com/auctions/mo24/lots/r0001-lot/', NULL,
  'auction', 'sold', '2024-05-11 12:00:00+00', 100000, '{"sold_at_method": "rms_auction_code_map", "sold_at_precision": "day"}',
  '2026-02-06 10:00:00+00', 'orphan-backfill-v1', '2026-02-06 10:00:00+00', '2026-02-06 10:00:00+00'),
 (pg_temp.u('e001', 2), pg_temp.u('a001', 2), 'gooding', 'https://www.goodingco.com/lot/placeholder-session-lot', 'placeholder-session-lot',
  'auction', 'sold', '2005-08-05 07:00:00+00', 200000, '{"sold_at_method": "gooding_snapshot_startdate", "sold_at_precision": "day"}',
  '2026-01-20 10:00:00+00', 'orphan-backfill-v1', '2026-01-20 10:00:00+00', '2026-01-20 10:00:00+00'),
 (pg_temp.u('e001', 3), pg_temp.u('a001', 3), 'gooding', 'https://www.goodingco.com/lot/real-session-lot', 'real-session-lot',
  'auction', 'sold', '2023-08-01 07:00:00+00', 300000, '{"sold_at_method": "gooding_snapshot_startdate"}',
  '2026-01-20 10:00:00+00', 'orphan-backfill-v1', '2026-01-20 10:00:00+00', '2026-01-20 10:00:00+00'),
 (pg_temp.u('e001', 4), pg_temp.u('a001', 4), 'pcarmarket', 'https://pcarmarket.com/auction/write-clock-lot', NULL,
  'auction', 'ended', '2026-02-13 09:01:03.968+00', 40000, '{}',
  '2026-02-13 09:01:04.087+00', 'orphan-backfill-v1', '2026-02-13 09:01:04.087+00', '2026-02-13 09:01:04.087+00'),
 (pg_temp.u('e001', 5), pg_temp.u('a001', 5), 'gooding', 'https://www.goodingco.com/lot/referenced-lot', 'referenced-lot',
  'auction', 'sold', '2010-08-06 07:00:00+00', 50000, '{"sold_at_method": "gooding_snapshot_startdate"}',
  '2026-01-20 10:00:00+00', 'orphan-backfill-v1', '2026-01-20 10:00:00+00', '2026-01-20 10:00:00+00'),
 (pg_temp.u('e001', 6), pg_temp.u('a001', 6), 'bat', 'https://bringatrailer.com/listing/bid-keyed-lot/', 'bid-keyed-lot',
  'auction', 'sold', '2025-03-01 20:00:00+00', 60000, '{}',
  '2026-01-20 10:00:00+00', NULL, '2026-01-20 10:00:00+00', '2026-01-20 10:00:00+00'),
 (pg_temp.u('e001', 7), pg_temp.u('a001', 7), 'rm-sothebys', 'https://rmsothebys.com/auctions/pa25/lots/r0007-lot/', NULL,
  'auction', 'sold', '2025-01-29 12:00:00+00', 70000, '{"sold_at_method": "rms_auction_code_map"}',
  '2026-02-06 10:00:00+00', 'orphan-backfill-v1', '2026-02-06 10:00:00+00', '2026-02-06 10:00:00+00'),
 (pg_temp.u('e001', 8), pg_temp.u('a001', 8), 'pcarmarket', 'https://pcarmarket.com/auction/batch-lot-8', NULL,
  'auction', 'ended', '2026-02-11 08:00:00.123+00', 80000, '{}',
  '2026-02-11 08:00:00.2+00', 'orphan-backfill-v1', '2026-02-11 08:00:00.2+00', '2026-02-11 08:00:00.2+00'),
 (pg_temp.u('e001', 9), pg_temp.u('a001', 9), 'pcarmarket', 'https://pcarmarket.com/auction/batch-lot-9', NULL,
  'auction', 'ended', '2026-02-12 08:00:00.456+00', 90000, '{}',
  '2026-02-12 08:00:00.5+00', 'orphan-backfill-v1', '2026-02-12 08:00:00.5+00', '2026-02-12 08:00:00.5+00'),
 (pg_temp.u('e001', 10), pg_temp.u('a001', 10), 'collecting-cars', 'https://collectingcars.com/for-sale/lot-ten', NULL,
  'auction', 'sold', '2025-06-01 00:00:00+00', 100100, '{"sold_at_method": "import_day"}',
  '2026-02-01 10:00:00+00', 'orphan-backfill-v1', '2026-02-01 10:00:00+00', '2026-02-01 10:00:00+00'),
 (pg_temp.u('e001', 11), pg_temp.u('a001', 11), 'bat', 'https://bringatrailer.com/listing/predicted-lot/', 'predicted-lot',
  'auction', 'sold', '2025-04-01 20:00:00+00', 110000, '{}',
  '2026-01-20 10:00:00+00', NULL, '2026-01-20 10:00:00+00', '2026-01-20 10:00:00+00');
INSERT INTO public.auction_events(id, vehicle_id, source_url) VALUES
 (pg_temp.u('ae01', 1), pg_temp.u('a001', 10), 'https://www.collectingcars.com/for-sale/lot-ten/'),
 (pg_temp.u('ae01', 2), pg_temp.u('a001', 12), 'https://collectingcars.com/for-sale/lot-ten');
INSERT INTO public.vehicle_observations(vehicle_id, source_vehicle_event_id) VALUES (pg_temp.u('a001', 5), pg_temp.u('e001', 5));
INSERT INTO public.bat_bids(bat_listing_id, bat_username, bid_amount, bid_timestamp)
VALUES (pg_temp.u('e001', 6), 'bidder', 60000, '2025-03-01 19:59:00+00');
INSERT INTO public.hammer_predictions(vehicle_id, external_listing_id) VALUES (pg_temp.u('a001', 12), pg_temp.u('e001', 11));

CREATE TEMP TABLE before_rows AS SELECT id, to_jsonb(e) AS row_json FROM public.vehicle_events e;

-- ====================================================================================================================
-- The writer migration, applied while the index name holds an INVALID leftover with the wrong definition.
CREATE INDEX idx_vehicle_observations_source_vehicle_event ON public.vehicle_observations (id);
UPDATE pg_index SET indisvalid = false
 WHERE indexrelid = 'public.idx_vehicle_observations_source_vehicle_event'::regclass;
\ir ../migrations/20261006141500_supersede_vehicle_event_episode.sql

SELECT pg_temp.ok('writer installed; EXECUTE for service_role only',
  has_function_privilege('service_role', 'public.supersede_vehicle_event_episode(uuid,jsonb,jsonb,text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.supersede_vehicle_event_episodes(jsonb,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.supersede_vehicle_event_episode(uuid,jsonb,jsonb,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.supersede_vehicle_event_episode(uuid,jsonb,jsonb,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.supersede_vehicle_event_episodes(jsonb,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.supersede_vehicle_event_episodes(jsonb,text)', 'EXECUTE'));
SELECT pg_temp.ok('functions are SECURITY DEFINER with a pinned search_path',
  (SELECT bool_and(prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp']) FROM pg_proc
    WHERE proname IN ('supersede_vehicle_event_episode', 'supersede_vehicle_event_episodes')));
SELECT pg_temp.ok('registry rows for sold_at and ended_at name the writer and the lock',
  (SELECT count(*) FROM public.pipeline_registry WHERE table_name = 'vehicle_events' AND column_name IN ('sold_at', 'ended_at')
     AND write_via LIKE '%supersede_vehicle_event_episode%' AND write_via LIKE '%clock_locked_by_supersession%') = 2);
SELECT pg_temp.ok('descriptions: superseded_rows and sold_at updated from the measured text; a newer ended_at text left alone',
  obj_description('public.superseded_rows'::regclass, 'pg_class') LIKE '%supersede_vehicle_event_episode%'
  AND col_description('public.vehicle_events'::regclass, 11) LIKE '%Corrections: supersede_vehicle_event_episode%'
  AND col_description('public.vehicle_events'::regclass, 10) = 'A description written by another lane after 2026-10-06.');

SELECT pg_temp.refuses('INVALID index: refuses to retire rows',
  $c$SELECT public.supersede_vehicle_event_episode('00000000-0000-0000-e001-000000000004'::uuid,
     '{"sold_at": {"value": null, "expected": "2026-02-13 09:01:03.968+00"}}',
     '{"type": "vehicle_events_write_clock", "ref": "vehicle_events/00000000-0000-0000-e001-000000000004", "finding": "write clock"}',
     'PCARMARKET sold_at is the import write clock')$c$,
  'idx_vehicle_observations_source_vehicle_event is missing or invalid');

\ir ../migrations/20261006141000_idx_vehicle_observations_source_vehicle_event.sql
SELECT pg_temp.ok('index migration: INVALID leftover dropped, rebuilt with the right definition, valid',
  (SELECT indisvalid FROM pg_index WHERE indexrelid = 'public.idx_vehicle_observations_source_vehicle_event'::regclass)
  AND pg_get_indexdef('public.idx_vehicle_observations_source_vehicle_event'::regclass)
      LIKE '%(source_vehicle_event_id) WHERE (source_vehicle_event_id IS NOT NULL)');
SELECT 'public.idx_vehicle_observations_source_vehicle_event'::regclass::oid AS idx_oid \gset
\ir ../migrations/20261006141000_idx_vehicle_observations_source_vehicle_event.sql
SELECT pg_temp.ok('index migration re-applied: the valid index is kept',
  'public.idx_vehicle_observations_source_vehicle_event'::regclass::oid = :idx_oid);
RESET statement_timeout;
RESET lock_timeout;
SET statement_timeout='30s';
SET lock_timeout='3s';

-- ====================================================================================================================
-- Refused, writing nothing.
SELECT pg_temp.refuses('no source.ref',
  $c$SELECT public.supersede_vehicle_event_episode('00000000-0000-0000-e001-000000000001'::uuid,
     '{"sold_at": {"value": "2024-08-15T12:00:00Z", "expected": "2024-05-11T12:00:00Z"}}',
     '{"type": "listing_page_snapshots", "snapshot_id": "00000000-0000-0000-5001-000000000001", "basis": "rms_auction_page_first_day"}',
     'RM map day contradicted by the auction page')$c$, 'has no cited source');
SELECT pg_temp.refuses('a dated replacement without a captured document',
  $c$SELECT public.supersede_vehicle_event_episode('00000000-0000-0000-e001-000000000001'::uuid,
     '{"sold_at": {"value": "2024-08-15T12:00:00Z", "expected": "2024-05-11T12:00:00Z"}}',
     '{"type": "agent_reasoning", "ref": "memory", "basis": "rms_auction_page_first_day"}',
     'RM map day contradicted by the auction page')$c$, 'must cite a captured document');
SELECT pg_temp.refuses('a cited snapshot that does not exist',
  $c$SELECT public.supersede_vehicle_event_episode('00000000-0000-0000-e001-000000000001'::uuid,
     '{"sold_at": {"value": "2024-08-15T12:00:00Z", "expected": "2024-05-11T12:00:00Z"}}',
     '{"type": "listing_page_snapshots", "ref": "listing_page_snapshots/x", "snapshot_id": "00000000-0000-0000-5001-0000000000ff", "basis": "rms_auction_page_first_day"}',
     'RM map day contradicted by the auction page')$c$, 'which is not a listing_page_snapshots row');
SELECT pg_temp.refuses('a valid snapshot of another listing',
  $c$SELECT public.supersede_vehicle_event_episode('00000000-0000-0000-e001-000000000002'::uuid,
     '{"sold_at": {"value": "2023-08-18T19:00:00Z", "expected": "2005-08-05T07:00:00Z"}}',
     '{"type": "listing_page_snapshots", "ref": "listing_page_snapshots/00000000-0000-0000-5001-000000000003", "snapshot_id": "00000000-0000-0000-5001-000000000003", "basis": "gooding_page_first_session"}',
     'Another lot''s page cited for this lot')$c$, 'neither this episode''s page nor its auction''s page');
SELECT pg_temp.refuses('a valid page of another auction',
  $c$SELECT public.supersede_vehicle_event_episode('00000000-0000-0000-e001-000000000001'::uuid,
     '{"sold_at": {"value": "2025-02-04T12:00:00Z", "expected": "2024-05-11T12:00:00Z"}}',
     '{"type": "listing_page_snapshots", "ref": "listing_page_snapshots/00000000-0000-0000-5001-000000000004", "snapshot_id": "00000000-0000-0000-5001-000000000004", "basis": "rms_auction_page_first_day"}',
     'The pa25 page cited for a mo24 lot')$c$, 'neither this episode''s page nor its auction''s page');
SELECT pg_temp.refuses('a snapshot of the right page not fetched with HTTP 200',
  $c$SELECT public.supersede_vehicle_event_episode('00000000-0000-0000-e001-000000000002'::uuid,
     '{"sold_at": {"value": null, "expected": "2005-08-05T07:00:00Z"}}',
     '{"type": "listing_page_snapshots", "ref": "listing_page_snapshots/00000000-0000-0000-5001-000000000005", "snapshot_id": "00000000-0000-0000-5001-000000000005", "finding": "placeholder session"}',
     'The Gooding page session is a placeholder')$c$, 'not fetched with HTTP 200');
SELECT pg_temp.refuses('a lot row of another vehicle',
  $c$SELECT public.supersede_vehicle_event_episode('00000000-0000-0000-e001-00000000000a'::uuid,
     '{"sold_at": {"value": "2025-05-30T19:00:00Z", "expected": "2025-06-01T00:00:00Z"}}',
     '{"type": "auction_events", "ref": "auction_events/00000000-0000-0000-ae01-000000000002", "lot_row_id": "00000000-0000-0000-ae01-000000000002", "basis": "lot_row_end"}',
     'Another vehicle''s lot row cited')$c$, 'is not this episode''s lot');
SELECT pg_temp.refuses('a dated replacement without a basis',
  $c$SELECT public.supersede_vehicle_event_episode('00000000-0000-0000-e001-000000000001'::uuid,
     '{"sold_at": {"value": "2024-08-15T12:00:00Z", "expected": "2024-05-11T12:00:00Z"}}',
     '{"type": "listing_page_snapshots", "ref": "listing_page_snapshots/00000000-0000-0000-5001-000000000001", "snapshot_id": "00000000-0000-0000-5001-000000000001"}',
     'RM map day contradicted by the auction page')$c$, 'must name its basis');
SELECT pg_temp.refuses('a retraction to unknown without a finding',
  $c$SELECT public.supersede_vehicle_event_episode('00000000-0000-0000-e001-000000000004'::uuid,
     '{"sold_at": {"value": null, "expected": "2026-02-13T09:01:03.968Z"}}',
     '{"type": "vehicle_events_write_clock", "ref": "vehicle_events/00000000-0000-0000-e001-000000000004"}',
     'PCARMARKET sold_at is the import write clock')$c$, 'must state its finding');
SELECT pg_temp.refuses('per field: a NULL beside a cited date still needs a finding',
  $c$SELECT public.supersede_vehicle_event_episode('00000000-0000-0000-e001-000000000001'::uuid,
     '{"sold_at": {"value": "2024-08-15T12:00:00Z", "expected": "2024-05-11T12:00:00Z"}, "ended_at": {"value": null, "expected": null}}',
     '{"type": "listing_page_snapshots", "ref": "listing_page_snapshots/00000000-0000-0000-5001-000000000001", "snapshot_id": "00000000-0000-0000-5001-000000000001", "basis": "rms_auction_page_first_day"}',
     'RM map day contradicted by the auction page')$c$, 'must state its finding');
SELECT pg_temp.refuses('no expected value',
  $c$SELECT public.supersede_vehicle_event_episode('00000000-0000-0000-e001-000000000004'::uuid,
     '{"sold_at": {"value": null}}',
     '{"type": "vehicle_events_write_clock", "ref": "vehicle_events/00000000-0000-0000-e001-000000000004", "finding": "write clock"}',
     'PCARMARKET sold_at is the import write clock')$c$, 'must be {value, expected');
SELECT pg_temp.refuses('a field outside the episode clocks',
  $c$SELECT public.supersede_vehicle_event_episode('00000000-0000-0000-e001-000000000004'::uuid,
     '{"final_price": {"value": null, "expected": null}}',
     '{"type": "vehicle_events_write_clock", "ref": "vehicle_events/00000000-0000-0000-e001-000000000004", "finding": "write clock"}',
     'PCARMARKET sold_at is the import write clock')$c$, 'unsupported field final_price');
SELECT pg_temp.refuses('a reason under 10 characters',
  $c$SELECT public.supersede_vehicle_event_episode('00000000-0000-0000-e001-000000000004'::uuid,
     '{"sold_at": {"value": null, "expected": "2026-02-13T09:01:03.968Z"}}',
     '{"type": "vehicle_events_write_clock", "ref": "vehicle_events/00000000-0000-0000-e001-000000000004", "finding": "write clock"}',
     'wrong')$c$, 'needs a reason');
SELECT pg_temp.refuses('a replacement in the future',
  $c$SELECT public.supersede_vehicle_event_episode('00000000-0000-0000-e001-000000000001'::uuid,
     '{"sold_at": {"value": "2999-01-01T00:00:00Z", "expected": "2024-05-11T12:00:00Z"}}',
     '{"type": "listing_page_snapshots", "ref": "listing_page_snapshots/00000000-0000-0000-5001-000000000001", "snapshot_id": "00000000-0000-0000-5001-000000000001", "basis": "rms_auction_page_first_day"}',
     'RM map day contradicted by the auction page')$c$, 'not in the future');
SET TimeZone = 'America/Los_Angeles';
SELECT pg_temp.refuses('a naive expected timestamp under a non-UTC session',
  $c$SELECT public.supersede_vehicle_event_episode('00000000-0000-0000-e001-000000000001'::uuid,
     '{"sold_at": {"value": "2024-08-15T12:00:00Z", "expected": "2024-05-11 05:00:00"}}',
     '{"type": "listing_page_snapshots", "ref": "listing_page_snapshots/00000000-0000-0000-5001-000000000001", "snapshot_id": "00000000-0000-0000-5001-000000000001", "basis": "rms_auction_page_first_day"}',
     'RM map day contradicted by the auction page')$c$, 'explicit offset');
SELECT pg_temp.refuses('a naive replacement under a non-UTC session',
  $c$SELECT public.supersede_vehicle_event_episode('00000000-0000-0000-e001-000000000001'::uuid,
     '{"sold_at": {"value": "2024-08-15", "expected": "2024-05-11T12:00:00Z"}}',
     '{"type": "listing_page_snapshots", "ref": "listing_page_snapshots/00000000-0000-0000-5001-000000000001", "snapshot_id": "00000000-0000-0000-5001-000000000001", "basis": "rms_auction_page_first_day"}',
     'RM map day contradicted by the auction page')$c$, 'explicit offset');
SET TimeZone = 'UTC';
SET statement_timeout = '90s';
SELECT pg_temp.refuses('a caller statement_timeout over 60 s (single)',
  $c$SELECT public.supersede_vehicle_event_episode('00000000-0000-0000-e001-000000000004'::uuid,
     '{"sold_at": {"value": null, "expected": "2026-02-13T09:01:03.968Z"}}',
     '{"type": "vehicle_events_write_clock", "ref": "vehicle_events/00000000-0000-0000-e001-000000000004", "finding": "write clock"}',
     'PCARMARKET sold_at is the import write clock')$c$, 'caller must set statement_timeout');
SET statement_timeout = '61s';
SELECT pg_temp.refuses('a caller statement_timeout over 60 s (batch)',
  $c$SELECT public.supersede_vehicle_event_episodes('[]'::jsonb, 'x')$c$, 'caller must set statement_timeout');
SET statement_timeout = '30s';
SELECT pg_temp.ok('refused plans wrote nothing',
  pg_temp.writes() = 0
  AND (SELECT count(*) FROM public.vehicle_events e JOIN before_rows b ON b.id = e.id AND to_jsonb(e) = b.row_json) = 11);

-- No write: stale, referenced (observation, bid, prediction on another vehicle_id), missing.
SELECT pg_temp.ok('stale expected value: no write',
  public.supersede_vehicle_event_episode(pg_temp.u('e001', 7),
    '{"sold_at": {"value": "2025-02-04T12:00:00Z", "expected": "2025-01-30T12:00:00Z"}}',
    '{"type": "listing_page_snapshots", "ref": "listing_page_snapshots/00000000-0000-0000-5001-000000000004", "snapshot_id": "00000000-0000-0000-5001-000000000004", "basis": "rms_auction_page_first_day"}',
    'RM map day contradicted by the auction page') ->> 'status' = 'stale');
SELECT pg_temp.ok('episode cited by an observation: referenced, listed, no write',
  (SELECT r ->> 'status' = 'referenced' AND r -> 'referenced_by' -> 0 ->> 'table' = 'vehicle_observations'
     FROM (SELECT public.supersede_vehicle_event_episode(pg_temp.u('e001', 5),
       '{"sold_at": {"value": null, "expected": "2010-08-06T07:00:00Z"}}',
       '{"type": "contract", "ref": "fixture", "finding": "placeholder session"}',
       'Gooding placeholder session, sale day unknown') r) x));
SELECT pg_temp.ok('episode keyed by a bid row: referenced, listed, no write',
  (SELECT r ->> 'status' = 'referenced' AND r -> 'referenced_by' -> 0 ->> 'table' = 'bat_bids'
     FROM (SELECT public.supersede_vehicle_event_episode(pg_temp.u('e001', 6),
       '{"sold_at": {"value": null, "expected": "2025-03-01T20:00:00Z"}}',
       '{"type": "contract", "ref": "fixture", "finding": "fixture"}',
       'Bid-keyed episode must keep its id') r) x));
SELECT pg_temp.ok('episode keyed by a hammer prediction on another vehicle_id: referenced, listed, no write',
  (SELECT r ->> 'status' = 'referenced' AND r -> 'referenced_by' -> 0 ->> 'table' = 'hammer_predictions'
          AND (r -> 'referenced_by' -> 0 ->> 'rows')::int = 1
     FROM (SELECT public.supersede_vehicle_event_episode(pg_temp.u('e001', 11),
       '{"sold_at": {"value": null, "expected": "2025-04-01T20:00:00Z"}}',
       '{"type": "contract", "ref": "fixture", "finding": "fixture"}',
       'Prediction-keyed episode must keep its id') r) x));
SELECT pg_temp.ok('unknown episode id: missing',
  public.supersede_vehicle_event_episode(pg_temp.u('e001', 99),
    '{"sold_at": {"value": null, "expected": null}}',
    '{"type": "contract", "ref": "fixture", "finding": "fixture"}',
    'No such episode in the fixture') ->> 'status' = 'missing');
SELECT pg_temp.ok('stale, referenced and missing wrote nothing',
  pg_temp.writes() = 0
  AND (SELECT count(*) FROM public.vehicle_events e JOIN before_rows b ON b.id = e.id AND to_jsonb(e) = b.row_json) = 11);

-- ====================================================================================================================
-- RM map day -> the page-stated day, cited to its auction's page; run under a non-UTC session TimeZone.
SET TimeZone = 'America/Los_Angeles';
BEGIN;
SELECT set_config('app.writer', 'lane-v-contract', true);
SELECT public.supersede_vehicle_event_episode(pg_temp.u('e001', 1),
  '{"sold_at": {"value": "2024-08-15T12:00:00Z", "expected": "2024-05-11T05:00:00-07:00", "precision": "auction_first_day"}}',
  '{"type": "listing_page_snapshots", "ref": "listing_page_snapshots/00000000-0000-0000-5001-000000000001",
    "snapshot_id": "00000000-0000-0000-5001-000000000001", "basis": "rms_auction_page_first_day",
    "page_range": "15 - 17 August 2024", "finding": "the map gave 2024-05-11; the RM auction page states 15 - 17 August 2024"}',
  'RM sale day from the auction-code map is contradicted by the RM auction page') AS r \gset rm_
SELECT pg_temp.ok('app.writer declared by the writer after it wrote; lock_timeout 3 s',
  current_setting('app.writer', true) = 'supersede_vehicle_event_episode' AND current_setting('lock_timeout') = '3s');
COMMIT;
SET TimeZone = 'UTC';
SELECT (:'rm_r'::jsonb ->> 'replacement_event_id') AS rm_new \gset
SELECT pg_temp.ok('RM: superseded; asserted_by is the caller''s declared writer; matched by auction code',
  :'rm_r'::jsonb ->> 'status' = 'superseded' AND :'rm_r'::jsonb ->> 'asserted_by' = 'lane-v-contract'
  AND :'rm_r'::jsonb -> 'citation_match' -> 'snapshot' ->> 'kind' = 'auction_page'
  AND :'rm_r'::jsonb -> 'citation_match' -> 'snapshot' ->> 'auction_code' = 'mo24');
SELECT pg_temp.ok('RM: the original id is no longer live',
  NOT EXISTS (SELECT 1 FROM public.vehicle_events WHERE id = pg_temp.u('e001', 1)));
SELECT pg_temp.ok('RM: the original is retired whole into superseded_rows, unchanged, with the citation match',
  (SELECT s.row_data = b.row_json AND s.source_table = 'vehicle_events' AND s.asserted_by = 'lane-v-contract'
          AND s.source ->> 'replacement_event_id' = :'rm_new' AND s.source ->> 'writer' = 'supersede_vehicle_event_episode'
          AND s.source -> 'citation_match' -> 'snapshot' ->> 'auction_code' = 'mo24'
          AND (s.source -> 'corrections' -> 'sold_at' ->> 'original')::timestamptz = '2024-05-11 12:00:00+00'
          AND (s.source -> 'corrections' -> 'sold_at' ->> 'replacement')::timestamptz = '2024-08-15 12:00:00+00'
          AND s.source -> 'corrections' -> 'sold_at' ->> 'replacement' LIKE '%+00:00'
          AND s.reason LIKE 'RM sale day%'
     FROM public.superseded_rows s JOIN before_rows b ON b.id = s.row_id WHERE s.row_id = pg_temp.u('e001', 1)));
SELECT pg_temp.ok('RM: the replacement holds the page day, the listing key, price, first-landing clock and the lock',
  (SELECT e.sold_at = '2024-08-15 12:00:00+00' AND e.ended_at IS NULL AND e.vehicle_id = pg_temp.u('a001', 1)
          AND e.source_platform = 'rm-sothebys' AND e.source_url = 'https://rmsothebys.com/auctions/mo24/lots/r0001-lot/'
          AND e.final_price = 100000 AND e.event_status = 'sold' AND e.extraction_method = 'orphan-backfill-v1'
          AND e.created_at = '2026-02-06 10:00:00+00' AND e.extracted_at = '2026-02-06 10:00:00+00'
          AND e.updated_at > '2026-10-01'
          AND e.metadata ->> 'sold_at_method' = 'rms_auction_page_first_day'
          AND e.metadata ->> 'sold_at_precision' = 'auction_first_day'
          AND e.metadata -> 'episode_supersessions' -> 0 ->> 'supersedes_event_id' = pg_temp.u('e001', 1)::text
          AND e.metadata -> 'episode_supersessions' -> 0 ->> 'superseded_row_id' =
              (SELECT id::text FROM public.superseded_rows WHERE row_id = pg_temp.u('e001', 1))
          AND e.metadata -> 'clock_locked_by_supersession' -> 'fields' = '["sold_at"]'::jsonb
          AND e.metadata -> 'clock_locked_by_supersession' ->> 'superseded_row_id' =
              (SELECT id::text FROM public.superseded_rows WHERE row_id = pg_temp.u('e001', 1))
     FROM public.vehicle_events e WHERE e.id = :'rm_new'::uuid));

-- A second call is a no-op, by the old id (already) and by the new id (noop); app.writer untouched by no-writes.
BEGIN;
SELECT set_config('app.writer', 'lane-v-noop-check', true);
SELECT pg_temp.ok('RM second call by the original id: already, names the replacement, writes nothing',
  (SELECT r ->> 'status' = 'already' AND r ->> 'replacement_event_id' = :'rm_new' FROM (SELECT public.supersede_vehicle_event_episode(pg_temp.u('e001', 1),
    '{"sold_at": {"value": "2024-08-15T12:00:00Z", "expected": "2024-05-11T12:00:00Z", "precision": "auction_first_day"}}',
    '{"type": "listing_page_snapshots", "ref": "listing_page_snapshots/00000000-0000-0000-5001-000000000001",
      "snapshot_id": "00000000-0000-0000-5001-000000000001", "basis": "rms_auction_page_first_day"}',
    'RM sale day from the auction-code map is contradicted by the RM auction page') r) x)
  AND pg_temp.writes() = 1 AND (SELECT count(*) FROM public.vehicle_events) = 11);
SELECT pg_temp.ok('RM call on the replacement with the same values: noop',
  public.supersede_vehicle_event_episode(:'rm_new'::uuid,
    '{"sold_at": {"value": "2024-08-15T12:00:00Z", "expected": "2024-05-11T12:00:00Z"}}',
    '{"type": "listing_page_snapshots", "ref": "listing_page_snapshots/00000000-0000-0000-5001-000000000001",
      "snapshot_id": "00000000-0000-0000-5001-000000000001", "basis": "rms_auction_page_first_day"}',
    'RM sale day from the auction-code map is contradicted by the RM auction page') ->> 'status' = 'noop'
  AND pg_temp.writes() = 1);
SELECT pg_temp.ok('no-write calls leave the caller''s app.writer alone',
  current_setting('app.writer', true) = 'lane-v-noop-check');
COMMIT;
SELECT pg_temp.ok('RM: the listing key still admits exactly one live row',
  (SELECT count(*) FROM public.vehicle_events WHERE vehicle_id = pg_temp.u('a001', 1) AND source_platform = 'rm-sothebys') = 1);

-- Gooding placeholder session -> NULL (the page states no real day); Gooding real session -> the page-stated day.
SELECT pg_temp.ok('Gooding placeholder: superseded to NULL with its own page snapshot and the finding',
  public.supersede_vehicle_event_episode(pg_temp.u('e001', 2),
    '{"sold_at": {"value": null, "expected": "2005-08-05T07:00:00+00:00"}}',
    '{"type": "listing_page_snapshots", "ref": "listing_page_snapshots/00000000-0000-0000-5001-000000000002",
      "snapshot_id": "00000000-0000-0000-5001-000000000002",
      "finding": "the page carries a placeholder auction session (one session at 09:00, no viewing sessions, UTC offset +02:00 on a US sale), not the sale day"}',
    'The Gooding page''s session date is a CMS placeholder, not the sale day') ->> 'status' = 'superseded');
SELECT pg_temp.ok('Gooding placeholder: replacement sold_at NULL, dating method removed, lock and history kept',
  (SELECT e.sold_at IS NULL AND NOT (e.metadata ? 'sold_at_method') AND NOT (e.metadata ? 'sold_at_precision')
          AND e.final_price = 200000 AND e.source_listing_id = 'placeholder-session-lot'
          AND (e.metadata -> 'episode_supersessions' -> 0 -> 'corrections' -> 'sold_at' -> 'replacement') = 'null'::jsonb
          AND e.metadata -> 'episode_supersessions' -> 0 -> 'citation_match' -> 'snapshot' ->> 'kind' = 'listing_page'
          AND e.metadata -> 'clock_locked_by_supersession' -> 'fields' = '["sold_at"]'::jsonb
     FROM public.vehicle_events e WHERE e.vehicle_id = pg_temp.u('a001', 2))
  AND (SELECT (row_data ->> 'sold_at')::timestamptz = '2005-08-05 07:00:00+00' FROM public.superseded_rows
        WHERE row_id = pg_temp.u('e001', 2)));
SELECT pg_temp.ok('Gooding real session: superseded to the page-stated day (snapshot URL differs only by case, www, slash, query)',
  public.supersede_vehicle_event_episode(pg_temp.u('e001', 3),
    '{"sold_at": {"value": "2023-08-18T19:00:00Z", "expected": "2023-08-01T07:00:00Z", "precision": "auction_first_day"}}',
    '{"type": "listing_page_snapshots", "ref": "listing_page_snapshots/00000000-0000-0000-5001-000000000003",
      "snapshot_id": "00000000-0000-0000-5001-000000000003", "basis": "gooding_page_first_session"}',
    'The Gooding page states its first auction session; the stored day was not it') ->> 'status' = 'superseded');
-- (Checks read the table in a later statement: a statement's own snapshot predates the writer's changes.)
SELECT pg_temp.ok('Gooding real session: replacement holds the page day and names its basis',
  (SELECT e.sold_at = '2023-08-18 19:00:00+00' AND e.metadata ->> 'sold_at_method' = 'gooding_page_first_session'
          AND e.metadata ->> 'sold_at_precision' = 'auction_first_day'
     FROM public.vehicle_events e WHERE e.vehicle_id = pg_temp.u('a001', 3)));

-- PCARMARKET write clock -> NULL (unknown), cited to the row's own write clock.
SELECT pg_temp.ok('PCARMARKET write clock: superseded to NULL',
  public.supersede_vehicle_event_episode(pg_temp.u('e001', 4),
    '{"sold_at": {"value": null, "expected": "2026-02-13T09:01:03.968Z"}}',
    '{"type": "vehicle_events_write_clock", "ref": "vehicle_events/00000000-0000-0000-e001-000000000004",
      "finding": "sold_at 2026-02-13 09:01:03.968+00 is a write clock: millisecond precision, 0 s from the row''s created_at",
      "asserted_by": "lane-v-pcm"}',
    'PCARMARKET sold_at is the import write clock, not the auction end') ->> 'status' = 'superseded');
SELECT pg_temp.ok('PCARMARKET: replacement has no sale instant, keeps status and first-landing clock; original retired',
  (SELECT e.sold_at IS NULL AND e.event_status = 'ended' AND e.created_at = '2026-02-13 09:01:04.087+00'
       FROM public.vehicle_events e WHERE e.vehicle_id = pg_temp.u('a001', 4))
  AND (SELECT asserted_by = 'lane-v-pcm' AND (row_data ->> 'sold_at')::timestamptz = '2026-02-13 09:01:03.968+00'
       FROM public.superseded_rows WHERE row_id = pg_temp.u('e001', 4)));

-- A lot row of the same vehicle and URL is a valid citation.
SELECT pg_temp.ok('lot row of the same vehicle and URL: superseded, matched as lot_row',
  (SELECT r ->> 'status' = 'superseded' AND r -> 'citation_match' -> 'lot_row' ->> 'lot_row_id' = pg_temp.u('ae01', 1)::text
     FROM (SELECT public.supersede_vehicle_event_episode(pg_temp.u('e001', 10),
       '{"sold_at": {"value": "2025-05-30T19:00:00+00:00", "expected": "2025-06-01T00:00:00Z"}}',
       '{"type": "auction_events", "ref": "auction_events/00000000-0000-0000-ae01-000000000001", "lot_row_id": "00000000-0000-0000-ae01-000000000001", "basis": "lot_row_end"}',
       'The lot row states the sale day; the stored day was the import day') r) x));

-- Readers prefer the replacement, with no reader change.
SELECT pg_temp.ok('vehicle_latest_event returns the replacement (RM page day; PCARMARKET no sale instant)',
  (SELECT id = :'rm_new'::uuid AND sold_at = '2024-08-15 12:00:00+00' FROM public.vehicle_latest_event
    WHERE vehicle_id = pg_temp.u('a001', 1))
  AND (SELECT sold_at IS NULL FROM public.vehicle_latest_event WHERE vehicle_id = pg_temp.u('a001', 4)));
SELECT pg_temp.ok('vehicle_event_summary: one event per vehicle, last date from the replacement',
  (SELECT total_events = 1 AND last_event_date = '2024-08-15 12:00:00+00' FROM public.vehicle_event_summary
    WHERE vehicle_id = pg_temp.u('a001', 1))
  AND (SELECT total_events = 1 AND last_event_date IS NULL FROM public.vehicle_event_summary
    WHERE vehicle_id = pg_temp.u('a001', 2)));
SELECT pg_temp.ok('valuation_by_ymm day expression: page day for RM, undated for Gooding placeholder and PCARMARKET',
  pg_temp.valuation_day(pg_temp.u('a001', 1)) = '2024-08-15'
  AND pg_temp.valuation_day(pg_temp.u('a001', 2)) IS NULL
  AND pg_temp.valuation_day(pg_temp.u('a001', 4)) IS NULL);

-- ====================================================================================================================
-- Batch: counts by status (referenced included), asserted_by on every row, the caller's app.writer restored.
BEGIN;
SELECT set_config('app.writer', 'lane-v-caller', true);
SELECT public.supersede_vehicle_event_episodes(jsonb_build_array(
  jsonb_build_object('event_id', pg_temp.u('e001', 8),
    'corrections', '{"sold_at": {"value": null, "expected": "2026-02-11T08:00:00.123Z"}}'::jsonb,
    'source', jsonb_build_object('type', 'vehicle_events_write_clock', 'ref', 'vehicle_events/' || pg_temp.u('e001', 8), 'finding', 'write clock'),
    'reason', 'PCARMARKET sold_at is the import write clock'),
  jsonb_build_object('event_id', pg_temp.u('e001', 9),
    'corrections', '{"sold_at": {"value": null, "expected": "2026-02-12T08:00:00.456Z"}}'::jsonb,
    'source', jsonb_build_object('type', 'vehicle_events_write_clock', 'ref', 'vehicle_events/' || pg_temp.u('e001', 9), 'finding', 'write clock'),
    'reason', 'PCARMARKET sold_at is the import write clock'),
  jsonb_build_object('event_id', pg_temp.u('e001', 4),
    'corrections', '{"sold_at": {"value": null, "expected": "2026-02-13T09:01:03.968Z"}}'::jsonb,
    'source', jsonb_build_object('type', 'vehicle_events_write_clock', 'ref', 'vehicle_events/' || pg_temp.u('e001', 4), 'finding', 'write clock'),
    'reason', 'PCARMARKET sold_at is the import write clock'),
  jsonb_build_object('event_id', pg_temp.u('e001', 7),
    'corrections', '{"sold_at": {"value": "2025-02-04T12:00:00Z", "expected": "2025-01-30T12:00:00Z"}}'::jsonb,
    'source', jsonb_build_object('type', 'listing_page_snapshots', 'ref', 'listing_page_snapshots/' || pg_temp.u('5001', 4),
      'snapshot_id', pg_temp.u('5001', 4), 'basis', 'rms_auction_page_first_day'),
    'reason', 'RM sale day from the auction-code map is contradicted by the RM auction page'),
  jsonb_build_object('event_id', pg_temp.u('e001', 11),
    'corrections', '{"sold_at": {"value": null, "expected": "2025-04-01T20:00:00Z"}}'::jsonb,
    'source', jsonb_build_object('type', 'contract', 'ref', 'fixture', 'finding', 'fixture'),
    'reason', 'Prediction-keyed episode must keep its id')),
  'lane-v-batch') AS b \gset batch_
SELECT pg_temp.ok('batch restores the caller''s app.writer',
  current_setting('app.writer', true) = 'lane-v-caller');
COMMIT;
SELECT pg_temp.ok('batch: 2 superseded, 1 already, 1 stale, 1 referenced (listed), 2 held',
  (:'batch_b'::jsonb -> 'counts' ->> 'superseded')::int = 2 AND (:'batch_b'::jsonb -> 'counts' ->> 'already')::int = 1
  AND (:'batch_b'::jsonb -> 'counts' ->> 'stale')::int = 1 AND (:'batch_b'::jsonb -> 'counts' ->> 'referenced')::int = 1
  AND jsonb_array_length(:'batch_b'::jsonb -> 'held') = 2 AND jsonb_array_length(:'batch_b'::jsonb -> 'replaced') = 2
  AND jsonb_path_exists(:'batch_b'::jsonb, '$.held[*].referenced_by[*] ? (@.table == "hammer_predictions")'));
SELECT pg_temp.ok('batch: asserted_by recorded on every row it retired',
  (SELECT count(*) FROM public.superseded_rows WHERE row_id IN (pg_temp.u('e001', 8), pg_temp.u('e001', 9))
     AND asserted_by = 'lane-v-batch') = 2);
SELECT pg_temp.refuses('batch: an uncited row aborts the whole batch',
  format($c$SELECT public.supersede_vehicle_event_episodes(%L::jsonb, 'lane-v-batch')$c$, jsonb_build_array(
    jsonb_build_object('event_id', pg_temp.u('e001', 7),
      'corrections', '{"sold_at": {"value": "2025-02-04T12:00:00Z", "expected": "2025-01-29T12:00:00Z"}}'::jsonb,
      'source', jsonb_build_object('type', 'listing_page_snapshots', 'ref', 'listing_page_snapshots/' || pg_temp.u('5001', 4),
        'snapshot_id', pg_temp.u('5001', 4), 'basis', 'rms_auction_page_first_day'),
      'reason', 'RM sale day from the auction-code map is contradicted by the RM auction page'),
    jsonb_build_object('event_id', pg_temp.u('e001', 5),
      'corrections', '{"sold_at": {"value": "2010-08-07T12:00:00Z", "expected": "2010-08-06T07:00:00Z"}}'::jsonb,
      'source', jsonb_build_object('type', 'memory', 'ref', 'agent'),
      'reason', 'Guess with no captured document behind it'))::text),
  'must cite a captured document');
SELECT pg_temp.ok('batch abort rolled back its first row too',
  (SELECT sold_at = '2025-01-29 12:00:00+00' FROM public.vehicle_events WHERE id = pg_temp.u('e001', 7))
  AND NOT EXISTS (SELECT 1 FROM public.superseded_rows WHERE row_id = pg_temp.u('e001', 7)));
SELECT pg_temp.refuses('batch: more than 100 rows refused',
  $c$SELECT public.supersede_vehicle_event_episodes((SELECT jsonb_agg(jsonb_build_object('event_id', gen_random_uuid())) FROM generate_series(1, 101)), 'x')$c$,
  'at most 100 rows');
SELECT pg_temp.ok('totals: 7 retired, 11 live episodes, 1 per vehicle; untouched rows unchanged',
  pg_temp.writes() = 7 AND (SELECT count(*) FROM public.vehicle_events) = 11
  AND (SELECT count(DISTINCT vehicle_id) FROM public.vehicle_events) = 11
  AND (SELECT count(*) FROM public.vehicle_events e JOIN before_rows b ON b.id = e.id AND to_jsonb(e) = b.row_json) = 4);

-- The row copy refuses a generated column (it would need an explicit column list).
ALTER TABLE public.vehicle_events ADD COLUMN contract_generated integer GENERATED ALWAYS AS (1) STORED;
SELECT pg_temp.refuses('a generated column on vehicle_events stops the row copy',
  $c$SELECT public.supersede_vehicle_event_episode('00000000-0000-0000-e001-000000000007'::uuid,
     '{"sold_at": {"value": "2025-02-04T12:00:00Z", "expected": "2025-01-29T12:00:00Z"}}',
     '{"type": "listing_page_snapshots", "ref": "listing_page_snapshots/00000000-0000-0000-5001-000000000004", "snapshot_id": "00000000-0000-0000-5001-000000000004", "basis": "rms_auction_page_first_day"}',
     'RM sale day from the auction-code map is contradicted by the RM auction page')$c$,
  'generated or identity column');
ALTER TABLE public.vehicle_events DROP COLUMN contract_generated;

-- ====================================================================================================================
-- Migration: re-applying is a no-op; a drifted body is refused.
SELECT md5(pg_get_functiondef('public.supersede_vehicle_event_episode(uuid,jsonb,jsonb,text)'::regprocedure)) AS fp_single,
       md5(pg_get_functiondef('public.supersede_vehicle_event_episodes(jsonb,text)'::regprocedure)) AS fp_batch \gset
\echo post-migration fingerprints :fp_single :fp_batch
\ir ../migrations/20261006141500_supersede_vehicle_event_episode.sql
SELECT pg_temp.ok('re-applying the migration leaves both bodies unchanged',
  md5(pg_get_functiondef('public.supersede_vehicle_event_episode(uuid,jsonb,jsonb,text)'::regprocedure)) = :'fp_single'
  AND md5(pg_get_functiondef('public.supersede_vehicle_event_episodes(jsonb,text)'::regprocedure)) = :'fp_batch'
  AND (SELECT count(*) FROM public.pipeline_registry WHERE table_name = 'vehicle_events') = 2);
CREATE OR REPLACE FUNCTION public.supersede_vehicle_event_episode(p_event_id uuid, p_corrections jsonb, p_source jsonb, p_reason text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$ BEGIN RETURN jsonb_build_object('status', 'drifted fixture'); END; $function$;
SELECT md5(pg_get_functiondef('public.supersede_vehicle_event_episode(uuid,jsonb,jsonb,text)'::regprocedure)) AS drifted_fp \gset
\echo The ERROR below is the guard of the migration refusing a drifted body: the expected result.
\set ON_ERROR_STOP off
\ir ../migrations/20261006141500_supersede_vehicle_event_episode.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok('drifted body: migration refused, definition untouched',
  md5(pg_get_functiondef('public.supersede_vehicle_event_episode(uuid,jsonb,jsonb,text)'::regprocedure)) = :'drifted_fp');

SELECT 'vehicle-event episode supersession contract: all passed' AS result;
