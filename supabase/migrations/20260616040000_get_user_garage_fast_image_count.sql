-- HOTFIX: the garage RPC timed out (~29.5s, measured via direct conn + EXPLAIN
-- ANALYZE) → the app's load failed → it showed "No vehicles yet" though the user
-- has 8. Root cause: the per-vehicle live count(*) over vehicle_images (38.9M
-- rows, constantly written by the analysis pipeline → stale visibility map → the
-- index-only scan degraded to per-row heap fetches at ~3.6s/vehicle). Plus the
-- first-image fallback LATERAL sorted by (is_primary, created_at), defeating the
-- created_at index (~1.4s/vehicle).
--
-- FIX: (1) use the maintained denormalized vehicles.image_count column instead of
-- counting live (approximate but instant); (2) the fallback-image LATERAL orders
-- by the indexed created_at alone (the is_primary preference isn't worth a sort on
-- a fallback thumbnail). Garage now returns in well under a second.
--
-- FOLLOW-UPS (noted, not done here): a denormalized image_count maintained by
-- trigger would keep it exact; and the iOS empty-garage state should distinguish
-- a FAILED load ("couldn't load · retry") from a genuinely empty garage.
CREATE OR REPLACE FUNCTION public.get_user_garage(p_user_id uuid)
 RETURNS TABLE(vehicle_id uuid, year integer, make text, model text, trim_name text,
               image_url text, current_value numeric, purchase_price numeric,
               image_count bigint, relationship text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH owned AS (
    SELECT vehicle_id, 1 pr FROM vehicle_ownerships WHERE owner_profile_id=p_user_id AND is_current=true
    UNION
    SELECT vehicle_id, 1 FROM ownership_verifications WHERE user_id=p_user_id AND status='approved'
    UNION
    SELECT vehicle_id, 2 FROM discovered_vehicles WHERE user_id=p_user_id AND is_active=true AND relationship_type='previously_owned'
    UNION
    SELECT vehicle_id, 3 FROM vehicle_contributors WHERE user_id=p_user_id
  ),
  dedup AS (SELECT vehicle_id, MIN(pr) pr FROM owned GROUP BY vehicle_id)
  SELECT v.id, v.year, v.make, v.model, v.trim,
         COALESCE(v.primary_image_url, fi.image_url),
         (SELECT ne.estimated_value FROM nuke_estimates ne
            WHERE ne.vehicle_id = v.id
            ORDER BY ne.calculated_at DESC NULLS LAST LIMIT 1),
         v.purchase_price,
         COALESCE(v.image_count, 0)::bigint,
         CASE d.pr WHEN 1 THEN 'owner' WHEN 2 THEN 'previously_owned' ELSE 'contributor' END
  FROM dedup d JOIN vehicles v ON v.id=d.vehicle_id
  LEFT JOIN LATERAL (
    SELECT image_url FROM vehicle_images vi2
    WHERE vi2.vehicle_id=v.id AND vi2.image_url IS NOT NULL
    ORDER BY vi2.created_at LIMIT 1
  ) fi ON true
  ORDER BY d.pr, v.year;
$function$;
