-- Isolated PostgreSQL 17 contract for 20261007031500_key_vehicle_event_listing_ids_v2.sql (the deployable form of
-- 20261007020500, which is now a comment-only ledger note).
-- Synthetic rows only; never production. Run in an empty disposable dm_refinement_* database:
--   createdb dm_refinement_vehicle_event_listing_ids_ci
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_vehicle_event_listing_ids_ci -f supabase/sql/test_vehicle_event_listing_ids.sql
-- Fixtures carry the live shapes read from prod on 2026-10-07: vehicle_events (all 31 columns, its two partial unique
-- keys, the NOT VALID vehicle FK), normalize_listing_url_key (live body, md5 1442a35b...), preserve_bat_live_projection
-- (live body) and its trigger, write_receipts, pipeline_registry, and the #703 clock-lock guard applied from its own
-- migration file. Cases:
--   * keyed: Gooding lot URLs with and without www and a trailing slash, an RM auction lot URL, an upper-case URL, two
--     vehicles holding one lot (the index is per vehicle), a row locked by supersession (clocks, metadata, updated_at
--     untouched; the guard trigger does not fire), a row carrying a BaT live projection;
--   * left NULL and counted: conceptcarz:// pseudo-URLs, another site's page under a gooding row, a NULL URL, a key a
--     keyed row of the same vehicle already holds, two NULL-key rows of one vehicle that normalize alike;
--   * untouched: other platforms (bat, rmsothebys), keys already set;
--   * after the fill a lander's read by key finds the row and a second episode for the lot is refused by the index;
--   * guards, grants, the block cursor, receipts, function-level settings restored, idempotence.
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
-- Prod's deploy role owns the tables and is not a superuser. The fixture is built, and the migration applied, as such a
-- role, so a statement only a superuser may run fails here as it failed on prod (#722: a function-level SET of
-- app.writer, "permission denied to set parameter", deploy run 37557001434).
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
CREATE TABLE public.vehicles(id uuid PRIMARY KEY);
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
CREATE INDEX idx_vehicle_events_platform ON public.vehicle_events USING btree (source_platform);
COMMENT ON COLUMN public.vehicle_events.source_listing_id IS
'Listing identity on the platform: a numeric BaT lot id on older rows, a normalized URL key (normalizeListingUrlKey) from extract-bat-core, else the lot number. Unique per (vehicle_id, source_platform, source_listing_id). Unit: none. Source: the writing extractor. Grain: one vehicle listing. Clock: n/a.';

CREATE TABLE public.pipeline_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_name text NOT NULL, column_name text,
  owned_by text NOT NULL, description text NOT NULL, valid_values text[],
  do_not_write_directly boolean NOT NULL DEFAULT false, write_via text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (table_name, column_name)
);
CREATE TABLE public.write_receipts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(), tbl text NOT NULL, op text NOT NULL,
  rows integer NOT NULL, writer text NOT NULL, db_role text NOT NULL,
  app_name text, txid bigint NOT NULL
);

-- Live body (prod 2026-10-07, md5 of pg_get_functiondef starts 1442a35b; migration 20260112000002).
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

-- Live body (prod 2026-10-07, md5 of pg_get_functiondef starts 342001b9) and trigger.
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
CREATE TABLE public.vehicle_observations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid,
  extraction_method text, source_vehicle_event_id uuid);
CREATE TRIGGER preserve_bat_live_projection BEFORE UPDATE ON public.vehicle_events
  FOR EACH ROW EXECUTE FUNCTION public.preserve_bat_live_projection();

-- The #703 guard, from its own migration (it also appends to registry rows and column comments when present).
\ir ../migrations/20261006212500_guard_vehicle_event_clock_locks.sql

