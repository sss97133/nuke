-- Keep creator-only profiles discoverable without inventing title, contribution or value.
-- Existing title, previous-ownership and contribution relationships keep precedence.
-- Only the account itself and the existing service reader see the new profile_record bucket.
-- No table rows, function grants, signature or public-viewer projection are changed.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';
DO $guard$
DECLARE actual text;
BEGIN
  SELECT encode(sha256(convert_to(prosrc,'UTF8')),'base64') INTO actual
  FROM pg_proc WHERE oid='public.get_user_garage(uuid)'::regprocedure;
  IF actual IS NULL OR actual NOT IN (
    'WalZ33NFu9Vj8fq4n6OzMl7PyfeGHgf8xNTLvcl2hrw=',
    'nY5tJfoq0Y7v5IjNJ0TIW02u07YDvFzHjy3MU9AIP3A='
  ) THEN
    RAISE EXCEPTION 'get_user_garage differs from reviewed reader (%)', actual;
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
    -- Creating a profile relates it to this account; it does not establish ownership.
    -- No source or relationship is written to make a zero-photo profile discoverable.
    UNION SELECT v.id, 4 FROM vehicles v
      WHERE v.user_id=p_user_id AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL
        AND (SELECT is_own FROM viewer)
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
         CASE WHEN (SELECT is_own FROM viewer) AND d.pr <> 4 THEN
           (SELECT ne.estimated_value FROM nuke_estimates ne
              WHERE ne.vehicle_id = v.id AND ne.comp_method = 'class_stratified'
              ORDER BY ne.calculated_at DESC NULLS LAST LIMIT 1) END,
         CASE WHEN (SELECT is_own FROM viewer) AND d.pr <> 4 THEN v.purchase_price END,
         COALESCE(v.image_count, 0)::bigint,
         CASE d.pr WHEN 1 THEN 'owner' WHEN 2 THEN 'previously_owned' WHEN 3 THEN 'contributor' ELSE 'profile_record' END
  FROM dedup d JOIN vehicles v ON v.id=d.vehicle_id
  WHERE (SELECT is_own FROM viewer) OR (v.is_public = true AND v.deleted_at IS NULL)
  ORDER BY d.pr, v.year;
$function$;
COMMIT;
