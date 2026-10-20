-- Isolated PostgreSQL 17 contract for 20261020320000_correct_vehicle_event_attribution.sql.
-- Synthetic rows only; never production. Run in an empty disposable dm_refinement_* database:
--   createdb dm_refinement_correct_vehicle_event_attribution_ci
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_correct_vehicle_event_attribution_ci -f supabase/sql/test_correct_vehicle_event_attribution.sql
-- Contract:
--   * a lot wrongly stamped with a dealer is corrected (organization cleared, the lot's own seller identity set) in
--     place, with the before-image on the row (metadata.attribution_corrections[]), and every other column untouched;
--   * a stale expected value writes nothing; a non-BaT row is refused; a missing row is reported; one bad row in a
--     batch does not stop the others;
--   * a second identical call is a noop and adds no audit entry (idempotent);
--   * metadata is merged, never replaced: no key is ever dropped; a key that already holds a different non-null
--     value is stale (restore default) or overwritten with the original kept (restore=false); a null merge value and
--     the writer's bookkeeping keys are rejected;
--   * uncited rows, short reasons, unsupported fields, 201 rows and a caller statement_timeout outside 1 ms..60 s
--     raise before anything is written; a missing organization or identity is refused;
--   * it passes the two live vehicle_events triggers (clock-lock guard, live-stream projection guard): lock keys and
--     live_stream survive, sold_at/ended_at are untouched;
--   * app.writer is restored; EXECUTE is service_role only (anon, authenticated and PUBLIC cannot call it);
--   * re-applying the migration is a no-op.
-- Fixtures carry the live columns of vehicle_events (read from the prod catalog 2026-10-20), the live FK to
-- organizations, and the two live BEFORE UPDATE triggers, verbatim.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR to_regclass('public.vehicle_events') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '30s';
SET lock_timeout = '3s';
SET TimeZone = 'UTC';

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;
-- Run a statement that must raise; return its message ('' if it did not raise).
CREATE FUNCTION pg_temp.raised(stmt text) RETURNS text LANGUAGE plpgsql AS $$ BEGIN
  EXECUTE stmt; RETURN '';
EXCEPTION WHEN OTHERS THEN RETURN SQLERRM;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

CREATE TABLE public.organizations (id uuid PRIMARY KEY);
CREATE TABLE public.external_identities (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), platform text, handle text);
CREATE TABLE public.vehicle_observations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid,
  extraction_method text);
CREATE TABLE public.pipeline_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_name text NOT NULL, column_name text,
  owned_by text NOT NULL, description text NOT NULL, valid_values text[],
  do_not_write_directly boolean NOT NULL DEFAULT false, write_via text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (table_name, column_name));
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

-- The two live BEFORE UPDATE triggers of vehicle_events, verbatim from prod (pg_get_functiondef, 2026-10-20).
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

CREATE OR REPLACE FUNCTION public.guard_vehicle_event_clock_locks()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_old_meta jsonb := coalesce(OLD.metadata, '{}'::jsonb);
  v_new_meta jsonb := coalesce(NEW.metadata, '{}'::jsonb);
  v_lock     jsonb := v_old_meta -> 'clock_locked_by_supersession';
  v_fields   text[] := '{}';
  v_blocked  text[] := '{}';
  v_hits     jsonb;
  v_key      text;
