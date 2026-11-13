\set ON_ERROR_STOP on
DO $$ BEGIN
  IF to_regclass('public.vehicle_images') IS NOT NULL THEN RAISE EXCEPTION 'needs an empty disposable database'; END IF;
END $$;
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('CREATE ROLE %I NOLOGIN', r); END IF;
  END LOOP;
END $$;
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text, schedule text, command text);
CREATE FUNCTION cron.schedule(job text, sched text, cmd text) RETURNS bigint LANGUAGE sql AS
  $$ INSERT INTO cron.job (jobname, schedule, command) VALUES (job, sched, cmd) RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(j bigint) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobid = j RETURNING true $$;
CREATE TABLE public.platform_config (config_key text PRIMARY KEY, config_value jsonb, description text);
CREATE TABLE public.vehicle_images (
  id uuid PRIMARY KEY, user_id uuid, vehicle_id uuid, image_url text, created_at timestamptz NOT NULL DEFAULT now(),
  is_duplicate boolean, is_sensitive boolean, is_external boolean, is_superseded boolean, vision_gate_status text,
  ai_processing_status text, ai_processing_started_at timestamptz, ai_scan_metadata jsonb, exif_data jsonb);
CREATE TABLE public.photo_pipeline_provider_state (provider text PRIMARY KEY, blocked_until timestamptz);
INSERT INTO public.photo_pipeline_provider_state VALUES ('classifier', NULL);
CREATE TABLE public.photo_pipeline_retry_state (image_id uuid PRIMARY KEY, terminal boolean NOT NULL DEFAULT false, next_attempt_at timestamptz);

\ir ../migrations/20261113110000_image_stage_receipts_reconciler.sql
-- The tables model_gain reads, shaped as in production for the columns it uses.
CREATE TABLE public.observation_properties (id uuid PRIMARY KEY, property_key text);
CREATE TABLE public.vehicle_observations (id uuid PRIMARY KEY, vehicle_id uuid, kind text, extraction_method text, structured_data jsonb,
  is_superseded boolean DEFAULT false, descriptor_id uuid, property_id uuid, observed_at timestamptz);
CREATE TABLE public.observation_witnesses (observation_id uuid REFERENCES public.vehicle_observations(id), image_id uuid, witness_role text);
CREATE TABLE public.schema_proposals (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text, motivating_observation_ids uuid[]);
CREATE TEMP TABLE before_gain AS SELECT public.image_stage_coverage() AS c,
 md5(pg_get_functiondef('public.image_stage_coverage()'::regprocedure)) AS def;
ALTER TABLE public.vehicle_images ADD COLUMN taken_at timestamptz;
INSERT INTO public.vehicle_images (id, vehicle_id) VALUES
 ('b1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001'),('b2000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000001'),
 ('b3000000-0000-0000-0000-000000000003','a1000000-0000-0000-0000-000000000001'),('b4000000-0000-0000-0000-000000000004','a1000000-0000-0000-0000-000000000001'),
 ('b6000000-0000-0000-0000-000000000006','a1000000-0000-0000-0000-000000000001'),('b5000000-0000-0000-0000-000000000005','a2000000-0000-0000-0000-000000000002');
