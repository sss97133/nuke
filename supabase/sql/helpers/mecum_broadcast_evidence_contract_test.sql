-- PG17 attack harness for the staged C15 migration. LOCAL THROWAWAY DATABASE ONLY.
-- Run: psql -v ON_ERROR_STOP=1 -d mecum_broadcast_contract_test -f this_file.sql
-- This file intentionally refuses Nuke's production database named postgres.
\set ON_ERROR_STOP on
SELECT current_database() = 'mecum_broadcast_contract_test' AND
  current_setting('server_version_num')::integer >= 170000 AS allowed \gset
\if :allowed
\else
  \echo 'Refused: require throwaway mecum_broadcast_contract_test on PG17+'
  \quit 1
\endif

-- Live-shape stubs for the columns touched by this patch, no production data.
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('test.auth_role',true) $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULLIF(current_setting('test.auth_uid',true),'')::uuid $$;
CREATE FUNCTION public.user_can_edit_vehicle(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE TABLE public.vehicles(id uuid PRIMARY KEY,vin text,deleted_at timestamptz,status text,created_at timestamptz DEFAULT now());
CREATE INDEX idx_vehicles_vin_norm_trim ON public.vehicles(upper(btrim(vin)));
CREATE TABLE public.publications(id uuid PRIMARY KEY,platform text,platform_id text);
CREATE TABLE public.auction_events(id uuid PRIMARY KEY,vehicle_id uuid REFERENCES vehicles(id),source_listing_id text,raw_data jsonb,source_url text);
-- Production has NO observation vehicle FK. Seed an old orphan before the repair so
-- the harness verifies NOT VALID preserves historical testimony while enforcing new links.
CREATE TABLE public.vehicle_observations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vehicle_id uuid,
  structured_data jsonb NOT NULL DEFAULT '{}',observed_at timestamptz NOT NULL DEFAULT now(),ingested_at timestamptz DEFAULT now(),
  source_id uuid,source_identifier text,kind text,content_hash text,raw_source_ref text,extraction_metadata jsonb,
  confidence_score numeric,citation_excerpt text,merged_from_vehicle_id uuid,subject_type text DEFAULT 'vehicle',subject_id uuid,
  UNIQUE(source_id,source_identifier,kind,content_hash));
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY,vehicle_id uuid REFERENCES vehicles(id),is_primary boolean,file_hash text,
  is_document boolean,is_duplicate boolean,merged_from_vehicle_id uuid,updated_at timestamptz);
CREATE TABLE public.pipeline_registry(table_name text,column_name text,owned_by text,description text,do_not_write_directly boolean,write_via text);
CREATE TABLE public.reattribution_audit(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),observation_type text,
  old_observation_id uuid,old_vehicle_id uuid,new_observation_id uuid,new_vehicle_id uuid,reason text,actor_user_id uuid,created_at timestamptz DEFAULT now());
INSERT INTO public.vehicle_observations(id,vehicle_id,content_hash)
VALUES('00000000-0000-0000-0000-000000000098','00000000-0000-0000-0000-000000000097','historical-orphan-source');

\ir ../../migrations/20261002050326_mecum_broadcast_evidence_links.sql

-- Fixture IDs are synthetic local test identities, never claims about production entities.
INSERT INTO vehicles(id,vin,status) VALUES
  ('00000000-0000-0000-0000-000000000001','194677S101228','active'),
  ('00000000-0000-0000-0000-000000000002','CS140S151950','active');
INSERT INTO publications VALUES ('00000000-0000-0000-0000-000000000010','youtube','c9fxArnD3IY');
INSERT INTO auction_events(id,vehicle_id,source_listing_id,raw_data) VALUES
  ('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001','1159827','{"auction_id":"FL26"}'),
  ('00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000002','1139323','{"auction_id":"AZ25"}');

CREATE FUNCTION pg_temp.rejects(statement text,expected_state text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE failed boolean := false;
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> expected_state THEN RAISE EXCEPTION 'wrong rejection %, expected %: %',SQLSTATE,expected_state,SQLERRM; END IF;
    failed := true;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'attack accepted: %',statement; END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM vehicle_observations WHERE id='00000000-0000-0000-0000-000000000098'
      AND vehicle_id='00000000-0000-0000-0000-000000000097' AND content_hash='historical-orphan-source') THEN
    RAISE EXCEPTION 'NOT VALID repair rewrote historical testimony';
  END IF;
  IF (SELECT convalidated FROM pg_constraint WHERE conrelid='public.vehicle_observations'::regclass
      AND conname='vehicle_observations_vehicle_id_fkey') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'vehicle FK unexpectedly scanned/validated historical rows';
  END IF;
