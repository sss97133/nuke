-- vehicle_images: restore the public read gate after the 2026-10-15 06:37Z migration replay.
-- A blank workflow_dispatch replayed June migrations and put "Users can view images for public vehicles" back to its
-- June body (EXISTS public vehicle only), so strangers could again read frames the vision gate rejected as personal or
-- misattributed, frames held for review, sensitive frames and superseded frames. 20261014021500 refuses to run on
-- that body (it guards against drift), so this sets the intended definition unconditionally and verifies it.
-- ALTER POLICY takes an ACCESS EXCLUSIVE lock on a hot table: short lock_timeout, retried by the deploy helper.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

BEGIN;

ALTER POLICY "Users can view images for public vehicles" ON public.vehicle_images
  USING (
    COALESCE(is_sensitive, false) = false
    AND COALESCE(is_superseded, false) = false
    AND (vision_gate_status IS NULL
         OR vision_gate_status NOT IN ('rejected_personal'::public.vision_gate_status,
                                       'rejected_misattributed'::public.vision_gate_status,
                                       'review_needed'::public.vision_gate_status))
    AND EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = vehicle_images.vehicle_id AND v.is_public = true)
  );

DO $verify$
DECLARE cur text;
BEGIN
  SELECT regexp_replace(pg_get_expr(p.polqual, p.polrelid), '\s+', '', 'g') INTO cur
    FROM pg_policy p
   WHERE p.polrelid = 'public.vehicle_images'::regclass
     AND p.polname = 'Users can view images for public vehicles';
  IF NOT (cur LIKE '%rejected_personal%' AND cur LIKE '%rejected_misattributed%' AND cur LIKE '%review_needed%'
          AND cur LIKE '%is_public=true%' AND cur LIKE '%COALESCE(is_sensitive,false)=false%'
          AND cur LIKE '%COALESCE(is_superseded,false)=false%') THEN
    RAISE EXCEPTION 'vehicle_images public policy did not take the gated definition: %', cur;
  END IF;
END
$verify$;

COMMIT;
