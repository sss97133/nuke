-- Empty disposable PG17 database only: dm_fold_*; no production fixtures.
-- Run psql -X -v ON_ERROR_STOP=1 -d dm_fold_listing -f this-file.sql.
-- Exercises the migration's event -> existing queue -> fold -> specs/drill path.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_fold_%' OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable dm_fold_* database';
  END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_uid',true),'')::uuid $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TYPE public.observation_kind AS ENUM ('listing','specification','media','comment','work_record');
CREATE FUNCTION public.observation_is_public(p_kind public.observation_kind,p_data jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS
$$ SELECT p_kind IN ('listing','specification','media','comment')
   AND NOT (p_data ?| ARRAY['email','phone','receipt_id','total_amount']) $$;
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY,is_public boolean,user_id uuid,owner_id uuid,uploaded_by uuid,
  vin text,color text,color_source_image_id text,observation_count integer DEFAULT 0,
  deleted_at timestamptz,listing_kind text
);
CREATE TABLE public.observation_sources (id uuid PRIMARY KEY,slug text,base_trust_score numeric);
CREATE TABLE public.vehicle_observations (
  id uuid PRIMARY KEY,vehicle_id uuid REFERENCES public.vehicles(id),source_id uuid REFERENCES public.observation_sources(id),
  kind public.observation_kind,structured_data jsonb,subject_type text DEFAULT 'vehicle',
  confidence_score numeric,is_superseded boolean DEFAULT false,observed_at timestamptz,
  ingested_at timestamptz,source_url text,content_text text,extraction_method text,
  agent_model text,extraction_metadata jsonb
);
CREATE INDEX observations_vehicle ON public.vehicle_observations(vehicle_id);
CREATE TABLE public.vehicle_field_consensus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vehicle_id uuid NOT NULL REFERENCES public.vehicles(id),
  field_name text NOT NULL,consensus_value text,consensus_confidence numeric,
  resolution_method text NOT NULL DEFAULT 'unresolved' CHECK
    (resolution_method IN ('unanimous','majority','authority_wins','most_recent','manual','unresolved')),
  supporting_count integer DEFAULT 0,conflicting_count integer DEFAULT 0,
  supporting_observation_ids uuid[] DEFAULT '{}',conflicting_observation_ids uuid[] DEFAULT '{}',
  all_values jsonb DEFAULT '[]',resolved_at timestamptz,resolved_by text,
  created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),UNIQUE(vehicle_id,field_name)
);
ALTER TABLE public.vehicle_field_consensus ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.vehicle_metric_recompute_queue (
  vehicle_id uuid PRIMARY KEY REFERENCES public.vehicles(id),
  live_metrics_dirty boolean NOT NULL DEFAULT false,observation_count_dirty boolean NOT NULL DEFAULT false,
  queued_at timestamptz NOT NULL DEFAULT now(),attempts integer NOT NULL DEFAULT 0,last_error text
);
CREATE TABLE public.vehicle_live_metrics (
  vehicle_id uuid PRIMARY KEY,observation_count integer,comment_count integer,last_observation_at timestamptz,updated_at timestamptz
);
CREATE TABLE public.pipeline_registry (
  table_name text,column_name text,owned_by text,description text,do_not_write_directly boolean,write_via text,
  UNIQUE(table_name,column_name)
);
CREATE TABLE public.vehicle_field_provenance (vehicle_id uuid,field_name text,primary_source text,total_confidence numeric);
CREATE TABLE public.vehicle_images (
  id uuid PRIMARY KEY,vehicle_id uuid,image_url text,is_sensitive boolean,is_superseded boolean,
  is_duplicate boolean,vision_gate_status text,image_vehicle_match_status text
);
CREATE TABLE public.vehicle_field_sources (
  vehicle_id uuid,field_name text,field_value text,source_type text,confidence_score numeric,
  is_verified boolean,ai_reasoning text,source_image_id uuid,created_at timestamptz
);
CREATE TABLE public.field_evidence (
  vehicle_id uuid,field_name text,proposed_value text,source_type text,source_confidence numeric,
  status text,extraction_context text,raw_extraction_data jsonb,created_at timestamptz
);
CREATE TABLE public.observation_witnesses (id uuid,observation_id uuid,image_id uuid,witness_role text);
CREATE FUNCTION public.update_vehicle_live_metrics() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER trg_update_live_metrics AFTER INSERT ON public.vehicle_observations
FOR EACH ROW EXECUTE FUNCTION public.update_vehicle_live_metrics();
-- Existing count-trigger behavior is preserved by the migration.
CREATE FUNCTION public.test_count_enqueue() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  FOR v_id IN SELECT DISTINCT id FROM unnest(ARRAY[NEW.vehicle_id,OLD.vehicle_id]) ids(id) WHERE id IS NOT NULL LOOP
    INSERT INTO public.vehicle_metric_recompute_queue(vehicle_id,observation_count_dirty)
    VALUES(v_id,true) ON CONFLICT(vehicle_id) DO UPDATE SET observation_count_dirty=true;
  END LOOP;
  RETURN coalesce(NEW,OLD);
