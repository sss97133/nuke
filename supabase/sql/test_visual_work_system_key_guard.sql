-- Empty local fixture only. The actual guard migration against synthetic records shaped like the
-- records read on the proof vehicle on 2026-11-11. No production observation is imported.
\set ON_ERROR_STOP on
DO $$ BEGIN IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicle_observations') IS NOT NULL
 THEN RAISE EXCEPTION 'Requires an empty disposable dm_refinement_ database'; END IF; END $$;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE subject_taxonomy(subject_key text PRIMARY KEY,category text,is_active boolean DEFAULT true);
INSERT INTO subject_taxonomy VALUES ('engine.block','engine',true),('trim.grille','trim',NULL),
 ('undercarriage.frame','undercarriage',true),('retired.thing','retired',false);
CREATE TABLE vehicle_observations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),kind text,extraction_method text,
 structured_data jsonb,is_superseded boolean DEFAULT false);
-- Before the guard: a minted key lands, which is the gap.
INSERT INTO vehicle_observations(kind,extraction_method,structured_data) VALUES ('work_record','visual_work_v1',
 '{"contract":"visual_work_v1","materials":[{"system_key":"brakes"}],"operations":[]}');
\ir ../migrations/20261113170000_visual_work_system_key_guard.sql
CREATE FUNCTION pg_temp.try(p_method text,p_doc jsonb) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO public.vehicle_observations(kind,extraction_method,structured_data) VALUES ('work_record',p_method,p_doc);
 RETURN 'admitted';
EXCEPTION WHEN check_violation THEN RETURN SQLERRM;
END $$;
DO $$ DECLARE r text; BEGIN
 ASSERT (SELECT count(*) FROM vehicle_observations)=1,'the stored row is left alone';
 -- Registered categories pass, on both line kinds.
 ASSERT pg_temp.try('visual_work_v1','{"materials":[{"system_key":"engine"}],"operations":[{"system_key":"trim"}]}')='admitted';
 -- A record with no cost lines passes.
 ASSERT pg_temp.try('visual_work_v1','{"contract":"visual_work_v1","title":"x"}')='admitted';
 -- Minted keys are refused together, sorted, with the legal moves in the message.
 r:=pg_temp.try('visual_work_v1','{"materials":[{"system_key":"cooling"},{"system_key":"engine"}],"operations":[{"system_key":"brakes"}]}');
 ASSERT r LIKE 'unregistered_system_key: brakes, cooling.%' AND r LIKE '%key_proposals%',r;
 -- The contract field alone is enough to be checked.
 ASSERT pg_temp.try('other','{"contract":"visual_work_v1","materials":[{"system_key":"brakes"}]}') LIKE 'unregistered_system_key: brakes.%';
 -- A category no active row uses is not a place.
 ASSERT pg_temp.try('visual_work_v1','{"materials":[{"system_key":"retired"}]}') LIKE 'unregistered_system_key: retired.%';
 -- A declared draft is admitted: nearest existing category, or none, and a reason.
 ASSERT pg_temp.try('visual_work_v1','{"materials":[{"system_key":"brakes"},{"system_key":"cooling"}],"key_proposals":[
   {"kind":"system","key":"brakes","nearest_existing":"undercarriage","reason":"hydraulics and friction parts are not a location"},
   {"kind":"system","key":"cooling","nearest_existing":"none","reason":"radiator, hoses and shroud"}]}')='admitted';
 -- A draft that names no reason, a nearest key the registry does not hold, or another kind is not a draft.
 ASSERT pg_temp.try('visual_work_v1','{"materials":[{"system_key":"brakes"}],"key_proposals":[{"kind":"system","key":"brakes","nearest_existing":"none","reason":" "}]}') LIKE 'unregistered%';
 ASSERT pg_temp.try('visual_work_v1','{"materials":[{"system_key":"brakes"}],"key_proposals":[{"kind":"system","key":"brakes","nearest_existing":"stopping","reason":"r"}]}') LIKE 'unregistered%';
 ASSERT pg_temp.try('visual_work_v1','{"materials":[{"system_key":"brakes"}],"key_proposals":[{"kind":"part","key":"brakes","nearest_existing":"none","reason":"r"}]}') LIKE 'unregistered%';
 ASSERT pg_temp.try('visual_work_v1','{"materials":[{"system_key":"brakes"}],"key_proposals":"brakes"}') LIKE 'unregistered%';
 -- Other observations are not touched.
 ASSERT pg_temp.try('reviewed_image_analysis_v1','{"materials":[{"system_key":"brakes"}]}')='admitted';
 ASSERT pg_temp.try(NULL,NULL)='admitted';
 ASSERT NOT has_function_privilege('anon','public.visual_work_unplaced_system_keys(jsonb)','execute');
END $$;
\echo visual work system key guard: ok