-- Rows ------------------------------------------------------------------------------------------------------------
--   va: Gooding lot with www                        -> keyed goodingco.com/lot/a
--   vb: Gooding lot without www, trailing slash     -> keyed goodingco.com/lot/b
--   vc: RM auction lot                              -> keyed rmsothebys.com/auctions/az24/lots/r0001-x
--   vd: conceptcarz pseudo-URL (gooding and RM)     -> NULL, not_a_web_url
--   ve: bringatrailer.com page on a gooding row     -> NULL, other_host
--   vf: lot already keyed on this vehicle           -> NULL, keyed_twin
--   vg: www and non-www rows of one lot, one vehicle-> both NULL, unkeyed_twin
--   vh, vi: one lot on two vehicles                 -> both keyed (the index is per vehicle)
--   vj: locked by supersession, sold_at NULL        -> keyed; clocks, metadata and updated_at untouched
--   vk: upper-case URL with a query and fragment    -> keyed goodingco.com/lot/k
--   vl: NULL URL                                    -> NULL, no_url
--   vm: BaT live projection on a gooding row        -> keyed; live_stream untouched
--   vn: a bat row and an rmsothebys row, NULL key   -> untouched, not counted
--   vo: a gooding row already keyed with a lot number -> untouched
--   filler: 1,500 bat rows over many heap blocks
CREATE TEMP TABLE v(name text PRIMARY KEY, id uuid);
INSERT INTO v SELECT 'v' || c, gen_random_uuid() FROM unnest(string_to_array('a,b,c,d,e,f,g,h,i,j,k,l,m,n,o', ',')) c;
INSERT INTO public.vehicles SELECT id FROM v;

-- First straddling row: lands in heap block 0.
INSERT INTO public.vehicle_events (vehicle_id, source_platform, source_url, event_status, extraction_method, created_at, updated_at)
SELECT id, 'gooding', 'https://www.goodingco.com/lot/a', 'sold', 'orphan-backfill-v1', '2026-02-01', '2026-02-02' FROM v WHERE name = 'va';

INSERT INTO public.vehicle_events (vehicle_id, source_platform, source_url, source_listing_id, event_status, metadata, created_at, updated_at)
SELECT (SELECT id FROM v WHERE name = 'vn'), 'bat', 'https://bringatrailer.com/listing/filler-' || g, NULL, 'sold',
       jsonb_build_object('pad', repeat('x', 200)), '2026-01-01', '2026-01-02'
FROM generate_series(1, 1500) g;