END $$;
CREATE TRIGGER test_count_enqueue AFTER INSERT OR UPDATE OF vehicle_id OR DELETE
ON public.vehicle_observations FOR EACH ROW EXECUTE FUNCTION public.test_count_enqueue();

\ir ../migrations/20261004031800_listing_observation_consensus_reader.sql
-- The description contract runs every existing report/role/queue assertion
-- against the replacement reader too, rather than only its prior definition.
\if :{?description_reader_contract}
ALTER TABLE public.vehicles ADD COLUMN description text, ADD COLUMN description_source text;
\ir ../migrations/20261004074612_vehicle_listing_description_reader.sql
\endif
BEGIN;

INSERT INTO public.vehicles(id,is_public,color,owner_id) VALUES
 ('11111111-1111-1111-1111-111111111111',true,'Black',NULL),
 ('22222222-2222-2222-2222-222222222222',true,NULL,NULL),
 ('33333333-3333-3333-3333-333333333333',false,NULL,'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
INSERT INTO public.observation_sources VALUES ('99999999-9999-9999-9999-999999999999','fixture-listing',.6);
INSERT INTO public.vehicle_observations
 (id,vehicle_id,source_id,kind,structured_data,confidence_score,observed_at,ingested_at,source_url,extraction_method)
VALUES ('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111',
 '99999999-9999-9999-9999-999999999999','listing','{"vin":"SOURCE-REPORTED","color":"Red"}',
 .6,'2020-01-01','2021-01-01','https://example.test/listing','fixture_parser');
SELECT * FROM public.drain_vehicle_metric_queue(10);
DO $$ DECLARE s jsonb;p jsonb; BEGIN
  s := public.get_vehicle_specs('11111111-1111-1111-1111-111111111111')->0;
  ASSERT s->>'field'='vin' AND s->'value'='null'::jsonb AND s->>'reported_value'='SOURCE-REPORTED';
  ASSERT s->'rooted'='false'::jsonb AND s->'reported_conflict'='false'::jsonb, 'Reported is not accepted/rooted truth';
  ASSERT s->>'source_observation_id'='44444444-4444-4444-4444-444444444444';
  ASSERT (s->>'reported_observed_at')::timestamptz='2020-01-01'::timestamptz;
  ASSERT (s->>'reported_ingested_at')::timestamptz='2021-01-01'::timestamptz;
  ASSERT s->>'reported_method'='fixture_parser' AND (s->>'reported_confidence')::numeric=.6;
  ASSERT (SELECT vin IS NULL AND observation_count=1 FROM public.vehicles WHERE id='11111111-1111-1111-1111-111111111111');
  s := public.get_vehicle_specs('11111111-1111-1111-1111-111111111111')->1;
  ASSERT s->>'value'='Black' AND s->'rooted'='false'::jsonb AND s->'reported_conflict'='true'::jsonb,
    'Evidence for Red must not root canonical Black';
  p := public.get_field_provenance('11111111-1111-1111-1111-111111111111','vin');
  ASSERT p->'observations'->0->>'value'='SOURCE-REPORTED';
  ASSERT p->'observations'->0->>'extraction_method'='fixture_parser';
  ASSERT p->'observations'->0 ? 'ingested_at', 'Actual drill carries both clocks and method';
END $$;

-- Canonical fields without reports remain unverified, not invented conflicts;
-- unrelated/rejected evidence never roots them, matching active evidence does.
UPDATE public.vehicles SET color='Blue' WHERE id='33333333-3333-3333-3333-333333333333';
INSERT INTO public.field_evidence(vehicle_id,field_name,proposed_value,source_type,status)
VALUES('33333333-3333-3333-3333-333333333333','color','Red','fixture','accepted'),
 ('33333333-3333-3333-3333-333333333333','color','Blue','fixture','rejected');
DO $$ DECLARE s jsonb; BEGIN
 PERFORM set_config('test.auth_uid','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',true);
 s := public.get_vehicle_specs('33333333-3333-3333-3333-333333333333')->0;
 ASSERT s->'rooted'='false'::jsonb AND s->'reported_conflict'='false'::jsonb;
 UPDATE public.field_evidence SET status='pending' WHERE proposed_value='Blue';
 ASSERT public.get_vehicle_specs('33333333-3333-3333-3333-333333333333')->0->'rooted'='true'::jsonb;
 PERFORM set_config('test.auth_uid','',true);
END $$;

-- Legacy inline image roots remain a point join, validated for this vehicle;
-- malformed, private and cross-vehicle pointers cannot root a public value.
INSERT INTO public.vehicle_images(id,vehicle_id,image_url,is_sensitive) VALUES
 ('babababa-baba-baba-baba-babababababa','33333333-3333-3333-3333-333333333333','https://example.test/blue.jpg',false);
DO $$ BEGIN
 PERFORM set_config('test.auth_uid','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',true);
 UPDATE public.field_evidence SET status='rejected' WHERE proposed_value='Blue';
 UPDATE public.vehicles SET color_source_image_id='bad-uuid' WHERE id='33333333-3333-3333-3333-333333333333';
 ASSERT public.get_vehicle_specs('33333333-3333-3333-3333-333333333333')->0->'rooted'='false'::jsonb;
 UPDATE public.vehicles SET color_source_image_id='babababa-baba-baba-baba-babababababa' WHERE id='33333333-3333-3333-3333-333333333333';
 ASSERT public.get_vehicle_specs('33333333-3333-3333-3333-333333333333')->0->'rooted'='true'::jsonb;
 UPDATE public.vehicle_images SET is_sensitive=true;
 ASSERT public.get_vehicle_specs('33333333-3333-3333-3333-333333333333')->0->'rooted'='false'::jsonb;
 PERFORM set_config('test.auth_uid','',true);
END $$;

-- Replayed ingest inserts nothing; direct fold replay preserves state identity,
-- counts, original confidence and source lineage (computation clock may change).
CREATE TEMP TABLE replay_before AS SELECT id,vehicle_id,field_name,consensus_value,
 consensus_confidence,resolution_method,supporting_count,conflicting_count,all_values,source_observation_id
FROM public.vehicle_field_consensus;
INSERT INTO public.vehicle_observations SELECT * FROM public.vehicle_observations ON CONFLICT(id) DO NOTHING;
SELECT public.detect_field_conflicts('11111111-1111-1111-1111-111111111111');
DO $$ BEGIN
  ASSERT NOT EXISTS (SELECT * FROM replay_before EXCEPT SELECT id,vehicle_id,field_name,consensus_value,
    consensus_confidence,resolution_method,supporting_count,conflicting_count,all_values,source_observation_id
    FROM public.vehicle_field_consensus), 'Replay must preserve fold values, counts, lineage and row UUID';
  ASSERT NOT EXISTS (SELECT 1 FROM public.vehicle_metric_recompute_queue), 'Duplicate ingest must not enqueue';
END $$;

-- Late ingestion of an older event does not become the selected current report.
INSERT INTO public.vehicle_observations
 (id,vehicle_id,source_id,kind,structured_data,confidence_score,observed_at,ingested_at)
VALUES ('55555555-5555-5555-5555-555555555555','11111111-1111-1111-1111-111111111111',
 '99999999-9999-9999-9999-999999999999','listing','{"vin":"OLDER-REPORTED"}',.6,'2019-01-01','2022-01-01');
SELECT * FROM public.drain_vehicle_metric_queue(10);
DO $$ DECLARE s jsonb; BEGIN
 ASSERT (SELECT source_observation_id='44444444-4444-4444-4444-444444444444' AND conflicting_count=1
  FROM public.vehicle_field_consensus WHERE field_name='vin'), 'Event time precedes ingest time in selection';
 s := public.get_vehicle_specs('11111111-1111-1111-1111-111111111111')->0;
 ASSERT s->'reported_value'='null'::jsonb AND s->'reported_conflict'='true'::jsonb, 'Conflict cannot silently choose a VIN';
END $$;

-- Future or unknown clocks, private payloads and nonvehicle subjects are not
-- public current-state claims, even with higher stored confidence.
INSERT INTO public.vehicle_observations
 (id,vehicle_id,source_id,kind,structured_data,subject_type,confidence_score,observed_at,ingested_at)
SELECT ('66666666-6666-6666-6666-'||lpad(n::text,12,'0'))::uuid,
 '11111111-1111-1111-1111-111111111111','99999999-9999-9999-9999-999999999999','listing',
 CASE WHEN n=4 THEN '{"vin":"PRIVATE","email":"private@example.test"}'::jsonb
 ELSE '{"vin":"INELIGIBLE"}'::jsonb END,
 CASE WHEN n=5 THEN 'user' ELSE 'vehicle' END,1,
 CASE WHEN n=1 THEN now()+interval '1 day' WHEN n=3 THEN NULL ELSE '2023-01-01'::timestamptz END,
 CASE WHEN n=2 THEN now()+interval '1 day' ELSE '2024-01-01'::timestamptz END
FROM generate_series(1,5) n;
SELECT * FROM public.drain_vehicle_metric_queue(10);
DO $$ BEGIN
 ASSERT (SELECT supporting_count+conflicting_count=2 FROM public.vehicle_field_consensus WHERE field_name='vin');
 ASSERT jsonb_array_length(public.get_field_provenance('11111111-1111-1111-1111-111111111111','vin')->'observations')=6,
  'Public drill excludes private payload while retaining public testimony with unknown/future clocks';
 ASSERT public.get_vehicle_specs('33333333-3333-3333-3333-333333333333') IS NULL, 'Private vehicle denied';
 PERFORM set_config('test.auth_uid','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',true);
 ASSERT public.get_vehicle_specs('33333333-3333-3333-3333-333333333333')->0->>'value'='Blue', 'Private vehicle owner retained';
 PERFORM set_config('test.auth_uid','',true);
END $$;

-- A sanctioned supersession dirties the fold; retired testimony stays present.
UPDATE public.vehicle_observations SET is_superseded=true WHERE id='55555555-5555-5555-5555-555555555555';
DO $$ BEGIN ASSERT EXISTS(SELECT 1 FROM public.vehicle_metric_recompute_queue WHERE live_metrics_dirty); END $$;
SELECT * FROM public.drain_vehicle_metric_queue(10);
DO $$ BEGIN
 ASSERT public.get_vehicle_specs('11111111-1111-1111-1111-111111111111')->0->>'reported_value'='SOURCE-REPORTED';
 ASSERT (SELECT count(*) FROM public.vehicle_observations)=7, 'Supersession preserves testimony';
END $$;

-- Relink dirties both heads; source FK/reader gate hides stale old state even
-- before the drain; replay retires old state and materializes the new head.
UPDATE public.vehicle_observations SET vehicle_id='22222222-2222-2222-2222-222222222222'
WHERE id='44444444-4444-4444-4444-444444444444';
DO $$ BEGIN
 ASSERT (SELECT count(*) FROM public.vehicle_metric_recompute_queue WHERE live_metrics_dirty)=2;
 ASSERT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.get_vehicle_specs('11111111-1111-1111-1111-111111111111')) s
   WHERE s->>'field'='vin'), 'Stale relinked source cannot leak through old vehicle';
