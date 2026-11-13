-- Empty local fixture only. The three guard migrations against synthetic records shaped like the
-- photo citations read on the proof vehicle on 2026-11-12. No production observation is imported.
\set ON_ERROR_STOP on
DO $$ BEGIN IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicle_observations') IS NOT NULL
 THEN RAISE EXCEPTION 'Requires an empty disposable dm_refinement_ database'; END IF; END $$;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE subject_taxonomy(subject_key text PRIMARY KEY,category text,is_active boolean DEFAULT true);
INSERT INTO subject_taxonomy VALUES ('engine.block','engine',true);
CREATE TABLE vehicle_observations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vehicle_id uuid,kind text,extraction_method text,
 structured_data jsonb,is_superseded boolean DEFAULT false,descriptor_id uuid,property_id uuid);
CREATE TABLE observation_witnesses(observation_id uuid REFERENCES vehicle_observations(id),image_id uuid,witness_role text);
-- One vehicle (a1), four photos: p1 has two keyed claims, p2 only an unkeyed reading, p3 only a
-- superseded keyed claim, p4 a keyed claim that belongs to another vehicle (a2).
INSERT INTO vehicle_observations(id,vehicle_id,kind,extraction_method,is_superseded,descriptor_id,property_id) VALUES
 ('c1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','condition','photo_map_harvest_v1',false,gen_random_uuid(),NULL),
 ('c1000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000001','condition','photo_map_harvest_v1',false,NULL,gen_random_uuid()),
 ('c1000000-0000-0000-0000-000000000003','a1000000-0000-0000-0000-000000000001','media','reviewed_image_analysis_v1',false,NULL,NULL),
 ('c1000000-0000-0000-0000-000000000004','a1000000-0000-0000-0000-000000000001','condition','photo_map_harvest_v1',true,gen_random_uuid(),NULL),
 ('c1000000-0000-0000-0000-000000000005','a2000000-0000-0000-0000-000000000002','condition','photo_map_harvest_v1',false,gen_random_uuid(),NULL);
INSERT INTO observation_witnesses VALUES
 ('c1000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001','derived'),
 ('c1000000-0000-0000-0000-000000000002','b1000000-0000-0000-0000-000000000001','derived'),
 ('c1000000-0000-0000-0000-000000000003','b1000000-0000-0000-0000-000000000001','derived'),
 ('c1000000-0000-0000-0000-000000000003','b2000000-0000-0000-0000-000000000002','derived'),
 ('c1000000-0000-0000-0000-000000000004','b3000000-0000-0000-0000-000000000003','derived'),
 ('c1000000-0000-0000-0000-000000000005','b4000000-0000-0000-0000-000000000004','derived');
\ir ../migrations/20261113170000_visual_work_system_key_guard.sql
\ir ../migrations/20261114101000_visual_work_part_key_guard.sql
-- Before the third guard: a fresh caption on a keyed photo lands with no claim cited, which is the gap.
INSERT INTO vehicle_observations(vehicle_id,kind,extraction_method,structured_data) VALUES ('a1000000-0000-0000-0000-000000000001','work_record','visual_work_v1',
 '{"visual_sources":[{"image_id":"b1000000-0000-0000-0000-000000000001","role":"after","caption":"Front disc and knuckle"}]}');
\ir ../migrations/20261116011000_visual_work_keyed_claim_citation_guard.sql
CREATE FUNCTION pg_temp.try(p_sources jsonb,p_extra jsonb DEFAULT '{}') RETURNS text LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO public.vehicle_observations(vehicle_id,kind,extraction_method,structured_data)
  VALUES ('a1000000-0000-0000-0000-000000000001','work_record','visual_work_v1',jsonb_build_object('visual_sources',p_sources)||p_extra);
 RETURN 'admitted';