END $$;
INSERT INTO vehicle_observations(id,vehicle_id,content_hash)
VALUES('00000000-0000-0000-0000-000000000096',NULL,'unbound-source');
SELECT pg_temp.rejects($a$INSERT INTO vehicle_observations(vehicle_id)
  VALUES('00000000-0000-0000-0000-000000000097')$a$,'23503');
SELECT pg_temp.rejects($a$UPDATE vehicle_observations SET vehicle_id='00000000-0000-0000-0000-000000000097'
  WHERE id='00000000-0000-0000-0000-000000000096'$a$,'23503');
INSERT INTO vehicles(id,vin,status) VALUES('00000000-0000-0000-0000-000000000004','FK-fixture-only','active');
INSERT INTO vehicle_observations(id,vehicle_id,content_hash)
VALUES('00000000-0000-0000-0000-000000000095','00000000-0000-0000-0000-000000000004','bound-source');
SELECT pg_temp.rejects($a$DELETE FROM vehicles WHERE id='00000000-0000-0000-0000-000000000004'$a$,'23503');

SELECT pg_temp.rejects($a$INSERT INTO vehicle_observations(media_end_ms) VALUES(2546000)$a$,'23514');
SELECT pg_temp.rejects($a$INSERT INTO vehicle_observations(media_start_ms,media_end_ms,media_relation,media_span_semantics)
  VALUES(2532000,2541000,'vehicle_visible','caption_cue')$a$,'23514');
SELECT pg_temp.rejects($a$INSERT INTO vehicle_observations(media_start_ms,media_end_ms,media_relation,media_span_semantics)
  VALUES(2546000,2600000,'vehicle_visible','point_sample')$a$,'23514');
SELECT pg_temp.rejects($a$INSERT INTO vehicle_observations(media_start_ms,media_relation,media_span_semantics)
  VALUES(2546000,'vehicle_visible','measured_presence_interval')$a$,'23514');
SELECT pg_temp.rejects($a$INSERT INTO vehicle_observations(observed_at_basis,source_event_time_precision)
  VALUES('event_time','exact')$a$,'23514');
SELECT pg_temp.rejects($a$INSERT INTO vehicle_observations(observed_at_basis,source_event_time_precision,source_event_date,source_event_at)
  VALUES('source_capture_time','day','2026-01-17','2026-01-17T00:00:00Z')$a$,'23514');
SELECT pg_temp.rejects($a$INSERT INTO vehicle_observations(citation_publication_id,media_start_ms,media_relation,media_span_semantics,structured_data)
  VALUES('00000000-0000-0000-0000-000000000010',2546000,'screen_display','point_sample','{"media":{"video_id":"wrong-video"}}')$a$,'23514');
SELECT pg_temp.rejects($a$INSERT INTO vehicle_observations(auction_event_id,structured_data)
  VALUES('00000000-0000-0000-0000-000000000021','{"event_context":{"source_listing_id":"1159827","auction_source_key":"mecum:FL26"}}')$a$,'23514');
SELECT pg_temp.rejects($a$INSERT INTO vehicle_observations(vehicle_id,auction_event_id,structured_data)
  VALUES('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000020',
    '{"event_context":{"source_listing_id":"1159827","auction_source_key":"mecum:FL26"}}')$a$,'23514');

INSERT INTO vehicle_observations(id,citation_publication_id,auction_event_id,media_start_ms,media_end_ms,media_relation,media_span_semantics,
  observed_at_basis,source_event_date,source_event_time_precision,source_available_at,structured_data,
  source_id,source_identifier,kind,content_hash,raw_source_ref,extraction_metadata,confidence_score,citation_excerpt)
