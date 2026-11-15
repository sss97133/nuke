BEGIN;
SET LOCAL statement_timeout = '8s';
SET LOCAL lock_timeout = '2s';

-- Supersession is recorded by either the flag or successor pointer. Keep the
-- existing scoped scalar/region contract; do not add whole-parent hash binding.
-- This owner is shared by guarded admission, replay and the component fold.
DO $migration$
DECLARE
 definition text := pg_get_functiondef('public.component_reading_matches(public.vehicle_observations,public.vehicle_observations,public.vehicle_images)'::regprocedure);
 child_guard text := 'OR c.is_superseded IS DISTINCT FROM false';
 parent_guard text := 'OR p.is_superseded IS DISTINCT FROM false';
 image_guard text := 'OR public.vehicle_image_gallery_eligible(i) IS DISTINCT FROM true';
BEGIN
 IF position(child_guard IN definition)=0 OR position(parent_guard IN definition)=0 OR position(image_guard IN definition)=0 THEN
  RAISE EXCEPTION 'component_reading_matches currentness guard changed; review required';
 END IF;
 IF position('c.superseded_by IS NOT NULL' IN definition)=0 THEN
  definition:=replace(definition,child_guard,child_guard||' OR c.superseded_by IS NOT NULL');
 END IF;
 IF position('p.superseded_by IS NOT NULL' IN definition)=0 THEN
  definition:=replace(definition,parent_guard,parent_guard||' OR p.superseded_by IS NOT NULL');
 END IF;
 IF position('i.superseded_by IS NOT NULL' IN definition)=0 THEN
  definition:=replace(definition,image_guard,image_guard||' OR i.superseded_by IS NOT NULL');
 END IF;
 EXECUTE definition;
END $migration$;

COMMIT;
