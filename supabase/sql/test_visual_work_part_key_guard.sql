-- Empty local fixture only. Both guard migrations against synthetic records shaped like the
-- cost lines read on the proof vehicle on 2026-11-11. No production observation is imported.
\set ON_ERROR_STOP on
DO $$ BEGIN IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicle_observations') IS NOT NULL
 THEN RAISE EXCEPTION 'Requires an empty disposable dm_refinement_ database'; END IF; END $$;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE subject_taxonomy(subject_key text PRIMARY KEY,category text,is_active boolean DEFAULT true);
INSERT INTO subject_taxonomy VALUES ('engine.block','engine',true),('undercarriage.brake.line','undercarriage',NULL),
 ('retired.thing','engine',false);
CREATE TABLE vehicle_observations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),kind text,extraction_method text,
 structured_data jsonb,is_superseded boolean DEFAULT false);
\ir ../migrations/20261113170000_visual_work_system_key_guard.sql
-- Before the second guard: a line with a part number for a key and no part lands, which is the gap.
INSERT INTO vehicle_observations(kind,extraction_method,structured_data) VALUES ('work_record','visual_work_v1',
 '{"materials":[{"system_key":"engine","physical_material_key":"engine.part.fn419e"}]}');
\ir ../migrations/20261114101000_visual_work_part_key_guard.sql
CREATE FUNCTION pg_temp.try(p_method text,p_doc jsonb) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO public.vehicle_observations(kind,extraction_method,structured_data) VALUES ('work_record',p_method,p_doc);
 RETURN 'admitted';
EXCEPTION WHEN check_violation THEN RETURN SQLERRM;
END $$;
DO $$ DECLARE r text; BEGIN
 ASSERT (SELECT count(*) FROM vehicle_observations)=1,'the stored row is left alone';
 -- The same record is now refused, and the count of unkeyed lines is in the message with the legal moves.
 r:=pg_temp.try('visual_work_v1','{"materials":[{"system_key":"engine","physical_material_key":"engine.part.fn419e"}],"operations":[{"system_key":"engine"}]}');
 ASSERT r LIKE 'unregistered_part_key: (no part_key on 2 cost lines).%' AND r LIKE '%key_proposals%' AND r LIKE '%not_a_part%',r;
 -- Registry keys and the two closed answers pass, on both line kinds; the line id is not judged.
 ASSERT pg_temp.try('visual_work_v1','{"materials":[{"system_key":"engine","part_key":"engine.block","physical_material_key":"engine.part.fn419e"},
   {"system_key":"engine","part_key":"not_a_part"}],"operations":[{"system_key":"engine","part_key":"undercarriage.brake.line"},{"system_key":"engine","part_key":"cannot_tell"}]}')='admitted';
 -- A record with no cost lines passes.
 ASSERT pg_temp.try('visual_work_v1','{"contract":"visual_work_v1","title":"x"}')='admitted';
 -- A minted part key, a retired key, an empty or non-text key: refused, named, sorted, missing lines last.
 r:=pg_temp.try('visual_work_v1','{"materials":[{"system_key":"engine","part_key":"undercarriage.brake.rotor"},{"system_key":"engine","part_key":"retired.thing"},
   {"system_key":"engine","part_key":" "},{"system_key":"engine","part_key":7},{"system_key":"engine","part_key":null}]}');
 ASSERT r LIKE 'unregistered_part_key: retired.thing, undercarriage.brake.rotor, (no part_key on 3 cost lines).%',r;
 -- A padded registry key is not the registry's key: it is stored as written, so it is refused as written.
 ASSERT pg_temp.try('visual_work_v1','{"materials":[{"system_key":"engine","part_key":" engine.block "}]}') LIKE 'unregistered_part_key:  engine.block .%';
 ASSERT pg_temp.try('visual_work_v1','{"materials":[{"system_key":"engine","part_key":"not_a_part "}]}') LIKE 'unregistered_part_key: not_a_part .%';
 -- A declared draft is admitted: nearest existing subject key, or none, and a reason.
 ASSERT pg_temp.try('visual_work_v1','{"materials":[{"system_key":"engine","part_key":"undercarriage.brake.rotor"},{"system_key":"engine","part_key":"engine.carburetor"}],"key_proposals":[
   {"kind":"part","key":"undercarriage.brake.rotor","nearest_existing":"undercarriage.brake.line","reason":"the disc itself"},
   {"kind":"part","key":"engine.carburetor","nearest_existing":"none","reason":"no fuel-metering part is registered"}]}')='admitted';
 -- Not a draft: no reason, a nearest key the registry does not hold, a category in place of a subject key, another kind.
 ASSERT pg_temp.try('visual_work_v1','{"materials":[{"system_key":"engine","part_key":"x.y"}],"key_proposals":[{"kind":"part","key":"x.y","nearest_existing":"none","reason":""}]}') LIKE 'unregistered_part_key: x.y.%';
 ASSERT pg_temp.try('visual_work_v1','{"materials":[{"system_key":"engine","part_key":"x.y"}],"key_proposals":[{"kind":"part","key":"x.y","nearest_existing":"brake.disc","reason":"r"}]}') LIKE 'unregistered_part_key: x.y.%';
 ASSERT pg_temp.try('visual_work_v1','{"materials":[{"system_key":"engine","part_key":"x.y"}],"key_proposals":[{"kind":"part","key":"x.y","nearest_existing":"engine","reason":"r"}]}') LIKE 'unregistered_part_key: x.y.%';
 ASSERT pg_temp.try('visual_work_v1','{"materials":[{"system_key":"engine","part_key":"x.y"}],"key_proposals":[{"kind":"system","key":"x.y","nearest_existing":"none","reason":"r"}]}') LIKE 'unregistered_part_key: x.y.%';
 -- The first guard still speaks first.
 ASSERT pg_temp.try('visual_work_v1','{"materials":[{"system_key":"brakes"}]}') LIKE 'unregistered_system_key: brakes.%';
 -- Other observations are not touched.
 ASSERT pg_temp.try('reviewed_image_analysis_v1','{"materials":[{"system_key":"brakes"}]}')='admitted';
 ASSERT NOT has_function_privilege('anon','public.visual_work_unplaced_part_keys(jsonb)','execute');
END $$;
\echo visual work part key guard: ok