BEGIN
  FOREACH v_key IN ARRAY ARRAY['episode_supersessions', 'clock_locked_by_supersession', 'clock_lock_hits'] LOOP
    IF (v_old_meta ? v_key) AND NOT (v_new_meta ? v_key) THEN
      v_new_meta := v_new_meta || jsonb_build_object(v_key, v_old_meta -> v_key);
    END IF;
  END LOOP;
  IF v_lock IS NOT NULL THEN
    IF jsonb_typeof(v_lock -> 'fields') = 'array' THEN
      SELECT coalesce(array_agg(f), '{}') INTO v_fields FROM jsonb_array_elements_text(v_lock -> 'fields') AS t(f);
    END IF;
    IF 'sold_at' = ANY (v_fields) AND NEW.sold_at IS DISTINCT FROM OLD.sold_at THEN
      NEW.sold_at := OLD.sold_at;
      v_blocked := array_append(v_blocked, 'sold_at');
    END IF;
    IF 'ended_at' = ANY (v_fields) AND NEW.ended_at IS DISTINCT FROM OLD.ended_at THEN
      NEW.ended_at := OLD.ended_at;
      v_blocked := array_append(v_blocked, 'ended_at');
    END IF;
    IF 'source_url' = ANY (v_fields) AND NEW.source_url IS DISTINCT FROM OLD.source_url THEN
      NEW.source_url := OLD.source_url;
      v_blocked := array_append(v_blocked, 'source_url');
    END IF;
    IF 'source_platform' = ANY (v_fields) AND NEW.source_platform IS DISTINCT FROM OLD.source_platform THEN
      NEW.source_platform := OLD.source_platform;
      v_blocked := array_append(v_blocked, 'source_platform');
    END IF;
    IF 'event_status' = ANY (v_fields) AND NEW.event_status IS DISTINCT FROM OLD.event_status THEN
      NEW.event_status := OLD.event_status;
      v_blocked := array_append(v_blocked, 'event_status');
    END IF;
    IF cardinality(v_blocked) > 0 THEN
      v_hits := CASE WHEN jsonb_typeof(v_new_meta -> 'clock_lock_hits') = 'array'
                     THEN v_new_meta -> 'clock_lock_hits' ELSE '[]'::jsonb END;
      v_new_meta := v_new_meta || jsonb_build_object('clock_lock_hits', v_hits || jsonb_build_object(
        'at', now(), 'fields', to_jsonb(v_blocked),
        'app_writer', nullif(current_setting('app.writer', true), ''), 'db_role', current_user::text));
    END IF;
  END IF;
  NEW.metadata := v_new_meta;
  RETURN NEW;
END
$function$;
CREATE TRIGGER trg_guard_vehicle_event_clock_locks BEFORE UPDATE OF sold_at, ended_at, metadata ON public.vehicle_events
  FOR EACH ROW WHEN ((old.metadata ? 'clock_locked_by_supersession'::text) OR (old.metadata ? 'episode_supersessions'::text))
  EXECUTE FUNCTION public.guard_vehicle_event_clock_locks();

\ir ../migrations/20261020320000_correct_vehicle_event_attribution.sql
-- Re-applying the migration is a no-op.
\ir ../migrations/20261020320000_correct_vehicle_event_attribution.sql
SELECT pg_temp.ok('migration applies twice, one pipeline_registry row per column',
  (SELECT count(*) FROM public.pipeline_registry WHERE table_name = 'vehicle_events'
     AND column_name IN ('source_organization_id', 'seller_external_identity_id')) = 2);

-- Fixture ----------------------------------------------------------------------------------------------------------
INSERT INTO public.organizations (id) VALUES ('00000000-0000-0000-0000-0000000000d1'), ('00000000-0000-0000-0000-0000000000d2');
INSERT INTO public.external_identities (id, platform, handle) VALUES
  ('00000000-0000-0000-0000-00000000a001', 'bat', 'synthetic_dealer'),
  ('00000000-0000-0000-0000-00000000a002', 'bat', 'synthetic_private_seller');
-- vehicle V1 has two BaT lots: the dealer's own (E_OWN) and a resale by a private seller (E_RESALE) that the old
-- extractor wrongly stamped with the dealer. A third, non-BaT, row (E_CC) and a locked/live row (E_LOCK).
INSERT INTO public.vehicle_events (id, vehicle_id, source_organization_id, seller_external_identity_id, source_platform,
  source_url, event_status, sold_at, ended_at, final_price, metadata) VALUES
 ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000000f1',
  '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000a001', 'bat',
  'https://example.test/listing/lot-own/', 'sold', '2024-05-01T18:00:00Z', '2024-05-01T18:00:00Z', 10000,
  '{"source":"extract-bat-core","seller_username":"synthetic_dealer","lot_number":"111","images":["a","b"]}'),
 ('00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-0000000000f1',
  '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000a001', 'bat',
  'https://example.test/listing/lot-resale/', 'sold', '2026-02-01T18:00:00Z', '2026-02-01T18:00:00Z', 20000,
  '{"source":"extract-bat-core","seller_username":"synthetic_private_seller","lot_number":"222","images":["c"]}'),
 ('00000000-0000-0000-0000-00000000e003', '00000000-0000-0000-0000-0000000000f1',
  NULL, NULL, 'carsandbids', 'https://example.test/cc/1', 'sold', NULL, NULL, 5, '{"k":"v"}'),
 -- metadata replaced by the old classification write: only ownership_classification survives
 ('00000000-0000-0000-0000-00000000e004', '00000000-0000-0000-0000-0000000000f2',
  '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000a001', 'bat',
  'https://example.test/listing/lot-overwritten/', 'sold', '2025-01-01T18:00:00Z', '2025-01-01T18:00:00Z', 30000,
  '{"ownership_classification":"consigner"}'),
 -- a superseded episode with locked clocks, and a live-stream projection
 ('00000000-0000-0000-0000-00000000e005', '00000000-0000-0000-0000-0000000000f3',
  '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000a001', 'bat',
  'https://example.test/listing/lot-locked/', 'sold', '2025-03-01T18:00:00Z', '2025-03-01T18:00:00Z', 1,
  '{"seller_username":"synthetic_private_seller","episode_supersessions":[{"id":"x"}],"clock_locked_by_supersession":{"fields":["sold_at","ended_at"]},"live_stream":{"received_at":"2026-10-01T00:00:00Z"}}');