VALUES('00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000020',2532000,2541000,'vehicle_discussed','caption_cue',
  'source_capture_time','2026-01-17','day','2026-01-24T15:00:06Z',
  '{"property":"high_bid_announced","value":140000,"claim_role":"high_bid_not_sale_price",
    "media":{"video_id":"c9fxArnD3IY"},"event_context":{"source_listing_id":"1159827","auction_source_key":"mecum:FL26"}}',
  '00000000-0000-0000-0000-000000000040','cue-350:high-bid','media','frozen-source-hash',
  'https://www.youtube.com/watch?v=c9fxArnD3IY&t=2600s','{"method":"fixture-preserved"}',0.6,'fixture evidence words');

-- Full source row snapshot lets the assertion detect ANY provenance loss on relink.
CREATE TEMP TABLE before_relink AS SELECT to_jsonb(o) AS payload FROM vehicle_observations o
  WHERE id='00000000-0000-0000-0000-000000000030';
SELECT relink_testimony('observation','00000000-0000-0000-0000-000000000030',
  '00000000-0000-0000-0000-000000000001','primary catalogue exact VIN and scoped lot');
DO $$ BEGIN
  IF (SELECT (to_jsonb(o)-'vehicle_id'-'merged_from_vehicle_id'-'subject_id') <> (b.payload-'vehicle_id'-'merged_from_vehicle_id'-'subject_id')
    FROM vehicle_observations o CROSS JOIN before_relink b WHERE o.id='00000000-0000-0000-0000-000000000030')
    THEN RAISE EXCEPTION 'relink changed source testimony'; END IF;
  IF (SELECT count(*) FROM reattribution_audit WHERE old_vehicle_id IS NULL) <> 1 THEN RAISE EXCEPTION 'missing first-attribution audit'; END IF;
END $$;
SELECT relink_testimony('observation','00000000-0000-0000-0000-000000000030',
  '00000000-0000-0000-0000-000000000001','same target retry');
DO $$ BEGIN
  IF (SELECT count(*) FROM reattribution_audit) <> 1 THEN RAISE EXCEPTION 'retry wrote a second audit'; END IF;
END $$;
SELECT pg_temp.rejects($a$SELECT relink_testimony('observation','00000000-0000-0000-0000-000000000030',
  '00000000-0000-0000-0000-000000000002','wrong event chassis')$a$,'23514');
SELECT pg_temp.rejects($a$SELECT relink_testimony('observation','00000000-0000-0000-0000-000000000099',
  '00000000-0000-0000-0000-000000000001','missing observation')$a$,'P0001');

-- Indexed strict VIN reader: one candidate resolves, duplicates remain unbound.
DO $$ BEGIN
  IF find_vehicle_by_vin(' 194677s101228 ',true) <> '00000000-0000-0000-0000-000000000001'::uuid THEN RAISE EXCEPTION 'normalized VIN not resolved'; END IF;
END $$;
INSERT INTO vehicles(id,vin,status) VALUES('00000000-0000-0000-0000-000000000003','194677S101228','active');
DO $$ BEGIN
  IF find_vehicle_by_vin('194677S101228',true) IS NOT NULL THEN RAISE EXCEPTION 'ambiguous VIN auto-linked'; END IF;
END $$;

-- Receipt reports the stored original lineage after more than one reassignment.
INSERT INTO vehicle_observations(id,vehicle_id,content_hash)
VALUES('00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000001','second-move-source');
SELECT relink_testimony('observation','00000000-0000-0000-0000-000000000031',
  '00000000-0000-0000-0000-000000000002','first fixture move');
DO $$ DECLARE receipt jsonb; stored uuid; BEGIN
  receipt := relink_testimony('observation','00000000-0000-0000-0000-000000000031',
    '00000000-0000-0000-0000-000000000003','second fixture move');
  SELECT merged_from_vehicle_id INTO stored FROM vehicle_observations WHERE id='00000000-0000-0000-0000-000000000031';
  IF stored IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid OR
    (receipt ->> 'merged_from_vehicle_id')::uuid IS DISTINCT FROM stored THEN
    RAISE EXCEPTION 'relink receipt disagrees with preserved original lineage';
  END IF;
END $$;

-- Preserve the existing caller/actor/target-editor gate.
SELECT set_config('test.auth_role','authenticated',false);
SELECT pg_temp.rejects($a$SELECT relink_testimony('observation','00000000-0000-0000-0000-000000000030',
  '00000000-0000-0000-0000-000000000001','unsigned actor')$a$,'42501');
SELECT set_config('test.auth_role','',false);
\echo 'C15 local PG17 contract attacks passed'