END $$;
SELECT * FROM public.drain_vehicle_metric_queue(10);
DO $$ BEGIN
 ASSERT NOT EXISTS(SELECT 1 FROM public.vehicle_field_consensus WHERE vehicle_id='11111111-1111-1111-1111-111111111111');
 ASSERT public.get_vehicle_specs('22222222-2222-2222-2222-222222222222')->0->>'reported_value'='SOURCE-REPORTED';
END $$;

-- Derived source linkage is enforced, not a guessed JSON UUID.
DO $$ BEGIN
 BEGIN
  UPDATE public.vehicle_field_consensus SET source_observation_id='88888888-8888-8888-8888-888888888888';
  RAISE EXCEPTION 'Missing observation FK accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 ASSERT NOT has_function_privilege('anon','public.detect_field_conflicts(uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','public.drain_vehicle_metric_queue(integer)','EXECUTE');
 ASSERT has_function_privilege('anon','public.get_vehicle_specs(uuid)','EXECUTE');
 ASSERT (SELECT count(*) FROM pg_attribute WHERE attrelid='public.vehicle_field_consensus'::regclass
   AND attnum>0 AND NOT attisdropped AND col_description(attrelid,attnum) IS NOT NULL)=17;
 ASSERT EXISTS(SELECT 1 FROM public.pipeline_registry WHERE table_name='vehicle_field_consensus'
   AND owned_by='detect_field_conflicts' AND write_via='drain_vehicle_metric_queue');
END $$;

-- Fail the actual materialization, prove transactional rollback + retained and
-- advancing retry evidence, then remove the failure and converge via same queue.
CREATE FUNCTION public.test_fail_fold() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'fixture materialization failure'; END $$;
CREATE TRIGGER test_fail_fold BEFORE INSERT OR UPDATE ON public.vehicle_field_consensus
FOR EACH ROW EXECUTE FUNCTION public.test_fail_fold();
INSERT INTO public.vehicle_metric_recompute_queue(vehicle_id,live_metrics_dirty,observation_count_dirty)
VALUES('22222222-2222-2222-2222-222222222222',true,true);
SELECT * FROM public.drain_vehicle_metric_queue(10);
SELECT * FROM public.drain_vehicle_metric_queue(10);
SELECT * FROM public.drain_vehicle_metric_queue(10);
DO $$ BEGIN
 ASSERT (SELECT attempts=3 AND last_error='fixture materialization failure'
   FROM public.vehicle_metric_recompute_queue), 'Failure remains visible after three real attempts';
END $$;
DROP TRIGGER test_fail_fold ON public.vehicle_field_consensus;
SELECT * FROM public.drain_vehicle_metric_queue(10);
DO $$ BEGIN ASSERT NOT EXISTS(SELECT 1 FROM public.vehicle_metric_recompute_queue); END $$;

-- Nonobject legacy payloads never poison the otherwise valid vehicle fold.
INSERT INTO public.vehicle_observations
 (id,vehicle_id,source_id,kind,structured_data,confidence_score,observed_at,ingested_at)
VALUES('77777777-7777-7777-7777-777777777777','22222222-2222-2222-2222-222222222222',
 '99999999-9999-9999-9999-999999999999','listing','["vin"]',1,'2025-01-01','2025-01-01');
SELECT * FROM public.drain_vehicle_metric_queue(10);
DO $$ BEGIN
 ASSERT NOT EXISTS(SELECT 1 FROM public.vehicle_metric_recompute_queue);
 ASSERT public.get_vehicle_specs('22222222-2222-2222-2222-222222222222')->0->>'reported_value'='SOURCE-REPORTED';
END $$;

-- A manual decision remains outside the scheduled writer's ownership.
INSERT INTO public.vehicle_field_consensus(vehicle_id,field_name,consensus_value,resolution_method)
VALUES('22222222-2222-2222-2222-222222222222','fuel_type','Owner decision','manual');
SELECT public.detect_field_conflicts('22222222-2222-2222-2222-222222222222');
DO $$ BEGIN
 ASSERT EXISTS(SELECT 1 FROM public.vehicle_field_consensus
   WHERE field_name='fuel_type' AND consensus_value='Owner decision' AND resolution_method='manual');
END $$;

-- Changing state is chronological, even when the older claim has higher
-- confidence. Prior price/location/mileage reports are history, not fabricated
-- contemporaneous conflicts; same-event disagreements are unresolved.
INSERT INTO public.vehicle_observations
 (id,vehicle_id,source_id,kind,structured_data,confidence_score,observed_at,ingested_at)
VALUES('abababab-abab-abab-abab-abababababab','22222222-2222-2222-2222-222222222222',
 '99999999-9999-9999-9999-999999999999','listing',
 '{"asking_price":100,"mileage":10,"location_token":"Old place"}',.95,'2020-01-01','2024-01-01'),
 ('acacacac-acac-acac-acac-acacacacacac','22222222-2222-2222-2222-222222222222',
 '99999999-9999-9999-9999-999999999999','listing',
 '{"asking_price":80,"mileage":20,"location_token":"New place"}',.6,'2022-01-01','2023-01-01');
SELECT * FROM public.drain_vehicle_metric_queue(10);
DO $$ BEGIN
 ASSERT (SELECT count(*) FROM public.vehicle_field_consensus WHERE field_name IN ('asking_price','mileage','location_token')
   AND source_observation_id='acacacac-acac-acac-acac-acacacacacac' AND resolution_method='most_recent')=3;
 ASSERT EXISTS(SELECT 1 FROM jsonb_array_elements(public.get_vehicle_specs('22222222-2222-2222-2222-222222222222')) s
   WHERE s->>'field'='mileage' AND s->>'reported_value'='20' AND s->'reported_conflict'='false'::jsonb);
END $$;
INSERT INTO public.vehicle_observations
 (id,vehicle_id,source_id,kind,structured_data,confidence_score,observed_at,ingested_at)
VALUES('adadadad-adad-adad-adad-adadadadadad','22222222-2222-2222-2222-222222222222',
 '99999999-9999-9999-9999-999999999999','listing','{"mileage":21}',.5,'2022-01-01','2023-01-01');
SELECT * FROM public.drain_vehicle_metric_queue(10);
DO $$ BEGIN
 ASSERT (SELECT resolution_method='unresolved' FROM public.vehicle_field_consensus WHERE field_name='mileage');
 ASSERT EXISTS(SELECT 1 FROM jsonb_array_elements(public.get_vehicle_specs('22222222-2222-2222-2222-222222222222')) s
   WHERE s->>'field'='mileage' AND s->'reported_value'='null'::jsonb AND s->'reported_conflict'='true'::jsonb);
END $$;

-- A source moved out of the eligible kind/subject cannot leak stale state
-- while waiting for the scheduled queue tick.
UPDATE public.vehicle_observations SET subject_type='user'
WHERE id='44444444-4444-4444-4444-444444444444';
DO $$ BEGIN
 ASSERT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.get_vehicle_specs('22222222-2222-2222-2222-222222222222')) s
   WHERE s->>'field'='vin');