INSERT INTO public.vehicle_events (vehicle_id, source_platform, source_url, source_listing_id, event_status, sold_at, extraction_method, metadata, created_at, updated_at)
VALUES
  ((SELECT id FROM v WHERE name = 'vb'), 'gooding', 'https://goodingco.com/lot/b/', NULL, 'sold', '2019-08-17 00:00Z', 'orphan-backfill-v1', '{}', '2026-02-01', '2026-02-02'),
  ((SELECT id FROM v WHERE name = 'vc'), 'rm-sothebys', 'https://rmsothebys.com/auctions/az24/lots/r0001-x/', NULL, 'sold', '2024-01-25 12:00Z', 'orphan-backfill-v1', '{}', '2026-02-01', '2026-02-02'),
  ((SELECT id FROM v WHERE name = 'vd'), 'gooding', 'conceptcarz://event/1337/1939 Alfa Romeo Tipo 256Chassis#:915026', NULL, 'sold', NULL, 'orphan-backfill-v1', '{}', '2026-02-01', '2026-02-02'),
  ((SELECT id FROM v WHERE name = 'vd'), 'rm-sothebys', 'conceptcarz://event/2215/1956 Jaguar D-TypeChassis#: 1D 50661', NULL, 'sold', NULL, 'orphan-backfill-v1', '{}', '2026-02-01', '2026-02-02'),
  ((SELECT id FROM v WHERE name = 've'), 'gooding', 'https://bringatrailer.com/listing/1967-ford-mustang-12', NULL, 'sold', NULL, 'orphan-backfill-v1', '{}', '2026-02-01', '2026-02-02'),
  ((SELECT id FROM v WHERE name = 'vf'), 'gooding', 'https://www.goodingco.com/lot/f', 'goodingco.com/lot/f', 'sold', NULL, NULL, '{"source":"extract-gooding"}', '2026-03-01', '2026-03-02'),
  ((SELECT id FROM v WHERE name = 'vf'), 'gooding', 'https://goodingco.com/lot/f/', NULL, 'sold', NULL, 'orphan-backfill-v1', '{}', '2026-02-01', '2026-02-02'),
  ((SELECT id FROM v WHERE name = 'vg'), 'gooding', 'https://www.goodingco.com/lot/g', NULL, 'sold', NULL, 'orphan-backfill-v1', '{}', '2026-02-01', '2026-02-02'),
  ((SELECT id FROM v WHERE name = 'vg'), 'gooding', 'https://goodingco.com/lot/g', NULL, 'sold', NULL, 'orphan-backfill-v1', '{}', '2026-02-01', '2026-02-02'),
  ((SELECT id FROM v WHERE name = 'vh'), 'rm-sothebys', 'https://rmsothebys.com/auctions/mo24/lots/r0002-y', NULL, 'sold', NULL, 'orphan-backfill-v1', '{}', '2026-02-01', '2026-02-02'),
  ((SELECT id FROM v WHERE name = 'vi'), 'rm-sothebys', 'https://rmsothebys.com/auctions/mo24/lots/r0002-y', NULL, 'sold', NULL, 'orphan-backfill-v1', '{}', '2026-02-01', '2026-02-02'),
  ((SELECT id FROM v WHERE name = 'vj'), 'gooding', 'https://www.goodingco.com/lot/j', NULL, 'sold', NULL, 'orphan-backfill-v1',
     jsonb_build_object('episode_supersessions', jsonb_build_array(jsonb_build_object('supersedes_event_id', gen_random_uuid())),
       'clock_locked_by_supersession', jsonb_build_object('fields', jsonb_build_array('sold_at'), 'writer', 'supersede_vehicle_event_episode')),
     '2026-02-01', '2026-10-06 14:00Z'),
  ((SELECT id FROM v WHERE name = 'vk'), 'gooding', '  HTTPS://WWW.GoodingCo.com/lot/K/?utm=1#top', NULL, 'sold', NULL, 'orphan-backfill-v1', '{}', '2026-02-01', '2026-02-02'),
  ((SELECT id FROM v WHERE name = 'vl'), 'gooding', NULL, NULL, 'sold', NULL, 'orphan-backfill-v1', '{}', '2026-02-01', '2026-02-02'),
  ((SELECT id FROM v WHERE name = 'vm'), 'gooding', 'https://www.goodingco.com/lot/m', NULL, 'active', NULL, NULL,
     jsonb_build_object('live_stream', jsonb_build_object('received_at', '2026-10-01T00:00:00Z', 'bid', 1000)), '2026-02-01', '2026-02-02'),
  ((SELECT id FROM v WHERE name = 'vn'), 'bat', 'https://bringatrailer.com/listing/1990-x', NULL, 'sold', NULL, NULL, '{}', '2026-02-01', '2026-02-02'),
  ((SELECT id FROM v WHERE name = 'vn'), 'rmsothebys', 'https://rmsothebys.com/auctions/pa25/lots/r0003-z', NULL, 'sold', NULL, NULL, '{}', '2026-02-01', '2026-02-02'),
  ((SELECT id FROM v WHERE name = 'vo'), 'gooding', 'https://www.goodingco.com/lot/o', 'LOT-117', 'sold', NULL, NULL, '{}', '2026-02-01', '2026-02-02');

-- Second straddling row: lands in the last heap block.
INSERT INTO public.vehicle_events (vehicle_id, source_platform, source_url, event_status, extraction_method, created_at, updated_at)
SELECT id, 'rm-sothebys', 'https://rmsothebys.com/auctions/pa25/lots/r0099-last', 'sold', 'orphan-backfill-v1', '2026-02-01', '2026-02-02' FROM v WHERE name = 'va';