CREATE TEMP TABLE before_img AS SELECT * FROM public.vehicle_events;

-- 1. The wrongly stamped resale is corrected in place -------------------------------------------------------------
SELECT public.correct_vehicle_event_attribution(jsonb_build_array(jsonb_build_object(
  'event_id', '00000000-0000-0000-0000-00000000e002',
  'source', jsonb_build_object('type', 'auction_events', 'ref', 'synthetic lot row, repair 2026-10-20'),
  'reason', 'resale by another seller was stamped with the dealer by the per-vehicle update',
  'corrections', jsonb_build_object(
    'source_organization_id', jsonb_build_object('value', NULL, 'expected', '00000000-0000-0000-0000-0000000000d1'),
    'seller_external_identity_id', jsonb_build_object('value', '00000000-0000-0000-0000-00000000a002',
                                                       'expected', '00000000-0000-0000-0000-00000000a001')))),
  'repair-test') AS r1 \gset
SELECT pg_temp.ok('resale corrected: one row corrected', (:'r1'::jsonb ->> 'corrected')::int = 1);
SELECT pg_temp.ok('organization cleared on the resale',
  (SELECT source_organization_id IS NULL FROM public.vehicle_events WHERE id = '00000000-0000-0000-0000-00000000e002'));
SELECT pg_temp.ok('seller identity is the lot''s own',
  (SELECT seller_external_identity_id = '00000000-0000-0000-0000-00000000a002' FROM public.vehicle_events WHERE id = '00000000-0000-0000-0000-00000000e002'));
SELECT pg_temp.ok('before-image kept: original organization and identity on the row',
  (SELECT metadata -> 'attribution_corrections' -> 0 -> 'changes' -> 'source_organization_id' ->> 'original' = '00000000-0000-0000-0000-0000000000d1'
      AND metadata -> 'attribution_corrections' -> 0 -> 'changes' -> 'seller_external_identity_id' ->> 'original' = '00000000-0000-0000-0000-00000000a001'
      AND metadata -> 'attribution_corrections' -> 0 -> 'source' ->> 'ref' = 'synthetic lot row, repair 2026-10-20'
      AND metadata -> 'attribution_corrections' -> 0 ->> 'asserted_by' = 'repair-test'
      AND metadata -> 'attribution_corrections' -> 0 ->> 'writer' = 'correct_vehicle_event_attribution'
   FROM public.vehicle_events WHERE id = '00000000-0000-0000-0000-00000000e002'));
SELECT pg_temp.ok('metadata keys of the resale untouched',
  (SELECT metadata ->> 'seller_username' = 'synthetic_private_seller' AND metadata ->> 'lot_number' = '222'
      AND metadata -> 'images' = '["c"]'::jsonb FROM public.vehicle_events WHERE id = '00000000-0000-0000-0000-00000000e002'));
SELECT pg_temp.ok('no other column of the resale changed',
  (SELECT (to_jsonb(v) - 'source_organization_id' - 'seller_external_identity_id' - 'metadata' - 'updated_at')
        = (to_jsonb(b) - 'source_organization_id' - 'seller_external_identity_id' - 'metadata' - 'updated_at')
   FROM public.vehicle_events v JOIN before_img b USING (id) WHERE id = '00000000-0000-0000-0000-00000000e002'));
SELECT pg_temp.ok('the dealer''s own lot (same vehicle) is untouched',
  (SELECT to_jsonb(v) = to_jsonb(b) FROM public.vehicle_events v JOIN before_img b USING (id)
   WHERE id = '00000000-0000-0000-0000-00000000e001'));

