-- Empty disposable PG17 database dm_fold_* only; inherited fixture guard refuses production.
\set ON_ERROR_STOP on
\ir test_listed_engine_reported_state.sql

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