EXCEPTION WHEN check_violation THEN RETURN SQLERRM;
END $$;
DO $$ DECLARE r text; n int; BEGIN
 SELECT count(*) INTO n FROM vehicle_observations WHERE extraction_method='visual_work_v1';
 ASSERT n=1,'the stored row is left alone';
 -- The same citation is now refused, the photo is named and the legal move is in the message.
 r:=pg_temp.try('[{"image_id":"b1000000-0000-0000-0000-000000000001","role":"after","caption":"Front disc and knuckle"}]');
 ASSERT r LIKE 'uncited_keyed_claim: photos b1000000-0000-0000-0000-000000000001.%' AND r LIKE '%keyed_claim_ids%' AND r LIKE '%caption stays%',r;
 -- Citing one of the photo's keyed claims is enough; citing both passes; the caption is kept.
 ASSERT pg_temp.try('[{"image_id":"b1000000-0000-0000-0000-000000000001","caption":"c","keyed_claim_ids":["c1000000-0000-0000-0000-000000000002"]}]')='admitted';
 ASSERT pg_temp.try('[{"image_id":"B1000000-0000-0000-0000-000000000001","caption":"c","keyed_claim_ids":["c1000000-0000-0000-0000-000000000001","c1000000-0000-0000-0000-000000000002"]}]')='admitted';
 -- Photos with nothing keyed are not affected: only an unkeyed reading, only a superseded claim,
 -- only another vehicle's claim, or no row at all.
 ASSERT pg_temp.try('[{"image_id":"b2000000-0000-0000-0000-000000000002","caption":"c"},{"image_id":"b3000000-0000-0000-0000-000000000003","caption":"c"},
   {"image_id":"b4000000-0000-0000-0000-000000000004","caption":"c"},{"image_id":"b9000000-0000-0000-0000-000000000009","caption":"c"}]')='admitted';
 -- A listed id must be a current keyed claim of this vehicle on that photo: not the unkeyed reading,
 -- not a claim on another photo, not a superseded one, not another vehicle's, not a made-up or non-text id.
 ASSERT pg_temp.try('[{"image_id":"b1000000-0000-0000-0000-000000000001","caption":"c","keyed_claim_ids":["c1000000-0000-0000-0000-000000000003"]}]') LIKE 'uncited_keyed_claim: photos b1000000%';
 ASSERT pg_temp.try('[{"image_id":"b2000000-0000-0000-0000-000000000002","caption":"c","keyed_claim_ids":["c1000000-0000-0000-0000-000000000001"]}]') LIKE 'uncited_keyed_claim: photos b2000000%';
 ASSERT pg_temp.try('[{"image_id":"b3000000-0000-0000-0000-000000000003","caption":"c","keyed_claim_ids":["c1000000-0000-0000-0000-000000000004"]}]') LIKE 'uncited_keyed_claim: photos b3000000%';
 ASSERT pg_temp.try('[{"image_id":"b4000000-0000-0000-0000-000000000004","caption":"c","keyed_claim_ids":["c1000000-0000-0000-0000-000000000005"]}]') LIKE 'uncited_keyed_claim: photos b4000000%';
 ASSERT pg_temp.try('[{"image_id":"b1000000-0000-0000-0000-000000000001","caption":"c","keyed_claim_ids":["c1000000-0000-0000-0000-000000000001","not-an-id"]}]') LIKE 'uncited_keyed_claim: photos b1000000%';
 ASSERT pg_temp.try('[{"image_id":"b1000000-0000-0000-0000-000000000001","caption":"c","keyed_claim_ids":[7]}]') LIKE 'uncited_keyed_claim: photos b1000000%';
 ASSERT pg_temp.try('[{"image_id":"b1000000-0000-0000-0000-000000000001","caption":"c","keyed_claim_ids":"c1000000-0000-0000-0000-000000000001"}]') LIKE 'uncited_keyed_claim: photos b1000000%';
 -- Several unconnected photos are named together, sorted, each once.
 r:=pg_temp.try('[{"image_id":"b2000000-0000-0000-0000-000000000002","caption":"c","keyed_claim_ids":["x"]},{"image_id":"b1000000-0000-0000-0000-000000000001","caption":"c"},{"image_id":"b1000000-0000-0000-0000-000000000001","caption":"d"}]');
 ASSERT r LIKE 'uncited_keyed_claim: photos b1000000-0000-0000-0000-000000000001, b2000000-0000-0000-0000-000000000002.%',r;
 -- The earlier guards still speak first; a record with no photo list and other observations pass.
 ASSERT pg_temp.try('[{"image_id":"b1000000-0000-0000-0000-000000000001","caption":"c"}]','{"materials":[{"system_key":"brakes"}]}') LIKE 'unregistered_system_key: brakes.%';
 ASSERT pg_temp.try('[{"image_id":"b1000000-0000-0000-0000-000000000001","caption":"c"}]','{"materials":[{"system_key":"engine"}]}') LIKE 'unregistered_part_key:%';
 ASSERT pg_temp.try('"none"')='admitted';
 INSERT INTO vehicle_observations(vehicle_id,kind,extraction_method,structured_data) VALUES ('a1000000-0000-0000-0000-000000000001','media','reviewed_image_analysis_v1',
  '{"visual_sources":[{"image_id":"b1000000-0000-0000-0000-000000000001"}]}');
 ASSERT NOT has_function_privilege('anon','public.visual_work_uncited_keyed_photos(uuid,jsonb)','execute');
END $$;
\echo visual work keyed claim citation guard: ok