-- 2. Idempotent: the same call again is a noop, no second audit entry ---------------------------------------------
SELECT public.correct_vehicle_event_attribution(jsonb_build_array(jsonb_build_object(
  'event_id', '00000000-0000-0000-0000-00000000e002',
  'source', jsonb_build_object('type', 'auction_events', 'ref', 'synthetic lot row, repair 2026-10-20'),
  'reason', 'resale by another seller was stamped with the dealer by the per-vehicle update',
  'corrections', jsonb_build_object(
    'source_organization_id', jsonb_build_object('value', NULL, 'expected', '00000000-0000-0000-0000-0000000000d1'),
    'seller_external_identity_id', jsonb_build_object('value', '00000000-0000-0000-0000-00000000a002',
                                                       'expected', '00000000-0000-0000-0000-00000000a001')))),
  'repair-test') AS r2 \gset
SELECT pg_temp.ok('re-run is a noop', (:'r2'::jsonb ->> 'noop')::int = 1 AND (:'r2'::jsonb ->> 'corrected')::int = 0
  AND (:'r2'::jsonb ->> 'stale') = '[]');
SELECT pg_temp.ok('re-run adds no audit entry',
  (SELECT jsonb_array_length(metadata -> 'attribution_corrections') = 1 FROM public.vehicle_events
   WHERE id = '00000000-0000-0000-0000-00000000e002'));

-- 3. Stale: the live value is not the expected one -> no write ----------------------------------------------------
SELECT public.correct_vehicle_event_attribution(jsonb_build_array(jsonb_build_object(
  'event_id', '00000000-0000-0000-0000-00000000e001',
  'source', jsonb_build_object('type', 'auction_events', 'ref', 'synthetic'),
  'reason', 'expected value deliberately wrong for the stale test',
  'corrections', jsonb_build_object(
    'source_organization_id', jsonb_build_object('value', NULL, 'expected', '00000000-0000-0000-0000-0000000000d2')))),
  'repair-test') AS r3 \gset
SELECT pg_temp.ok('stale: reported, nothing corrected', jsonb_array_length(:'r3'::jsonb -> 'stale') = 1
  AND (:'r3'::jsonb ->> 'corrected')::int = 0);
SELECT pg_temp.ok('stale: row not written',
  (SELECT to_jsonb(v) = to_jsonb(b) FROM public.vehicle_events v JOIN before_img b USING (id)
   WHERE id = '00000000-0000-0000-0000-00000000e001'));

-- 4. Non-BaT refused, missing reported, one bad row does not stop the others ---------------------------------------
SELECT public.correct_vehicle_event_attribution(jsonb_build_array(
  jsonb_build_object('event_id', '00000000-0000-0000-0000-00000000e003',
    'source', jsonb_build_object('type', 'auction_events', 'ref', 'synthetic'), 'reason', 'a non-BaT row must be refused',
    'corrections', jsonb_build_object('source_organization_id',
      jsonb_build_object('value', '00000000-0000-0000-0000-0000000000d1', 'expected', NULL))),
  jsonb_build_object('event_id', '00000000-0000-0000-0000-00000000ffff',
    'source', jsonb_build_object('type', 'auction_events', 'ref', 'synthetic'), 'reason', 'a missing row is reported',
    'corrections', jsonb_build_object('source_organization_id',
      jsonb_build_object('value', NULL, 'expected', NULL))),
  jsonb_build_object('event_id', '00000000-0000-0000-0000-00000000e004',
    'source', jsonb_build_object('type', 'auction_events', 'ref', 'synthetic'), 'reason', 'good row after two bad ones',
    'corrections', jsonb_build_object('metadata', jsonb_build_object('merge', jsonb_build_object(
      'seller_username', 'synthetic_dealer', 'lot_number', '444', 'restored_from', 'auction_events'))))),
  'repair-test') AS r4 \gset
SELECT pg_temp.ok('non-BaT row refused', jsonb_array_length(:'r4'::jsonb -> 'refused') = 1
  AND (:'r4'::jsonb -> 'refused' -> 0 ->> 'why') LIKE 'not a BaT row%');
SELECT pg_temp.ok('non-BaT row not written',
  (SELECT to_jsonb(v) = to_jsonb(b) FROM public.vehicle_events v JOIN before_img b USING (id)
   WHERE id = '00000000-0000-0000-0000-00000000e003'));
