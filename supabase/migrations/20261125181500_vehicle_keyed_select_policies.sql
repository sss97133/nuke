-- image_tags, ai_scan_sessions: rows keyed to a vehicle (and, for a tag, optionally to a photo) are readable only where
-- that vehicle or photo is shown, by the row's creator, or by a caller tied to the vehicle.
--
-- Measured 2026-11-25 on production (pg_policy, cron private-row-exposure-watch 08:41 UTC):
--   image_tags        three open SELECT policies, "Image tags are publicly viewable" (TO public USING (true)),
--                     "Public tag reading" (TO anon, authenticated USING (true)) and image_tags_select_all (TO public
--                     USING (true)). 3,263 rows, all with image_id NULL and vehicle_id set (the tag names its photo by
--                     image_url); 274 sit on a private or deleted car.
--   ai_scan_sessions  "Public can view scan sessions" FOR SELECT TO public USING (true). ~632k rows, all with vehicle_id
--                     set, 97 with created_by. No page, edge function or anon-executable SQL function reads it
--                     (git grep, pg_proc on 2026-11-25); get_vehicle_ai_stats is SECURITY DEFINER.
--   The hourly assay read 50 of 50 sampled private rows (rows on a private or deleted car) as anon and as a signed-in
--   stranger on both tables.
--
-- image_tags_select (TO public): a tag is readable when
--   (a) it names no photo and its vehicle is_public = true AND deleted_at IS NULL (public car pages keep every tag:
--       2,989 of 3,263 rows), or it names a photo that is shown (vehicle_image_gallery_eligible on the photo's
--       vehicle_images_public row, photo's vehicle public and undeleted; the photo's vehicle decides, not the stamp);
--   (b) the caller created it (created_by = auth.uid()::text, the column the insert and update policies already test),
--       so a tagger keeps reading, updating and deleting its own tags (INSERT ... RETURNING needs SELECT on the row);
--   (c) the caller is vehicle_viewer_tied to the tag's vehicle (no photo) or uploaded / is tied to the photo's vehicle.
-- ai_scan_sessions_select (TO authenticated): the caller created the session or is vehicle_viewer_tied to its vehicle.
--   A scan session (model, cost, photo id list) is the operator's record, not a public reading; anon reads none.
--   ai_sessions_owner_policy (ALL, the vehicle's uploaded_by) and the service_role INSERT policy are unchanged.
-- Unchanged: every INSERT/UPDATE/DELETE policy and grant on both tables; service_role has BYPASSRLS.
-- One transaction: the open policies and their replacement swap with no moment without a SELECT policy.

SET statement_timeout = '30s';
SET lock_timeout = '5s';

BEGIN;

DROP POLICY IF EXISTS "Image tags are publicly viewable" ON public.image_tags;
DROP POLICY IF EXISTS "Public tag reading" ON public.image_tags;
DROP POLICY IF EXISTS image_tags_select_all ON public.image_tags;
DROP POLICY IF EXISTS image_tags_select ON public.image_tags;
CREATE POLICY image_tags_select ON public.image_tags FOR SELECT
  USING (
    (image_tags.image_id IS NULL
     AND EXISTS (
       SELECT 1 FROM public.vehicles v
       WHERE v.id = image_tags.vehicle_id AND v.is_public = true AND v.deleted_at IS NULL))
    OR (image_tags.image_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.vehicle_images_public vip
          JOIN public.vehicles v ON v.id = vip.vehicle_id
          WHERE vip.id = image_tags.image_id
            AND v.is_public = true
            AND v.deleted_at IS NULL
            AND public.vehicle_image_gallery_eligible(vip)))
    OR (
      (SELECT auth.uid()) IS NOT NULL
      AND (image_tags.created_by::text = (SELECT auth.uid())::text
           OR (image_tags.image_id IS NULL AND public.vehicle_viewer_tied(image_tags.vehicle_id))
           OR EXISTS (
             SELECT 1
             FROM public.vehicle_images vi
             WHERE vi.id = image_tags.image_id
               AND (vi.user_id = (SELECT auth.uid())
                    OR public.vehicle_viewer_tied(vi.vehicle_id)))))
  );
COMMENT ON POLICY image_tags_select ON public.image_tags IS
  'A tag is readable where its vehicle (no photo) or its photo (vehicle_image_gallery_eligible) is shown on a public, '
  'undeleted vehicle, by its creator, or by a caller vehicle_viewer_tied to the vehicle or uploader of the photo. '
  '20261125181500.';

DROP POLICY IF EXISTS "Public can view scan sessions" ON public.ai_scan_sessions;
DROP POLICY IF EXISTS ai_scan_sessions_select ON public.ai_scan_sessions;
CREATE POLICY ai_scan_sessions_select ON public.ai_scan_sessions FOR SELECT TO authenticated
  USING (
    (SELECT auth.uid()) IS NOT NULL
    AND (ai_scan_sessions.created_by = (SELECT auth.uid())
         OR public.vehicle_viewer_tied(ai_scan_sessions.vehicle_id))
  );
COMMENT ON POLICY ai_scan_sessions_select ON public.ai_scan_sessions IS
  'A scan session is readable by its creator or by a caller vehicle_viewer_tied to its vehicle. 20261125181500.';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policy p
             WHERE p.polrelid IN ('public.image_tags'::regclass, 'public.ai_scan_sessions'::regclass)
               AND p.polcmd IN ('r', '*') AND pg_get_expr(p.polqual, p.polrelid) = 'true'
               AND NOT p.polroles @> ARRAY['service_role'::regrole::oid]) THEN
    RAISE EXCEPTION 'an open SELECT policy is left on image_tags or ai_scan_sessions';
  END IF;
END $$;

COMMIT;