-- The photos' own capture times: b1 and b2 on the 28th, b3 on the 29th, b4 on the 28th, b7 unknown.
UPDATE public.vehicle_images SET taken_at = '2026-10-28T10:00:00Z' WHERE id IN ('b1000000-0000-0000-0000-000000000001','b4000000-0000-0000-0000-000000000004');
UPDATE public.vehicle_images SET taken_at = '2026-10-28T23:30:00Z' WHERE id = 'b2000000-0000-0000-0000-000000000002';
UPDATE public.vehicle_images SET taken_at = '2026-10-29T10:00:00Z' WHERE id = 'b3000000-0000-0000-0000-000000000003';
INSERT INTO public.vehicle_images (id, vehicle_id) VALUES ('b7000000-0000-0000-0000-000000000007','a1000000-0000-0000-0000-000000000001');
INSERT INTO public.observation_properties VALUES ('aa000000-0000-0000-0000-000000000001', 'image_visible_paint_stage');
-- Vehicle a1. k1,k2: the same descriptor, part and day on two photos (one fold of two).
-- k3: the same descriptor on another day (its own fold). k4: a property value, alone, cited by a work record.
-- ka,kb: keyed, same descriptor and part, on a photo with no capture time. k5: superseded keyed row. u1,u2: witnessed, unkeyed, one method each. n1: keyed, no witness. Vehicle a2: one keyed row.
INSERT INTO public.vehicle_observations (id, vehicle_id, kind, extraction_method, structured_data, is_superseded, descriptor_id, property_id, observed_at) VALUES
 ('c1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','condition','photo_map_harvest_v1','{"part_key":"engine.block"}',false,'dd000000-0000-0000-0000-000000000001',NULL,'2026-11-11T04:00:00Z'),
 ('c1000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000001','condition','photo_map_harvest_v1','{"part_key":"engine.block"}',false,'dd000000-0000-0000-0000-000000000001',NULL,'2026-11-11T04:00:00Z'),
 ('c1000000-0000-0000-0000-000000000003','a1000000-0000-0000-0000-000000000001','condition','photo_map_harvest_v1','{"part_key":"engine.block"}',false,'dd000000-0000-0000-0000-000000000001',NULL,'2026-11-11T04:00:00Z'),
 ('c1000000-0000-0000-0000-000000000004','a1000000-0000-0000-0000-000000000001','condition','image_property_projection','{"image_visible_paint_stage":"primer"}',false,NULL,'aa000000-0000-0000-0000-000000000001','2026-10-28T10:00:00Z'),
 ('c1000000-0000-0000-0000-000000000005','a1000000-0000-0000-0000-000000000001','condition','photo_map_harvest_v1','{}',true,'dd000000-0000-0000-0000-000000000001',NULL,'2026-10-28T10:00:00Z'),
 ('c1000000-0000-0000-0000-000000000006','a1000000-0000-0000-0000-000000000001','specification','cowl_tag_decode_v1','{}',false,NULL,NULL,'2026-10-28T10:00:00Z'),
 ('c1000000-0000-0000-0000-000000000007','a1000000-0000-0000-0000-000000000001','media','reviewed_image_analysis_v1','{}',false,NULL,NULL,'2026-10-28T10:00:00Z'),
 ('c1000000-0000-0000-0000-000000000008','a1000000-0000-0000-0000-000000000001','condition','photo_map_harvest_v1','{}',false,'dd000000-0000-0000-0000-000000000001',NULL,'2026-10-28T10:00:00Z'),
 ('c1000000-0000-0000-0000-000000000009','a2000000-0000-0000-0000-000000000002','condition','photo_map_harvest_v1','{}',false,'dd000000-0000-0000-0000-000000000001',NULL,'2026-10-28T10:00:00Z'),
 ('c1000000-0000-0000-0000-00000000000a','a1000000-0000-0000-0000-000000000001','condition','photo_map_harvest_v1','{"part_key":"engine.block"}',false,'dd000000-0000-0000-0000-000000000001',NULL,'2026-11-11T04:00:00Z'),
 ('c1000000-0000-0000-0000-00000000000b','a1000000-0000-0000-0000-000000000001','condition','photo_map_harvest_v1','{"part_key":"engine.block"}',false,'dd000000-0000-0000-0000-000000000001',NULL,'2026-11-11T04:00:00Z'),
 ('e1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','work_record','visual_work_v1',
   '{"contract":"visual_work_v1","visual_sources":[{"image_id":"b4000000-0000-0000-0000-000000000004","keyed_claim_ids":["c1000000-0000-0000-0000-000000000004"]}]}',false,NULL,NULL,'2026-11-01T10:00:00Z'),
 ('e1000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000001','work_record','visual_work_v1',
   '{"contract":"visual_work_v1","visual_sources":[{"image_id":"b3000000-0000-0000-0000-000000000003","keyed_claim_ids":["c1000000-0000-0000-0000-000000000003"]}]}',true,NULL,NULL,'2026-11-01T10:00:00Z');
INSERT INTO public.observation_witnesses VALUES
 ('c1000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001','derived'),
 ('c1000000-0000-0000-0000-000000000002','b2000000-0000-0000-0000-000000000002','derived'),
 ('c1000000-0000-0000-0000-000000000003','b3000000-0000-0000-0000-000000000003','derived'),
 ('c1000000-0000-0000-0000-000000000004','b4000000-0000-0000-0000-000000000004','derived'),
 ('c1000000-0000-0000-0000-000000000004','b4000000-0000-0000-0000-000000000004','primary'),
 ('c1000000-0000-0000-0000-000000000005','b1000000-0000-0000-0000-000000000001','derived'),
 ('c1000000-0000-0000-0000-000000000006','b1000000-0000-0000-0000-000000000001','derived'),
 ('c1000000-0000-0000-0000-000000000007','b2000000-0000-0000-0000-000000000002','derived'),
 ('c1000000-0000-0000-0000-000000000009','b5000000-0000-0000-0000-000000000005','derived'),
 ('c1000000-0000-0000-0000-00000000000a','b7000000-0000-0000-0000-000000000007','derived'),
 ('c1000000-0000-0000-0000-00000000000b','b7000000-0000-0000-0000-000000000007','derived');
