-- Synthetic PG17 only. Reuse the actual listing queue/fold/reader controls.
-- psql -X -v ON_ERROR_STOP=1 -d dm_fold_listed_engine -f this-file.sql
\set ON_ERROR_STOP on
\set description_reader_contract true
\ir test_listing_observation_consensus.sql
ALTER TYPE public.observation_kind ADD VALUE 'sale_result';
ALTER TYPE public.observation_kind ADD VALUE 'bid';
ALTER TYPE public.observation_kind ADD VALUE 'condition';
ALTER TYPE public.observation_kind ADD VALUE 'splice';
ALTER TABLE public.vehicles ADD COLUMN engine_size text, ADD COLUMN engine_type text,
  ADD COLUMN displacement text;
\ir ../migrations/20261004175418_observation_private_fields_guard.sql
CREATE TEMP TABLE previous_engine_permissions AS SELECT oid,proacl,proowner,prosecdef,proconfig
FROM pg_proc WHERE oid IN ('public.detect_field_conflicts(uuid)'::regprocedure,
  'public.get_vehicle_specs(uuid)'::regprocedure);
\ir ../migrations/20261004230500_listed_engine_reported_state.sql
-- The exact candidate body is accepted idempotently without permission changes.
\ir ../migrations/20261004230500_listed_engine_reported_state.sql
BEGIN;
CREATE FUNCTION pg_temp.engine_ok(label text,condition boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Listed-engine contract failed: %',label; END IF;
  RAISE NOTICE 'PASS LISTED ENGINE %',label;
END $$;
CREATE FUNCTION pg_temp.engine_spec(v uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT x FROM jsonb_array_elements(public.get_vehicle_specs(v)) x WHERE x->>'field'='engine_size'
$$;
CREATE FUNCTION pg_temp.engine_insert(n integer,k public.observation_kind,d jsonb,
  event_at timestamptz DEFAULT '2024-01-02T03:04:05.123456Z',
  arrival_at timestamptz DEFAULT '2025-01-02T03:04:05.654321Z') RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.vehicle_observations(id,vehicle_id,source_id,kind,structured_data,
    confidence_score,observed_at,ingested_at,source_url,extraction_method)
  VALUES(md5('engine-report-'||n)::uuid,md5('engine-parent')::uuid,md5('engine-source')::uuid,
    k,d,.6,event_at,arrival_at,'https://source.invalid/listing/episode-a','html_match')
$$;
INSERT INTO public.vehicles(id,is_public,engine_type) VALUES(md5('engine-parent')::uuid,true,'V8'),
  (md5('engine-private')::uuid,false,'V8');
INSERT INTO public.observation_sources VALUES(md5('engine-source')::uuid,'fixture-engine',.85);

-- Each actual producing kind reaches the original key, not engine_type.
DO $$ DECLARE k public.observation_kind; n integer:=0; s jsonb; BEGIN
  FOREACH k IN ARRAY ARRAY['listing','sale_result','specification']::public.observation_kind[] LOOP
    n:=n+1;
    DELETE FROM public.vehicle_field_consensus;
    DELETE FROM public.vehicle_observations;
    PERFORM pg_temp.engine_insert(n,k,'{"engine_size":"289ci V8","engine_type":"V6","vin":"IGNORED-NONLISTING"}');
    PERFORM * FROM public.drain_vehicle_metric_queue(10);
    s:=pg_temp.engine_spec(md5('engine-parent')::uuid);
    PERFORM pg_temp.engine_ok(k||' reaches listed-engine field',s->>'reported_value'='289ci V8'
      AND s->>'source_observation_id'=md5('engine-report-'||n)::uuid::text
      AND (SELECT source_url='https://source.invalid/listing/episode-a'
        FROM public.vehicle_observations WHERE id=md5('engine-report-'||n)::uuid)
      AND s->>'reported_method'='html_match'
      AND (s->>'reported_observed_at')::timestamptz='2024-01-02T03:04:05.123456Z'::timestamptz
      AND (s->>'reported_ingested_at')::timestamptz='2025-01-02T03:04:05.654321Z'::timestamptz);
    PERFORM pg_temp.engine_ok(k||' keeps historical binding unknown',s->>'sale_episode_binding'='unestablished'
      AND s->>'reported_time_basis'='stored_observation_clock'
      AND s->>'field_meaning'='listed_engine_phrase_not_parsed_architecture_or_displacement');
    IF k <> 'listing' THEN
      PERFORM pg_temp.engine_ok(k||' cannot widen unrelated field kinds',NOT EXISTS(
        SELECT 1 FROM public.vehicle_field_consensus WHERE field_name IN ('engine_type','vin')));
    END IF;
  END LOOP;
END $$;

-- Source-owned mechanical package/designation words remain literal phrases.
-- These disclosure tokens do not become an installed-at-sale classification.
DO $$ DECLARE phrase text; n integer:=40; BEGIN
  FOREACH phrase IN ARRAY ARRAY['A-Code 289ci V8','A Code 289ci V8',
    '5.0-Liter Coyote V8','5.0 Liter Coyote V8'] LOOP
    n:=n+1;
    DELETE FROM public.vehicle_field_consensus;
    DELETE FROM public.vehicle_observations;
    PERFORM pg_temp.engine_insert(n,'sale_result',jsonb_build_object('engine_size',phrase));
    PERFORM * FROM public.drain_vehicle_metric_queue(10);
    PERFORM pg_temp.engine_ok('mechanical package phrase retained '||n,
      pg_temp.engine_spec(md5('engine-parent')::uuid)->>'reported_value'=phrase
      AND pg_temp.engine_spec(md5('engine-parent')::uuid)->>'sale_episode_binding'='unestablished');
  END LOOP;
END $$;

DELETE FROM public.vehicle_field_consensus;
    DELETE FROM public.vehicle_observations;
SELECT pg_temp.engine_insert(4,'sale_result','{"engine_size":"V8"}');
SELECT * FROM public.drain_vehicle_metric_queue(10);
DO $$ BEGIN
  PERFORM pg_temp.engine_ok('generic V8 never becomes 289/displacement',
    pg_temp.engine_spec(md5('engine-parent')::uuid)->>'reported_value'='V8'
    AND (SELECT engine_type='V8' AND engine_size IS NULL AND displacement IS NULL
      FROM public.vehicles WHERE id=md5('engine-parent')::uuid));
END $$;

-- Changing-field selection uses original chronology, never arrival as sale time.
SELECT pg_temp.engine_insert(5,'specification','{"engine_size":"200ci Inline-Six"}',
  '2023-01-01','2025-02-01');
SELECT * FROM public.drain_vehicle_metric_queue(10);
DO $$ BEGIN
  PERFORM pg_temp.engine_ok('late older engine does not displace current report',
    pg_temp.engine_spec(md5('engine-parent')::uuid)->>'reported_value'='V8'
    AND (SELECT conflicting_count=1 AND resolution_method='most_recent'
      FROM public.vehicle_field_consensus WHERE field_name='engine_size'));
END $$;
SELECT pg_temp.engine_insert(6,'listing','{"engine_size":"302ci V8"}');
SELECT * FROM public.drain_vehicle_metric_queue(10);
DO $$ BEGIN
  PERFORM pg_temp.engine_ok('same-clock engine disagreement stays unresolved',
    pg_temp.engine_spec(md5('engine-parent')::uuid)->'reported_value'='null'::jsonb
    AND pg_temp.engine_spec(md5('engine-parent')::uuid)->'reported_conflict'='true'::jsonb
    AND (SELECT resolution_method='unresolved' AND supporting_count+conflicting_count=3
      FROM public.vehicle_field_consensus WHERE field_name='engine_size'));
END $$;
CREATE TEMP TABLE engine_replay_before AS SELECT id,field_name,consensus_value,source_observation_id,
  supporting_count,conflicting_count,resolution_method FROM public.vehicle_field_consensus;
SELECT public.detect_field_conflicts(md5('engine-parent')::uuid);
SELECT pg_temp.engine_ok('replay preserves original selected claim/counts',NOT EXISTS(
  SELECT * FROM engine_replay_before EXCEPT SELECT id,field_name,consensus_value,source_observation_id,
    supporting_count,conflicting_count,resolution_method FROM public.vehicle_field_consensus));

-- Unknown/future clocks, private marked payload, nested/malformed data, names and
-- unsupported kinds/source pointers cannot become this new public field.
DELETE FROM public.vehicle_field_consensus;
    DELETE FROM public.vehicle_observations;
SELECT pg_temp.engine_insert(10,'sale_result','{"engine_size":"289ci V8"}',NULL,'2025-01-01');
SELECT pg_temp.engine_insert(11,'sale_result','{"engine_size":"289ci V8"}','2024-01-01',NULL);
SELECT pg_temp.engine_insert(12,'sale_result','{"engine_size":"289ci V8"}',statement_timestamp()+interval '1 day');
SELECT pg_temp.engine_insert(13,'sale_result','{"engine_size":"289ci V8"}','2024-01-01',statement_timestamp()+interval '1 day');
SELECT pg_temp.engine_insert(14,'sale_result','{"engine_size":"289ci V8","nested":{"fullName":"Synthetic private person"}}');
SELECT pg_temp.engine_insert(15,'sale_result','{"engine_size":{"text":"289ci V8"}}');
SELECT pg_temp.engine_insert(16,'sale_result','{"nested":{"engine_size":"289ci V8"}}');
SELECT pg_temp.engine_insert(17,'sale_result','{"engine_size":"Synthetic Person repaired the 289ci V8"}');
SELECT pg_temp.engine_insert(18,'comment','{"engine_size":"289ci V8"}');
SELECT pg_temp.engine_insert(19,'sale_result','{"engine_size":"289ci V8"}');
UPDATE public.vehicle_observations SET source_url=NULL WHERE id=md5('engine-report-19')::uuid;
SELECT pg_temp.engine_insert(20,'sale_result','{"engine_size":"289ci V8"}');
UPDATE public.vehicle_observations SET source_id=NULL WHERE id=md5('engine-report-20')::uuid;
SELECT pg_temp.engine_insert(21,'sale_result','{"engine_size":"289ci V8"}');
UPDATE public.vehicle_observations SET subject_type='user' WHERE id=md5('engine-report-21')::uuid;
SELECT pg_temp.engine_insert(22,'sale_result','{"engine_size":"289ci V8 https://private.invalid/person"}');
SELECT pg_temp.engine_insert(23,'sale_result','{"engine_size":"289ci V8 <script>private</script>"}');
SELECT * FROM public.drain_vehicle_metric_queue(10);
SELECT pg_temp.engine_ok('ineligible claims yield no reported engine',pg_temp.engine_spec(md5('engine-parent')::uuid) IS NULL
  AND NOT EXISTS(SELECT 1 FROM public.vehicle_field_consensus WHERE field_name='engine_size'));
UPDATE public.vehicles SET engine_size='Synthetic Person repaired the engine' WHERE id=md5('engine-parent')::uuid;
SELECT pg_temp.engine_ok('arbitrary canonical engine prose is also withheld',pg_temp.engine_spec(md5('engine-parent')::uuid) IS NULL);
UPDATE public.vehicles SET engine_size=NULL WHERE id=md5('engine-parent')::uuid;

-- Read-time rechecks close stale derived rows without requiring a replay.
DELETE FROM public.vehicle_field_consensus;
    DELETE FROM public.vehicle_observations;
SELECT pg_temp.engine_insert(30,'sale_result','{"engine_size":"Rebuilt 289ci Hi-Po V8"}');
SELECT * FROM public.drain_vehicle_metric_queue(10);
SELECT pg_temp.engine_ok('bounded mechanical modifier remains original',
  pg_temp.engine_spec(md5('engine-parent')::uuid)->>'reported_value'='Rebuilt 289ci Hi-Po V8');
UPDATE public.vehicle_observations SET is_superseded=true WHERE id=md5('engine-report-30')::uuid;
SELECT pg_temp.engine_ok('superseded source immediately hidden',pg_temp.engine_spec(md5('engine-parent')::uuid) IS NULL);
UPDATE public.vehicle_observations SET is_superseded=false,source_url=NULL WHERE id=md5('engine-report-30')::uuid;
SELECT pg_temp.engine_ok('missing source URL immediately hidden',pg_temp.engine_spec(md5('engine-parent')::uuid) IS NULL);
UPDATE public.vehicle_observations SET source_url='https://source.invalid/listing/episode-a',
  structured_data='{"engine_size":"Synthetic Person repaired 289ci V8"}' WHERE id=md5('engine-report-30')::uuid;
SELECT pg_temp.engine_ok('changed source cannot retain trusted original state',pg_temp.engine_spec(md5('engine-parent')::uuid) IS NULL);
UPDATE public.vehicle_observations SET structured_data='{"engine_size":"Rebuilt 289ci Hi-Po V8"}',
  vehicle_id=md5('engine-private')::uuid WHERE id=md5('engine-report-30')::uuid;
SELECT pg_temp.engine_ok('relinked source cannot leak old parent state',pg_temp.engine_spec(md5('engine-parent')::uuid) IS NULL);
SET LOCAL ROLE anon;
DO $$ BEGIN
  ASSERT public.get_vehicle_specs(md5('engine-private')::uuid) IS NULL;
END $$;
RESET ROLE;
SELECT pg_temp.engine_ok('private parent remains denied',public.get_vehicle_specs(md5('engine-private')::uuid) IS NULL);
UPDATE public.vehicle_field_consensus SET source_observation_id=NULL WHERE field_name='engine_size';
SELECT pg_temp.engine_ok('orphan derived source is withheld',pg_temp.engine_spec(md5('engine-parent')::uuid) IS NULL);

SELECT pg_temp.engine_ok('owner/config/ACL remain unchanged',NOT EXISTS(
  SELECT * FROM previous_engine_permissions EXCEPT SELECT oid,proacl,proowner,prosecdef,proconfig FROM pg_proc
  WHERE oid IN ('public.detect_field_conflicts(uuid)'::regprocedure,'public.get_vehicle_specs(uuid)'::regprocedure)));
SELECT pg_temp.engine_ok('engine_type canonical remains separate',
  (SELECT engine_type='V8' AND displacement IS NULL FROM public.vehicles WHERE id=md5('engine-parent')::uuid)
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(public.get_vehicle_specs(md5('engine-parent')::uuid)) x
    WHERE x->>'field'='engine_type' AND x->>'value'='V8'));
ROLLBACK;
SELECT 'PASS: existing listing contracts plus listed-engine kinds/source/clock/conflict/privacy/role controls' result;

-- Same actual source -> queue -> consensus -> public reader, now with the
-- production index shape that rejected full native PurpleWave payloads.
ALTER TABLE public.vehicle_observations ADD COLUMN property_id uuid;
CREATE INDEX idx_vobs_engagement_contrib ON public.vehicle_observations
  (vehicle_id,kind,is_superseded,((structured_data->>'authored'))) WHERE vehicle_id IS NOT NULL;
CREATE INDEX idx_vehicle_observations_property ON public.vehicle_observations
  (vehicle_id,property_id) WHERE property_id IS NOT NULL AND is_superseded=false;
CREATE INDEX idx_vobs_specs_covering ON public.vehicle_observations (vehicle_id)
  INCLUDE(is_superseded,structured_data) WHERE NOT coalesce(is_superseded,false)
  AND structured_data ?| ARRAY['vin','mileage','transmission','drivetrain','body_style','color','interior_color','engine_type','fuel_type'];
CREATE TEMP TABLE full_native_fixture AS SELECT jsonb_build_object(
  'vin','SYNTHETIC-SOURCE-VIN','description','Complete source description retained. '||string_agg(md5(n::text),''),
  'source_payload',jsonb_build_object('gallery',jsonb_agg(md5(('gallery-'||n)::text)))) AS payload
FROM generate_series(1,300) n;
INSERT INTO public.vehicles(id,is_public) VALUES(md5('wide-native')::uuid,true);
INSERT INTO public.observation_sources VALUES(md5('wide-native-source')::uuid,'synthetic-native',.85);
INSERT INTO public.vehicle_observations(id,vehicle_id,source_id,kind,structured_data,
  confidence_score,observed_at,ingested_at,source_url,extraction_method)
VALUES(md5('small-native')::uuid,md5('wide-native')::uuid,md5('wide-native-source')::uuid,
  'listing','{"color":"Blue"}',.8,'2024-01-01','2024-01-02','https://source.invalid/item','native_fixture');
SELECT * FROM public.drain_vehicle_metric_queue(10);
-- Ignore only the reader's response clock when comparing otherwise exact output.
CREATE TEMP TABLE native_reader_before AS SELECT jsonb_agg(x-'as_of_at' ORDER BY x->>'field') AS result
FROM jsonb_array_elements(public.get_vehicle_specs(md5('wide-native')::uuid)) x;
DO $$ BEGIN
  BEGIN
    INSERT INTO public.vehicle_observations(id,vehicle_id,source_id,kind,structured_data,
      confidence_score,observed_at,ingested_at,source_url,extraction_method)
    SELECT md5('large-native')::uuid,md5('wide-native')::uuid,md5('wide-native-source')::uuid,
      'listing',payload,.8,'2025-01-01','2025-01-02','https://source.invalid/item','native_fixture'
    FROM full_native_fixture;
    RAISE EXCEPTION 'Expected native JSON B-tree tuple-size failure';
  EXCEPTION WHEN program_limit_exceeded THEN
    ASSERT SQLERRM LIKE '%index row%' AND SQLERRM LIKE '%maximum%', SQLERRM;
    RAISE NOTICE 'PASS actual oversized B-tree admission failure reproduced';
  END;
END $$;
SET statement_timeout='3s';
SET lock_timeout='1s';
\ir ../migrations/20261109000056_remove_oversized_observation_covering_index.sql
\ir ../migrations/20261109000056_remove_oversized_observation_covering_index.sql
DO $$ BEGIN
  ASSERT current_setting('statement_timeout')='3s' AND current_setting('lock_timeout')='1s';
  ASSERT to_regclass('public.idx_vobs_specs_covering') IS NULL;
  ASSERT (SELECT result FROM native_reader_before) = (SELECT jsonb_agg(x-'as_of_at' ORDER BY x->>'field')
    FROM jsonb_array_elements(public.get_vehicle_specs(md5('wide-native')::uuid)) x),
    'Removing the index must preserve existing reader results';
END $$;
INSERT INTO public.vehicle_observations(id,vehicle_id,source_id,kind,structured_data,
  confidence_score,observed_at,ingested_at,source_url,extraction_method)
SELECT md5('large-native')::uuid,md5('wide-native')::uuid,md5('wide-native-source')::uuid,
  'listing',payload,.8,'2025-01-01','2025-01-02','https://source.invalid/item','native_fixture'
FROM full_native_fixture;
SELECT * FROM public.drain_vehicle_metric_queue(10);
DO $$ DECLARE spec jsonb; description jsonb; BEGIN
  ASSERT (SELECT o.structured_data=f.payload FROM public.vehicle_observations o CROSS JOIN full_native_fixture f
    WHERE o.id=md5('large-native')::uuid), 'Full native JSON must remain byte-equivalent as JSONB';
  SELECT x INTO spec FROM jsonb_array_elements(public.get_vehicle_specs(md5('wide-native')::uuid)) x WHERE x->>'field'='vin';
  ASSERT spec->>'reported_value'='SYNTHETIC-SOURCE-VIN'
    AND spec->>'source_observation_id'=md5('large-native')::uuid::text
    AND spec->>'reported_method'='native_fixture' AND spec->'value'='null'::jsonb;
  SELECT x INTO description FROM jsonb_array_elements(public.get_vehicle_specs(md5('wide-native')::uuid)) x WHERE x->>'field'='description';
  ASSERT description->'source_descriptions'->0->>'text'=(SELECT payload->>'description' FROM full_native_fixture);
  ASSERT description->'source_descriptions'->0->>'source_url'='https://source.invalid/item';
  RAISE NOTICE 'PASS full JSON admission, provenance, VIN claim and complete reader description';
END $$;