SELECT pg_temp.ok('missing row reported', jsonb_array_length(:'r4'::jsonb -> 'missing') = 1);
SELECT pg_temp.ok('the good row after them was corrected', (:'r4'::jsonb ->> 'corrected')::int = 1);

-- 5. Metadata merge never drops a key -----------------------------------------------------------------------------
SELECT pg_temp.ok('overwritten row: restored keys added, existing ownership_classification kept',
  (SELECT metadata ->> 'ownership_classification' = 'consigner' AND metadata ->> 'seller_username' = 'synthetic_dealer'
      AND metadata ->> 'lot_number' = '444' AND metadata ->> 'restored_from' = 'auction_events'
      AND metadata -> 'attribution_corrections' -> 0 -> 'changes' -> 'metadata' -> 'added_keys'
          = '["lot_number","restored_from","seller_username"]'::jsonb
   FROM public.vehicle_events WHERE id = '00000000-0000-0000-0000-00000000e004'));
SELECT pg_temp.ok('merge touched no column other than metadata and updated_at',
  (SELECT (to_jsonb(v) - 'metadata' - 'updated_at') = (to_jsonb(b) - 'metadata' - 'updated_at')
   FROM public.vehicle_events v JOIN before_img b USING (id) WHERE id = '00000000-0000-0000-0000-00000000e004'));
-- a key holding a different non-null value: stale by default, nothing written
SELECT public.correct_vehicle_event_attribution(jsonb_build_array(jsonb_build_object(
  'event_id', '00000000-0000-0000-0000-00000000e004',
  'source', jsonb_build_object('type', 'auction_events', 'ref', 'synthetic'), 'reason', 'conflicting value must not overrule',
  'corrections', jsonb_build_object('metadata', jsonb_build_object('merge', jsonb_build_object('lot_number', '999'))))),
  'repair-test') AS r5 \gset
SELECT pg_temp.ok('conflicting non-null key is stale, not overwritten',
  jsonb_array_length(:'r5'::jsonb -> 'stale') = 1 AND (:'r5'::jsonb ->> 'corrected')::int = 0
  AND (SELECT metadata ->> 'lot_number' = '444' FROM public.vehicle_events WHERE id = '00000000-0000-0000-0000-00000000e004'));
-- restore=false overwrites that key only, the old value goes to the before-image, no key is dropped
SELECT public.correct_vehicle_event_attribution(jsonb_build_array(jsonb_build_object(
  'event_id', '00000000-0000-0000-0000-00000000e004',
  'source', jsonb_build_object('type', 'auction_events', 'ref', 'synthetic'), 'reason', 'explicit overwrite with restore=false',
  'corrections', jsonb_build_object('metadata', jsonb_build_object('restore', false,
    'merge', jsonb_build_object('lot_number', '999'))))),
  'repair-test') AS r6 \gset
SELECT pg_temp.ok('restore=false overwrites the named key, keeps every other, records the original',
  (:'r6'::jsonb ->> 'corrected')::int = 1
  AND (SELECT metadata ->> 'lot_number' = '999' AND metadata ->> 'seller_username' = 'synthetic_dealer'
          AND metadata ->> 'ownership_classification' = 'consigner'
          AND metadata -> 'attribution_corrections' -> 1 -> 'changes' -> 'metadata' -> 'overwritten_originals' ->> 'lot_number' = '444'
          AND jsonb_array_length(metadata -> 'attribution_corrections') = 2
       FROM public.vehicle_events WHERE id = '00000000-0000-0000-0000-00000000e004'));
-- a key present with a null value is restored, not conflicting
UPDATE public.vehicle_events SET metadata = metadata || '{"buyer_username": null}' WHERE id = '00000000-0000-0000-0000-00000000e004';
SELECT public.correct_vehicle_event_attribution(jsonb_build_array(jsonb_build_object(
  'event_id', '00000000-0000-0000-0000-00000000e004',
  'source', jsonb_build_object('type', 'auction_events', 'ref', 'synthetic'), 'reason', 'null key restored by merge',
  'corrections', jsonb_build_object('metadata', jsonb_build_object('merge', jsonb_build_object('buyer_username', 'synthetic_buyer'))))),
  'repair-test') AS r7 \gset
SELECT pg_temp.ok('a null-valued key is restored', (:'r7'::jsonb ->> 'corrected')::int = 1
  AND (SELECT metadata ->> 'buyer_username' = 'synthetic_buyer' FROM public.vehicle_events WHERE id = '00000000-0000-0000-0000-00000000e004'));

