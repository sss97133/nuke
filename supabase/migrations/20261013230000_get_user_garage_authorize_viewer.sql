-- get_user_garage: authorize on the caller, not on the argument.
--
-- The reader was SECURITY DEFINER with no viewer check: any signed-in account could call it for
-- any user and receive that user's private and soft-deleted vehicles, the contributor bucket and
-- purchase prices (review 2026-10-13, HN_REVIEW_2.md finding 1; migration 20260709180000 revoked
-- anon and called that "NOT the root fix"). The owner's own view is unchanged. Everyone else gets
-- the web's public projection (VehicleCollection.tsx): vehicles held by an active owner or co_owner
-- permission or an approved title, public and not deleted, with no estimate and no purchase price.
--
-- Dry run against production before this file (read-only, reviewer 2026-10-13 22:54Z, user 0b9f107a…):
-- owner branch 130 rows with 35 purchase prices, exactly the live reader; stranger branch 5 rows,
-- no money, nothing private, nothing deleted. The service role (the books reconcile and the
-- image-attribution scripts call this reader with the service key, where auth.uid() is null)
-- keeps the full view. Grants are untouched (EXECUTE: authenticated, service_role).
-- Contract: supabase/sql/test_get_user_garage_viewer.sql (CI job get-user-garage-viewer-contract).

set lock_timeout = '5s';
set statement_timeout = '30s';

-- The live body this file was reviewed against (sha256 of prosrc, base64, 2026-10-13 23:01Z).
-- A different body means the reader changed since the review: stop, re-read, re-decide.
DO $guard$
DECLARE a text;
BEGIN
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') INTO a
    FROM pg_proc WHERE oid = 'public.get_user_garage(uuid)'::regprocedure;
  IF a <> '30GhW4oEYORkxO8alHMFW8iZUeW4vA3hC/BbdjCE6og=' THEN
    RAISE EXCEPTION 'get_user_garage differs from the reviewed definition (%)', a;
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.get_user_garage(p_user_id uuid)
 RETURNS TABLE(vehicle_id uuid, year integer, make text, model text, trim_name text, image_url text, current_value numeric, purchase_price numeric, image_count bigint, relationship text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- The owner, or the service role (no user id; the books and attribution scripts), sees everything.
  WITH viewer AS (SELECT coalesce(auth.uid() = p_user_id, false) OR coalesce(auth.role() = 'service_role', false) AS is_own),
  owned AS (
    -- The owner's own reader, as before: every relationship the record holds.
    SELECT vehicle_id, 1 pr FROM vehicle_ownerships WHERE owner_profile_id=p_user_id AND is_current=true AND (SELECT is_own FROM viewer)
    UNION SELECT vehicle_id, 2 FROM discovered_vehicles WHERE user_id=p_user_id AND is_active=true AND relationship_type='previously_owned' AND (SELECT is_own FROM viewer)
    UNION SELECT vehicle_id, 3 FROM vehicle_contributors WHERE user_id=p_user_id AND (SELECT is_own FROM viewer)
    -- Everyone else: the web's public projection.
    UNION SELECT vehicle_id, 1 FROM vehicle_user_permissions WHERE user_id=p_user_id AND revoked_at IS NULL AND role IN ('owner','co_owner') AND NOT (SELECT is_own FROM viewer)
    UNION SELECT vehicle_id, 1 FROM ownership_verifications WHERE user_id=p_user_id AND status='approved'
  ),
  dedup AS (SELECT vehicle_id, MIN(pr) pr FROM owned GROUP BY vehicle_id)
  SELECT v.id, v.year, v.make, v.model, v.trim,
         COALESCE(v.primary_image_url,
                  (SELECT vi2.image_url FROM vehicle_images vi2
                     WHERE vi2.vehicle_id = v.id AND vi2.image_url IS NOT NULL
                       -- the definer skips RLS and the vision gate; a stranger gets only an admitted frame
                       AND ((SELECT is_own FROM viewer) OR public.vehicle_image_gallery_eligible(vi2))
                     ORDER BY vi2.created_at LIMIT 1)),
         CASE WHEN (SELECT is_own FROM viewer) THEN
           (SELECT ne.estimated_value FROM nuke_estimates ne
              WHERE ne.vehicle_id = v.id AND ne.comp_method = 'class_stratified'
              ORDER BY ne.calculated_at DESC NULLS LAST LIMIT 1) END,
         CASE WHEN (SELECT is_own FROM viewer) THEN v.purchase_price END,
         COALESCE(v.image_count, 0)::bigint,
         CASE d.pr WHEN 1 THEN 'owner' WHEN 2 THEN 'previously_owned' ELSE 'contributor' END
  FROM dedup d JOIN vehicles v ON v.id=d.vehicle_id
  WHERE (SELECT is_own FROM viewer) OR (v.is_public = true AND v.deleted_at IS NULL)
  ORDER BY d.pr, v.year;
$function$;

COMMENT ON FUNCTION public.get_user_garage(uuid) IS
  'A user''s garage. The owner (auth.uid() = p_user_id) and the service role get every relationship with estimates and purchase prices; any other caller gets the public projection: owner/co_owner permission or approved title, public, not deleted, no money, admitted frames only. 2026-10-13.';