-- Probe: a trigger with the #703 guard's column list records every row an UPDATE naming those columns reaches.
CREATE TABLE public.probe_clock_column_updates(event_id uuid, at timestamptz DEFAULT clock_timestamp());
CREATE FUNCTION public.probe_clock_column_updates() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN INSERT INTO public.probe_clock_column_updates(event_id) VALUES (NEW.id); RETURN NEW; END $$;
CREATE TRIGGER zz_probe_clock_column_updates BEFORE UPDATE OF sold_at, ended_at, metadata ON public.vehicle_events
  FOR EACH ROW EXECUTE FUNCTION public.probe_clock_column_updates();
-- Probe: the writer a statement-level trigger (record_write_receipt reads the same setting) sees on each UPDATE.
CREATE TABLE public.probe_update_writers(writer text, at timestamptz DEFAULT clock_timestamp());
CREATE FUNCTION public.probe_update_writers() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN INSERT INTO public.probe_update_writers(writer) VALUES (current_setting('app.writer', true)); RETURN NULL; END $$;
CREATE TRIGGER zz_probe_update_writers AFTER UPDATE ON public.vehicle_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.probe_update_writers();

CREATE TEMP TABLE events_before AS SELECT * FROM public.vehicle_events;
CREATE TEMP TABLE straddle_blocks AS
  SELECT id, ((ctid::text)::point)[0]::bigint AS blk FROM public.vehicle_events
  WHERE source_url IN ('https://www.goodingco.com/lot/a', 'https://rmsothebys.com/auctions/pa25/lots/r0099-last');
-- A stale registration the migration must replace.
INSERT INTO public.pipeline_registry (table_name, column_name, owned_by, description)
VALUES ('vehicle_events', 'source_listing_id', 'stale-owner', 'stale registration');
ANALYZE public.vehicle_events;

-- The first file is a comment-only ledger note now; replaying it runs nothing. The corrected file applies after it.
\ir ../migrations/20261007020500_key_vehicle_event_listing_ids.sql
SELECT pg_temp.ok('the ledger note 20261007020500 creates nothing',
  to_regprocedure('public.key_vehicle_event_listing_ids(integer, bigint)') IS NULL);
\ir ../migrations/20261007031500_key_vehicle_event_listing_ids_v2.sql

-- The migration itself ---------------------------------------------------------------------------------------------
SELECT pg_temp.ok('migration keys no row',
  NOT EXISTS (SELECT 1 FROM public.vehicle_events e JOIN events_before b USING (id)
              WHERE e.source_listing_id IS DISTINCT FROM b.source_listing_id));
SELECT pg_temp.ok('registry names the landers and the backfill, replacing a stale owner',
  (SELECT count(*) FROM public.pipeline_registry WHERE table_name = 'vehicle_events' AND column_name = 'source_listing_id') = 1
  AND EXISTS (SELECT 1 FROM public.pipeline_registry WHERE table_name = 'vehicle_events' AND column_name = 'source_listing_id'
              AND owned_by LIKE 'listing landers%' AND description <> 'stale registration'
              AND write_via LIKE '%key_vehicle_event_listing_ids(p_batch, p_from_block)%'));