-- 6. Both live triggers pass: lock keys and live_stream survive, clocks stay -----------------------------------------
SELECT public.correct_vehicle_event_attribution(jsonb_build_array(jsonb_build_object(
  'event_id', '00000000-0000-0000-0000-00000000e005',
  'source', jsonb_build_object('type', 'auction_events', 'ref', 'synthetic'), 'reason', 'locked and live row passes the triggers',
  'corrections', jsonb_build_object(
    'source_organization_id', jsonb_build_object('value', NULL, 'expected', '00000000-0000-0000-0000-0000000000d1'),
    'metadata', jsonb_build_object('merge', jsonb_build_object('buyer_username', 'synthetic_buyer'))))),
  'repair-test') AS r8 \gset
SELECT pg_temp.ok('locked/live row corrected through both triggers', (:'r8'::jsonb ->> 'corrected')::int = 1
  AND jsonb_array_length(:'r8'::jsonb -> 'refused') = 0);
SELECT pg_temp.ok('lock keys, live_stream and clocks survive',
  (SELECT v.metadata -> 'episode_supersessions' = b.metadata -> 'episode_supersessions'
      AND v.metadata -> 'clock_locked_by_supersession' = b.metadata -> 'clock_locked_by_supersession'
      AND v.metadata -> 'live_stream' = b.metadata -> 'live_stream'
      AND v.sold_at = b.sold_at AND v.ended_at = b.ended_at AND v.source_organization_id IS NULL
      AND NOT (v.metadata ? 'clock_lock_hits')
   FROM public.vehicle_events v JOIN before_img b USING (id) WHERE id = '00000000-0000-0000-0000-00000000e005'));

-- 7. Refusals that write nothing and raise --------------------------------------------------------------------------
CREATE TEMP TABLE snap_all AS SELECT * FROM public.vehicle_events;
SELECT pg_temp.ok('an uncited row raises',
  pg_temp.raised($q$SELECT public.correct_vehicle_event_attribution('[{"event_id":"00000000-0000-0000-0000-00000000e001","reason":"long enough reason","corrections":{"source_organization_id":{"value":null,"expected":null}}}]'::jsonb,'t')$q$) LIKE '%no cited source%');
SELECT pg_temp.ok('a short reason raises',
  pg_temp.raised($q$SELECT public.correct_vehicle_event_attribution('[{"event_id":"00000000-0000-0000-0000-00000000e001","source":{"type":"a","ref":"b"},"reason":"short","corrections":{"source_organization_id":{"value":null,"expected":null}}}]'::jsonb,'t')$q$) LIKE '%reason of 10+%');
SELECT pg_temp.ok('an unsupported field raises (sold_at is not correctable here)',
  pg_temp.raised($q$SELECT public.correct_vehicle_event_attribution('[{"event_id":"00000000-0000-0000-0000-00000000e001","source":{"type":"a","ref":"b"},"reason":"long enough reason","corrections":{"sold_at":{"value":null,"expected":null}}}]'::jsonb,'t')$q$) LIKE '%not correctable here%');
SELECT pg_temp.ok('a null merge value raises (a merge never removes a key)',
  pg_temp.raised($q$SELECT public.correct_vehicle_event_attribution('[{"event_id":"00000000-0000-0000-0000-00000000e001","source":{"type":"a","ref":"b"},"reason":"long enough reason","corrections":{"metadata":{"merge":{"seller_username":null}}}}]'::jsonb,'t')$q$) LIKE '%would remove one%');
SELECT pg_temp.ok('a bookkeeping key in the merge raises',
  pg_temp.raised($q$SELECT public.correct_vehicle_event_attribution('[{"event_id":"00000000-0000-0000-0000-00000000e001","source":{"type":"a","ref":"b"},"reason":"long enough reason","corrections":{"metadata":{"merge":{"clock_locked_by_supersession":{}}}}}]'::jsonb,'t')$q$) LIKE '%bookkeeping key%');
SELECT pg_temp.ok('a missing expected raises',
  pg_temp.raised($q$SELECT public.correct_vehicle_event_attribution('[{"event_id":"00000000-0000-0000-0000-00000000e001","source":{"type":"a","ref":"b"},"reason":"long enough reason","corrections":{"source_organization_id":{"value":null}}}]'::jsonb,'t')$q$) LIKE '%needs {value, expected}%');
