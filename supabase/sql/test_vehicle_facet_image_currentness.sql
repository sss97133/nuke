-- Disposable PG17: reuse the established facet fixture unchanged, then exercise
-- the public-gallery witness repair with SELECT-only source counterfactuals.
\set ON_ERROR_STOP on
\ir test_vehicle_facet_items.sql
-- The included contract ends with RESET ROLE after its anonymous read.
RESET ROLE;

-- This fixture predates the production public image view and pointer columns.
-- Add their shape without changing any testimony row.
ALTER TABLE public.vehicle_observations ADD COLUMN superseded_by uuid;
ALTER TABLE public.vehicle_images ADD COLUMN is_document boolean DEFAULT false;
ALTER TABLE public.vehicle_images ADD COLUMN superseded_by uuid;
ALTER TABLE public.vehicle_images ADD COLUMN exif_data jsonb;
CREATE VIEW public.vehicle_images_public WITH (security_invoker = true) AS
  SELECT id, vehicle_id, image_url, thumbnail_url, medium_url, is_sensitive, is_document,
    is_duplicate, is_superseded, superseded_by, vision_gate_status, image_vehicle_match_status
  FROM public.vehicle_images;
CREATE FUNCTION public.vehicle_image_gallery_eligible(public.vehicle_images_public)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT ($1).is_document IS NOT TRUE AND ($1).is_duplicate IS NOT TRUE AND ($1).is_superseded IS NOT TRUE
    AND ($1).image_url IS NOT NULL AND ($1).image_url NOT LIKE 'file://%'
    AND coalesce(($1).image_vehicle_match_status, '') NOT IN ('mismatch', 'unrelated')
    AND coalesce(($1).vision_gate_status, 'approved') = 'approved' $$;
GRANT SELECT ON public.vehicle_images_public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vehicle_image_gallery_eligible(public.vehicle_images_public)
  TO anon, authenticated, service_role;
-- Model production's restricted base columns: the overload must accept the
-- view row, not `vehicle_images.*` (which includes ungranted EXIF).
REVOKE SELECT ON public.vehicle_images FROM anon, authenticated;
GRANT SELECT (id, vehicle_id, image_url, thumbnail_url, medium_url, is_sensitive,
  is_document, is_duplicate, is_superseded, superseded_by, vision_gate_status,
  image_vehicle_match_status, taken_at, latitude, longitude)
  ON public.vehicle_images TO anon, authenticated;

\ir ../migrations/20261117000400_vehicle_facet_image_witness_currentness.sql
\ir ../migrations/20261117000400_vehicle_facet_image_witness_currentness.sql

SET ROLE anon;
SET test.auth_role = 'anon';
RESET test.auth_uid;
DO $$
DECLARE item jsonb;
BEGIN
  PERFORM public.t_assert((SELECT reloptions @> ARRAY['security_invoker=true']
    FROM pg_class WHERE oid = 'public.vehicle_images_public'::regclass), 'public image view stays invoker');
  PERFORM public.t_assert(has_table_privilege('anon', 'public.vehicle_images_public', 'SELECT')
    AND has_function_privilege('anon', 'public.vehicle_image_gallery_eligible(public.vehicle_images_public)', 'EXECUTE'),
    'anonymous view and gallery overload remain callable');
  item := public.t_item('10000000-0000-0000-0000-000000000001', 'engine', 'engine.current.block_casting');
  PERFORM public.t_assert(item->>'value' = '9990002' AND item->>'status' = 'reading'
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(item->'sources') src
      WHERE src#>>'{witness,kind}' = 'image' AND src#>>'{witness,id}' = '50000000-0000-0000-0000-00000000000a'
        AND src#>>'{witness,thumb}' = 'https://x.invalid/t.jpg'),
    'exact current engine image survives with source and thumbnail under anon');
END $$;

-- Only synthetic composites are changed below. No stored image, observation,
-- or field evidence row is updated to test the rejection predicate.
WITH source AS (
  SELECT i AS image_row FROM public.vehicle_images_public i
  WHERE i.id = '50000000-0000-0000-0000-00000000000a'::uuid
), cases(name, change, same_vehicle) AS (VALUES
  ('positive', '{}'::jsonb, true),
  ('foreign', '{"vehicle_id":"10000000-0000-0000-0000-000000000002"}'::jsonb, false),
  ('sensitive', '{"is_sensitive":true}'::jsonb, false),
  ('document', '{"is_document":true}'::jsonb, false),
  ('duplicate', '{"is_duplicate":true}'::jsonb, false),
  ('withdrawn_flag', '{"is_superseded":true}'::jsonb, false),
  ('withdrawn_pointer', '{"superseded_by":"50000000-0000-0000-0000-000000000099"}'::jsonb, false),
  ('mismatch', '{"image_vehicle_match_status":"mismatch"}'::jsonb, false)
), qualified AS (
  SELECT c.name, c.same_vehicle,
    public.vehicle_image_gallery_eligible(x.image) IS TRUE
      AND (x.image).vehicle_id = '10000000-0000-0000-0000-000000000001'::uuid
      AND (x.image).is_sensitive IS NOT TRUE AND (x.image).is_document IS NOT TRUE
      AND (x.image).is_duplicate IS NOT TRUE AND (x.image).is_superseded IS NOT TRUE
      AND (x.image).superseded_by IS NULL AS allowed
  FROM source s CROSS JOIN cases c
  CROSS JOIN LATERAL (SELECT jsonb_populate_record(NULL::public.vehicle_images_public,
    to_jsonb(s.image_row) || c.change) AS image) x
)
SELECT public.t_assert(count(*) = 8 AND bool_and(allowed = same_vehicle),
  'public gallery and explicit gates reject synthetic foreign, private, duplicate, document, and withdrawn sources')
FROM qualified;
RESET ROLE;
SELECT 'vehicle facet image currentness: PASS' AS result;
