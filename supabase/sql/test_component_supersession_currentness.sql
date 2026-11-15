-- Disposable contract only. Reuse the existing fixture unchanged; the additional
-- counterexamples below substitute composite values and never mutate testimony.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicles') IS NOT NULL THEN
  RAISE EXCEPTION 'Requires empty disposable dm_refinement_ database';
 END IF;
END $$;
\ir test_component_evidence.sql
-- Fixture compatibility only: production images already carry this pointer.
ALTER TABLE public.vehicle_images ADD COLUMN superseded_by uuid;
\ir ../migrations/20261117000300_component_supersession_pointer_currentness.sql

WITH fixture AS (
 SELECT p, c, i FROM public.vehicle_observations c
 JOIN public.vehicle_observations p ON p.id=c.source_observation_id
 JOIN public.vehicle_images i ON i.id=(c.structured_data->>'image_id')::uuid
 WHERE c.extraction_method='retained_component_reading_v1'
 AND public.component_reading_current(c.id)
 ORDER BY c.id LIMIT 1
), cases(label, parent_patch, child_patch, image_patch, expected) AS (VALUES
 ('current', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, true),
 ('parent pointer only', '{"superseded_by":"30000000-0000-4000-8000-000000000099"}'::jsonb, '{}'::jsonb, '{}'::jsonb, false),
 ('child pointer only', '{}'::jsonb, '{"superseded_by":"30000000-0000-4000-8000-000000000099"}'::jsonb, '{}'::jsonb, false),
 ('image pointer only', '{}'::jsonb, '{}'::jsonb, '{"superseded_by":"30000000-0000-4000-8000-000000000099"}'::jsonb, false),
 ('parent flag', '{"is_superseded":true}'::jsonb, '{}'::jsonb, '{}'::jsonb, false),
 ('child flag', '{}'::jsonb, '{"is_superseded":true}'::jsonb, '{}'::jsonb, false)
)
SELECT test_assert(public.component_reading_matches(
 jsonb_populate_record(NULL::public.vehicle_observations,to_jsonb(p)||parent_patch),
 jsonb_populate_record(NULL::public.vehicle_observations,to_jsonb(c)||child_patch),
 jsonb_populate_record(NULL::public.vehicle_images,to_jsonb(i)||image_patch)
 ) IS NOT DISTINCT FROM expected, label)
FROM fixture CROSS JOIN cases;
SELECT test_assert(EXISTS(SELECT 1 FROM public.vehicle_observations
 WHERE extraction_method='retained_component_reading_v1' AND public.component_reading_current(id)), 'counterexamples have a current fixture child');
SELECT test_assert(bool_or(public.component_reading_current(id)) IS TRUE, 'existing admitted fixture has current children')
FROM public.vehicle_observations WHERE extraction_method='retained_component_reading_v1';
SET ROLE anon;
SELECT test_assert(jsonb_array_length(public.vehicle_build_log_public(
 '10000000-0000-4000-8000-000000000001',false)#>'{component_evidence,components}')=3,
 'existing consumer retains three qualified components after matcher repair');
RESET ROLE;
SELECT 'component pointer currentness PASS' AS result;