INSERT INTO public.schema_proposals (status, motivating_observation_ids) VALUES
 ('open', ARRAY['c1000000-0000-0000-0000-000000000006'::uuid]), ('open', NULL), ('approved', ARRAY['c1000000-0000-0000-0000-000000000006'::uuid]),
 ('withdrawn', NULL), ('under_review', ARRAY['f9000000-0000-0000-0000-000000000009'::uuid]);
\ir ../migrations/20261116042000_image_stage_coverage_model_gain.sql
DO $$ DECLARE c jsonb; g jsonb; BEGIN
 -- The library reader is exactly as it was: same definition, same answer.
 ASSERT (SELECT def FROM before_gain) = md5(pg_get_functiondef('public.image_stage_coverage()'::regprocedure)), 'the no-argument reader is untouched';
 ASSERT (public.image_stage_coverage() - 'checked_at') = ((SELECT b.c FROM before_gain b) - 'checked_at');
 c := public.image_stage_coverage('a1000000-0000-0000-0000-000000000001'); g := c -> 'model_gain';
 ASSERT c ->> 'vehicle_id' = 'a1000000-0000-0000-0000-000000000001' AND c ->> 'logic_version' = 'image_stage_coverage(vehicle)/20261116042000', c::text;
 -- This vehicle only: six photos, five of them witnessed.
 ASSERT (g ->> 'photos')::int = 6 AND (g ->> 'photos_witnessed')::int = 5, g::text;
 -- Witnessed: current rows with a witness (k1-k4, u1, u2); a row with two witness roles counts once;
 -- the superseded row, the unwitnessed keyed row and the other vehicle's row do not count.
 ASSERT (g ->> 'witnessed_observations')::int = 8 AND (g ->> 'keyed')::int = 6 AND (g ->> 'unkeyed')::int = 2, g::text;
 -- Folds follow the photos' capture days, not the readings' clocks. All five descriptor rows were recorded at the
 -- same instant: the two photos of the 28th fold, the photo of the 29th stands apart, and the two rows on a photo
 -- with no capture time fold with nothing, each its own claim. Plus the property value.
 ASSERT (g ->> 'keyed_with_unknown_capture_day')::int = 2, g::text;
 ASSERT (g ->> 'folded_claims')::int = 5 AND (g ->> 'claims_carried_by_2plus_rows')::int = 1, g::text;
 -- Connected: the two rows that fold together, and the row a current work record cites. A superseded record's citation does not count.
 ASSERT (g ->> 'connected_rows')::int = 3 AND (g ->> 'cited_by_a_work_record')::int = 1, g::text;
 -- Proven is reported, as zero, with the reason.
 ASSERT (g ->> 'proven')::int = 0 AND g ->> 'proven_basis' LIKE 'no store records%', g::text;
 ASSERT g -> 'unkeyed_by_method' = '{"cowl_tag_decode_v1":1,"reviewed_image_analysis_v1":1}'::jsonb, g::text;
 -- One unresolved proposal was forced by a witnessed reading of this vehicle.
 ASSERT (g ->> 'open_proposals_citing_a_witnessed_reading')::int = 1, g::text;
 -- The other vehicle, and one with nothing: their own counts, zeros not nulls.
 g := public.image_stage_coverage('a2000000-0000-0000-0000-000000000002') -> 'model_gain';
 ASSERT (g ->> 'photos')::int = 1 AND (g ->> 'witnessed_observations')::int = 1 AND (g ->> 'keyed')::int = 1 AND (g ->> 'connected_rows')::int = 0, g::text;
 g := public.image_stage_coverage('a9000000-0000-0000-0000-000000000009') -> 'model_gain';
 ASSERT (g ->> 'photos')::int = 0 AND (g ->> 'witnessed_observations')::int = 0 AND (g ->> 'folded_claims')::int = 0
   AND g -> 'unkeyed_by_method' = '{}'::jsonb, g::text;
 ASSERT NOT has_function_privilege('anon', 'public.image_stage_coverage(uuid)', 'execute')
   AND NOT has_function_privilege('authenticated', 'public.image_stage_coverage(uuid)', 'execute')
   AND has_function_privilege('service_role', 'public.image_stage_coverage(uuid)', 'execute');
END $$;
\echo image stage coverage model gain: ok