SELECT pg_temp.ok('an empty asserted_by raises',
  pg_temp.raised($q$SELECT public.correct_vehicle_event_attribution('[]'::jsonb,' ')$q$) LIKE '%asserted_by is required%');
SELECT pg_temp.ok('201 rows raise (cap is 200)',
  pg_temp.raised($q$SELECT public.correct_vehicle_event_attribution((SELECT jsonb_agg('{}'::jsonb) FROM generate_series(1,201)),'t')$q$) LIKE '%at most 200 rows%');
SELECT pg_temp.ok('200 rows pass the cap (and then fail on their content, not on the cap)',
  pg_temp.raised($q$SELECT public.correct_vehicle_event_attribution((SELECT jsonb_agg('{}'::jsonb) FROM generate_series(1,200)),'t')$q$) LIKE '%each row needs a uuid event_id%');
SELECT pg_temp.ok('a caller statement_timeout outside 1 ms..60 s raises',
  pg_temp.raised($q$SET LOCAL statement_timeout = 0; SELECT public.correct_vehicle_event_attribution('[]'::jsonb,'t')$q$) LIKE '%statement_timeout between 1 ms and 60 s%');
SELECT pg_temp.ok('the raising calls wrote nothing',
  NOT EXISTS (SELECT 1 FROM public.vehicle_events v JOIN snap_all s USING (id) WHERE to_jsonb(v) <> to_jsonb(s)));
-- a missing organization / identity is refused per row, not raised
SELECT public.correct_vehicle_event_attribution(jsonb_build_array(
  jsonb_build_object('event_id', '00000000-0000-0000-0000-00000000e001',
    'source', jsonb_build_object('type', 'a', 'ref', 'b'), 'reason', 'organization that does not exist',
    'corrections', jsonb_build_object('source_organization_id',
      jsonb_build_object('value', '00000000-0000-0000-0000-0000000000ee', 'expected', '00000000-0000-0000-0000-0000000000d1'))),
  jsonb_build_object('event_id', '00000000-0000-0000-0000-00000000e001',
    'source', jsonb_build_object('type', 'a', 'ref', 'b'), 'reason', 'identity that does not exist',
    'corrections', jsonb_build_object('seller_external_identity_id',
      jsonb_build_object('value', '00000000-0000-0000-0000-00000000aeee', 'expected', '00000000-0000-0000-0000-00000000a001')))),
  't') AS r9 \gset
SELECT pg_temp.ok('a non-existent organization and identity are refused, row untouched',
  jsonb_array_length(:'r9'::jsonb -> 'refused') = 2
  AND (SELECT to_jsonb(v) = to_jsonb(b) FROM public.vehicle_events v JOIN before_img b USING (id)
       WHERE id = '00000000-0000-0000-0000-00000000e001'));

-- 8. app.writer restored; grants ------------------------------------------------------------------------------------
SET app.writer = 'caller-writer';
SELECT public.correct_vehicle_event_attribution('[]'::jsonb, 't') IS NOT NULL AS ran \gset
SELECT pg_temp.ok('app.writer is restored to the caller''s value', current_setting('app.writer') = 'caller-writer');
RESET app.writer;
SELECT pg_temp.ok('EXECUTE: service_role only',
  has_function_privilege('service_role', 'public.correct_vehicle_event_attribution(jsonb,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.correct_vehicle_event_attribution(jsonb,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.correct_vehicle_event_attribution(jsonb,text)', 'EXECUTE')
  AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  WHERE p.oid = 'public.correct_vehicle_event_attribution(jsonb,text)'::regprocedure AND a.grantee = 0));
SET ROLE anon;
SELECT pg_temp.ok('anon calling it is denied',
  pg_temp.raised($q$SELECT public.correct_vehicle_event_attribution('[]'::jsonb,'t')$q$) LIKE 'permission denied%');
RESET ROLE;
SET ROLE authenticated;
SELECT pg_temp.ok('authenticated calling it is denied',
  pg_temp.raised($q$SELECT public.correct_vehicle_event_attribution('[]'::jsonb,'t')$q$) LIKE 'permission denied%');
RESET ROLE;
SELECT pg_temp.ok('SECURITY DEFINER with a pinned search_path',
  (SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp'] FROM pg_proc
   WHERE oid = 'public.correct_vehicle_event_attribution(jsonb,text)'::regprocedure));
SELECT 'ALL PASS' AS result;
