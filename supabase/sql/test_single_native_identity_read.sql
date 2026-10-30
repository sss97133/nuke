-- Real protected intake, privacy/lineage owners, then singleton reading-only.
-- The included fixture requires an empty disposable PostgreSQL17 database.
\set ON_ERROR_STOP on
\i supabase/sql/test_private_subject_source_qualification.sql
RESET ROLE;
CREATE TEMP TABLE singleton_acl AS SELECT proacl,proowner FROM pg_proc WHERE
 oid='public.ingest_image_observation(uuid,uuid,text,numeric,text,text,jsonb,boolean,jsonb)'::regprocedure;
CREATE TEMP TABLE singleton_clusters AS SELECT count(*)n FROM emergent_vehicle_clusters;
\i supabase/migrations/20261030205709_retain_single_native_identifier_read.sql
CREATE FUNCTION pg_temp.single_native_read() RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.reading_envelope() || jsonb_build_object(
  'run_key','70000000-0000-4000-8000-000000000001','provider','Apple Vision (on-device)',
  'model','vehicle-identity-context-fold-v3:single',
  'inputs',jsonb_build_array((SELECT i FROM jsonb_array_elements(pg_temp.reading_envelope()->'inputs')i
    WHERE i->>'image_id'=pg_temp.u('corvette')::text)),
  'raw_model_reading',jsonb_build_object('kind','on_device_identity_read_v1',
   'identity_run_id','70000000-0000-4000-8000-000000000001',
   'identity_method_version','vehicle-identity-context-fold-v3:single',
   'observations',jsonb_build_array(jsonb_build_object('image_id',pg_temp.u('corvette'),
    'is_document',false,'is_vehicle',false,'vin_candidates',jsonb_build_array('1HGCM82633A004352')))))
$$;
SELECT pg_temp.reading(pg_temp.single_native_read()) AS id \gset singleton_
SELECT pg_temp.ok('one retained native identifier has no vehicle or subject membership',
 EXISTS(SELECT FROM image_observations WHERE id=:'singleton_id'::uuid AND vehicle_id IS NULL AND cluster_id IS NULL
  AND role='part' AND observed_by='visual_subject_reading_v1')
 AND (SELECT count(*) FROM emergent_vehicle_clusters)=(SELECT n FROM singleton_clusters));
SELECT pg_temp.ok('singleton retry reuses the same retained reading',
 pg_temp.reading(pg_temp.single_native_read())=:'singleton_id'::uuid);
SELECT pg_temp.refuses_reading('a generic model reading cannot use the singleton native exception',
 pg_temp.single_native_read()-'raw_model_reading');
SELECT pg_temp.refuses_reading('one source cannot assert graph subjects',
 jsonb_set(pg_temp.single_native_read(),'{subjects}',jsonb_build_array(jsonb_build_object('anchor_image_id',pg_temp.u('corvette')))));
SELECT pg_temp.refuses_reading('the source hash must still match current retained bytes',
 jsonb_set(pg_temp.single_native_read(),'{inputs,0,source_sha256}',to_jsonb(repeat('0',64))));
SELECT pg_temp.refuses_reading('provider metadata is pinned for this native-only exception',
 jsonb_set(pg_temp.single_native_read(),'{provider}','"other provider"'));
SELECT pg_temp.refuses_reading('native method revision cannot be substituted',
 jsonb_set(pg_temp.single_native_read(),'{raw_model_reading,identity_method_version}','"other"'));
SELECT pg_temp.refuses_reading('the retained native run must match its envelope',
 jsonb_set(pg_temp.single_native_read(),'{raw_model_reading,identity_run_id}',to_jsonb(gen_random_uuid()::text)));
SELECT pg_temp.ok('singleton reading does not change protected intake grants or owner',
 (SELECT p.proacl IS NOT DISTINCT FROM a.proacl AND p.proowner=a.proowner FROM pg_proc p CROSS JOIN singleton_acl a
 WHERE p.oid='public.ingest_image_observation(uuid,uuid,text,numeric,text,text,jsonb,boolean,jsonb)'::regprocedure));
\i supabase/migrations/20261030205709_retain_single_native_identifier_read.sql