SELECT pg_temp.ok('column comment keeps the live text and names the backfill once',
  col_description('public.vehicle_events'::regclass,
    (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.vehicle_events'::regclass AND attname = 'source_listing_id'))
  LIKE 'Listing identity on the platform: a numeric BaT lot id%key_vehicle_event_listing_ids()%'
  AND (SELECT count(*) FROM regexp_matches(col_description('public.vehicle_events'::regclass,
    (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.vehicle_events'::regclass AND attname = 'source_listing_id')),
    'key_vehicle_event_listing_ids', 'g')) = 1);
SELECT pg_temp.ok('backfill is callable by service_role only',
  NOT has_function_privilege('anon', 'public.key_vehicle_event_listing_ids(integer, bigint)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.key_vehicle_event_listing_ids(integer, bigint)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.key_vehicle_event_listing_ids(integer, bigint)', 'EXECUTE'));
SELECT pg_temp.ok('function runs with a fixed search_path and its own lock_timeout',
  (SELECT proconfig @> ARRAY['search_path=public, pg_temp', 'lock_timeout=5s']
   FROM pg_proc WHERE oid = 'public.key_vehicle_event_listing_ids(integer, bigint)'::regprocedure));
SELECT pg_temp.ok('no function-level SET names a custom parameter (prod''s deploy role may not set one)',
  NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proconfig) c
              WHERE p.oid = 'public.key_vehicle_event_listing_ids(integer, bigint)'::regprocedure
                AND split_part(c, '=', 1) LIKE '%.%'));
SELECT pg_temp.ok('the clock-lock guard fires only on UPDATE OF sold_at, ended_at, metadata (a key-only UPDATE is outside it)',
  (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_trigger t
     JOIN pg_attribute a ON a.attrelid = t.tgrelid AND a.attnum = ANY (t.tgattr::int2[])
   WHERE t.tgrelid = 'public.vehicle_events'::regclass AND t.tgname = 'trg_guard_vehicle_event_clock_locks')
  = ARRAY['ended_at', 'metadata', 'sold_at']);

-- Guards ---------------------------------------------------------------------------------------------------------
SET statement_timeout = 0;
DO $$ BEGIN
  PERFORM public.key_vehicle_event_listing_ids(500, 0);
  RAISE EXCEPTION 'unbounded call was accepted';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%caller must set statement_timeout%' THEN RAISE; END IF;
END $$;
SET statement_timeout = '61s';
DO $$ BEGIN
  PERFORM public.key_vehicle_event_listing_ids(500, 0);
  RAISE EXCEPTION 'a statement_timeout above 60 s was accepted';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%caller must set statement_timeout%' THEN RAISE; END IF;
END $$;
SET statement_timeout = '30s';
DO $$ BEGIN
  PERFORM public.key_vehicle_event_listing_ids(0, 0);
  RAISE EXCEPTION 'p_batch 0 was accepted';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%p_batch must be%' THEN RAISE; END IF;
END $$;
DO $$ BEGIN
  PERFORM public.key_vehicle_event_listing_ids(500, -1);
  RAISE EXCEPTION 'a negative start block was accepted';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%p_from_block must be%' THEN RAISE; END IF;
END $$;
SELECT pg_temp.ok('refused calls changed nothing',
  NOT EXISTS (SELECT 1 FROM public.vehicle_events e JOIN events_before b USING (id)
              WHERE e.source_listing_id IS DISTINCT FROM b.source_listing_id));
SELECT pg_temp.ok('start blocks at or past the end, and past the tid range, return done without error',
  (SELECT bool_and((r->>'done')::boolean AND (r->>'keyed')::int = 0 AND (r->>'blocks_scanned')::int = 0)
   FROM (SELECT public.key_vehicle_event_listing_ids(200, b) r
         FROM unnest(ARRAY[pg_relation_size('public.vehicle_events') / current_setting('block_size')::bigint,
                           1000000, 4294967294, 4294967295, 5000000000]) b) s));

-- Walk the whole heap, one block per call -------------------------------------------------------------------------
SELECT pg_temp.ok('the two straddling rows sit in different heap blocks before the walk',
  (SELECT count(DISTINCT blk) FROM straddle_blocks) = 2 AND (SELECT min(blk) FROM straddle_blocks) = 0);
SET app.writer = 'caller-writer';
CREATE TEMP TABLE walk(run text, step int, result jsonb, writer_after text);
DO $$
DECLARE r jsonb; b bigint := 0; i int := 0;
BEGIN
  LOOP
    r := public.key_vehicle_event_listing_ids(1, b);
    i := i + 1;
    INSERT INTO walk VALUES ('first', i, r, current_setting('app.writer', true));
    EXIT WHEN (r->>'done')::boolean OR i > 100000;
    b := (r->>'next_block')::bigint;
  END LOOP;
END $$;
SELECT pg_temp.ok('cursor: starts at block 0; each call starts where the last ended; one block per call; one done',
  (SELECT (result->>'from_block')::bigint FROM walk WHERE run = 'first' AND step = 1) = 0
  AND NOT EXISTS (SELECT 1 FROM walk w JOIN walk p ON p.run = w.run AND p.step = w.step - 1
                  WHERE w.run = 'first' AND (w.result->>'from_block')::bigint <> (p.result->>'next_block')::bigint)
  AND NOT EXISTS (SELECT 1 FROM walk WHERE run = 'first'
                  AND (result->>'next_block')::bigint - (result->>'from_block')::bigint <> 1)
  AND (SELECT count(*) FROM walk WHERE run = 'first' AND (result->>'done')::boolean) = 1
  AND (SELECT count(*) FROM walk WHERE run = 'first') >= (SELECT max(blk) FROM straddle_blocks) + 1);
SELECT pg_temp.ok('triggers on the walk''s UPDATE statements see the declared writer key-vehicle-event-listing-ids',
  (SELECT count(*) FROM public.probe_update_writers) = (SELECT count(*) FROM walk WHERE run = 'first')
  AND NOT EXISTS (SELECT 1 FROM public.probe_update_writers WHERE writer IS DISTINCT FROM 'key-vehicle-event-listing-ids'));
SELECT pg_temp.ok('the caller''s app.writer is restored after every call',
  NOT EXISTS (SELECT 1 FROM walk WHERE writer_after IS DISTINCT FROM 'caller-writer')
  AND current_setting('app.writer') = 'caller-writer'
  AND current_setting('lock_timeout') = '3s');
RESET app.writer;

SELECT pg_temp.ok('keyed: www, no www with a trailing slash, RM lot, upper case with query and fragment, both straddling rows',
  (SELECT source_listing_id FROM public.vehicle_events WHERE source_url = 'https://www.goodingco.com/lot/a') = 'goodingco.com/lot/a'
  AND (SELECT source_listing_id FROM public.vehicle_events WHERE source_url = 'https://goodingco.com/lot/b/') = 'goodingco.com/lot/b'
  AND (SELECT source_listing_id FROM public.vehicle_events WHERE source_url = 'https://rmsothebys.com/auctions/az24/lots/r0001-x/')
      = 'rmsothebys.com/auctions/az24/lots/r0001-x'
  AND (SELECT source_listing_id FROM public.vehicle_events WHERE source_url LIKE '  HTTPS://WWW.GoodingCo.com/lot/K/%') = 'goodingco.com/lot/k'
  AND (SELECT source_listing_id FROM public.vehicle_events WHERE source_url = 'https://rmsothebys.com/auctions/pa25/lots/r0099-last')
      = 'rmsothebys.com/auctions/pa25/lots/r0099-last');
SELECT pg_temp.ok('one lot on two vehicles: both keyed (the index is per vehicle)',
  (SELECT count(*) FROM public.vehicle_events WHERE source_listing_id = 'rmsothebys.com/auctions/mo24/lots/r0002-y') = 2);
SELECT pg_temp.ok('the key is the canonical function of the URL on every keyed row',
  NOT EXISTS (SELECT 1 FROM public.vehicle_events e JOIN events_before b USING (id)
              WHERE b.source_listing_id IS NULL AND e.source_listing_id IS NOT NULL
                AND e.source_listing_id <> public.normalize_listing_url_key(e.source_url)));
SELECT pg_temp.ok('left NULL: pseudo-URLs, another site''s page, a NULL URL, a keyed twin, two unkeyed twins',
  (SELECT bool_and(source_listing_id IS NULL) FROM public.vehicle_events
   WHERE source_url LIKE 'conceptcarz://%' OR source_url = 'https://bringatrailer.com/listing/1967-ford-mustang-12'
      OR (source_url IS NULL AND source_platform = 'gooding') OR source_url = 'https://goodingco.com/lot/f/'
      OR source_url IN ('https://www.goodingco.com/lot/g', 'https://goodingco.com/lot/g'))
  AND (SELECT count(*) FROM public.vehicle_events
       WHERE source_url LIKE 'conceptcarz://%' OR source_url = 'https://bringatrailer.com/listing/1967-ford-mustang-12'
          OR (source_url IS NULL AND source_platform = 'gooding') OR source_url = 'https://goodingco.com/lot/f/'
          OR source_url IN ('https://www.goodingco.com/lot/g', 'https://goodingco.com/lot/g')) = 7);
SELECT pg_temp.ok('counts per reason: 9 keyed, 2 not_a_web_url, 1 other_host, 1 no_url, 1 keyed_twin, 2 unkeyed_twin',
  (SELECT sum((result->>'keyed')::int) FROM walk WHERE run = 'first') = 9
  AND (SELECT sum((result->>'left_not_a_web_url')::int) FROM walk WHERE run = 'first') = 2
  AND (SELECT sum((result->>'left_other_host')::int) FROM walk WHERE run = 'first') = 1
  AND (SELECT sum((result->>'left_no_url')::int) FROM walk WHERE run = 'first') = 1
  AND (SELECT sum((result->>'left_keyed_twin')::int) FROM walk WHERE run = 'first') = 1
  AND (SELECT sum((result->>'left_unkeyed_twin')::int) FROM walk WHERE run = 'first') = 2);
SELECT pg_temp.ok('other platforms and keys already set are untouched',
  NOT EXISTS (SELECT 1 FROM public.vehicle_events e JOIN events_before b USING (id)
              WHERE (b.source_platform NOT IN ('gooding', 'rm-sothebys') OR b.source_listing_id IS NOT NULL)
                AND e.source_listing_id IS DISTINCT FROM b.source_listing_id)
  AND (SELECT source_listing_id FROM public.vehicle_events WHERE source_url = 'https://www.goodingco.com/lot/o') = 'LOT-117'
  AND (SELECT source_listing_id IS NULL FROM public.vehicle_events WHERE source_platform = 'rmsothebys'));
SELECT pg_temp.ok('a locked row is keyed with its clocks, metadata and updated_at untouched; no clock_lock_hits',
  (SELECT e.source_listing_id = 'goodingco.com/lot/j'
          AND e.sold_at IS NULL AND e.ended_at IS NULL
          AND e.metadata = b.metadata AND NOT (e.metadata ? 'clock_lock_hits')
          AND e.updated_at = b.updated_at
   FROM public.vehicle_events e JOIN events_before b USING (id) WHERE e.source_url = 'https://www.goodingco.com/lot/j'));
SELECT pg_temp.ok('no keyed row was reached by an UPDATE naming sold_at, ended_at or metadata (the #703 guard''s columns)',
  NOT EXISTS (SELECT 1 FROM public.probe_clock_column_updates));
SELECT pg_temp.ok('a row with a live projection is keyed and its live_stream untouched',
  (SELECT e.source_listing_id = 'goodingco.com/lot/m' AND e.metadata = b.metadata
   FROM public.vehicle_events e JOIN events_before b USING (id) WHERE e.source_url = 'https://www.goodingco.com/lot/m'));
SELECT pg_temp.ok('only source_listing_id changes, on every row',
  (SELECT count(*) FROM public.vehicle_events) = (SELECT count(*) FROM events_before)
  AND NOT EXISTS (
    SELECT 1 FROM public.vehicle_events e JOIN events_before b USING (id)
    WHERE (to_jsonb(e) - 'source_listing_id') IS DISTINCT FROM (to_jsonb(b) - 'source_listing_id')));
SELECT pg_temp.ok('receipts: declared UPDATE rows that sum to the rows keyed',
  (SELECT sum(rows) FROM public.write_receipts WHERE tbl = 'vehicle_events' AND op = 'UPDATE'
     AND writer = 'key-vehicle-event-listing-ids') = 9
  AND (SELECT count(*) FROM public.write_receipts)
      = (SELECT count(*) FROM walk WHERE run = 'first' AND (result->>'keyed')::int > 0));

-- The lander's read by key now finds the episode, and a second episode for the lot is refused by the index.
SELECT pg_temp.ok('a lander read by (vehicle, platform, normalized URL) finds the keyed row',
  (SELECT count(*) FROM public.vehicle_events e JOIN v ON v.id = e.vehicle_id AND v.name = 'va'
   WHERE e.source_platform = 'gooding' AND e.source_listing_id = public.normalize_listing_url_key('https://www.goodingco.com/lot/a/')) = 1);
DO $$ BEGIN
  INSERT INTO public.vehicle_events (vehicle_id, source_platform, source_url, source_listing_id)
  SELECT id, 'gooding', 'https://www.goodingco.com/lot/a', 'goodingco.com/lot/a' FROM v WHERE name = 'va';
  RAISE EXCEPTION 'a second episode for a keyed lot was accepted';
EXCEPTION WHEN unique_violation THEN NULL;
END $$;
SELECT pg_temp.ok('a second episode for a keyed lot is refused by idx_vehicle_events_dedup', true);

-- Idempotent: a second walk with multi-block batches keys nothing and writes no receipt.
DO $$
DECLARE r jsonb; b bigint := 0; i int := 0;
BEGIN
  LOOP
    r := public.key_vehicle_event_listing_ids(400, b);
    i := i + 1;
    INSERT INTO walk VALUES ('again', i, r, NULL);
    EXIT WHEN (r->>'done')::boolean OR i > 1000;
    b := (r->>'next_block')::bigint;
  END LOOP;
END $$;
SELECT pg_temp.ok('second walk keys 0 rows, counts the same holds, writes no receipt',
  (SELECT sum((result->>'keyed')::int) FROM walk WHERE run = 'again') = 0
  AND (SELECT sum((result->>'left_not_a_web_url')::int + (result->>'left_other_host')::int + (result->>'left_no_url')::int
                  + (result->>'left_keyed_twin')::int + (result->>'left_unkeyed_twin')::int) FROM walk WHERE run = 'again') = 7
  AND (SELECT sum(rows) FROM public.write_receipts WHERE writer = 'key-vehicle-event-listing-ids') = 9);

-- Re-applying the migration changes nothing (registry and comment are written once).
\ir ../migrations/20261007031500_key_vehicle_event_listing_ids_v2.sql
SELECT pg_temp.ok('re-apply: one registry row, the backfill named once in the column comment',
  (SELECT count(*) FROM public.pipeline_registry WHERE table_name = 'vehicle_events' AND column_name = 'source_listing_id') = 1
  AND (SELECT count(*) FROM regexp_matches(col_description('public.vehicle_events'::regclass,
    (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.vehicle_events'::regclass AND attname = 'source_listing_id')),
    'key_vehicle_event_listing_ids', 'g')) = 1);

-- Positive control for the probe: an UPDATE that names metadata reaches it.
UPDATE public.vehicle_events SET metadata = metadata WHERE source_url = 'https://www.goodingco.com/lot/a';
SELECT pg_temp.ok('positive control: the probe records an UPDATE that names metadata',
  (SELECT count(*) FROM public.probe_clock_column_updates) = 1);

DO $$ BEGIN RAISE NOTICE 'ALL PASS test_vehicle_event_listing_ids'; END $$;