END $$;
UPDATE public.vehicle_observations SET subject_type='vehicle',kind='specification'
WHERE id='44444444-4444-4444-4444-444444444444';
DO $$ BEGIN
 ASSERT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.get_vehicle_specs('22222222-2222-2222-2222-222222222222')) s
   WHERE s->>'field'='vin');
END $$;
UPDATE public.vehicle_observations SET kind='listing'
WHERE id='44444444-4444-4444-4444-444444444444';
UPDATE public.vehicles SET deleted_at=now() WHERE id='22222222-2222-2222-2222-222222222222';
DO $$ BEGIN ASSERT public.get_vehicle_specs('22222222-2222-2222-2222-222222222222') IS NULL; END $$;
UPDATE public.vehicles SET deleted_at=NULL,listing_kind='non_vehicle_item' WHERE id='22222222-2222-2222-2222-222222222222';
DO $$ BEGIN ASSERT public.get_vehicle_specs('22222222-2222-2222-2222-222222222222') IS NULL; END $$;
UPDATE public.vehicles SET listing_kind=NULL WHERE id='22222222-2222-2222-2222-222222222222';
SET LOCAL ROLE anon;
DO $$ BEGIN
 ASSERT public.get_vehicle_specs('33333333-3333-3333-3333-333333333333') IS NULL;
 ASSERT public.get_vehicle_specs('22222222-2222-2222-2222-222222222222')->0->>'reported_value'='SOURCE-REPORTED';
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS: reported/current separation, queue/fold/reader, provenance/clocks, idempotence, late/future/null clocks, conflicts, private gates, supersession/relink, FK, registry/descriptions and retry recovery' result;
