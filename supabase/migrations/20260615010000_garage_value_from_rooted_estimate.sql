-- get_user_garage: source current_value from the ROOTED comp-based model
-- (nuke_estimates.estimated_value — backed by comps/confidence/range), NOT the bare
-- vehicles.current_value column, which had been overwritten with unfounded asking
-- prices (K10 showed $175K while the model says $25K from 261 comps; K5 $85.1K vs
-- $45.5K; Mustang a fake $12K). A value renders only from a real basis or holds null
-- — the root-system rule applied to valuation. Same RETURNS signature, so it fixes
-- every live build with no app rebuild.
CREATE OR REPLACE FUNCTION public.get_user_garage(p_user_id uuid)
 RETURNS TABLE(vehicle_id uuid, year integer, make text, model text, trim_name text, image_url text, current_value numeric, purchase_price numeric, image_count bigint, relationship text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
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
         (SELECT count(*) FROM vehicle_images vi WHERE vi.vehicle_id=v.id),
         CASE d.pr WHEN 1 THEN 'owner' WHEN 2 THEN 'previously_owned' ELSE 'contributor' END
  FROM dedup d JOIN vehicles v ON v.id=d.vehicle_id
  LEFT JOIN LATERAL (SELECT image_url FROM vehicle_images vi2 WHERE vi2.vehicle_id=v.id AND vi2.image_url IS NOT NULL ORDER BY vi2.is_primary DESC NULLS LAST, vi2.created_at LIMIT 1) fi ON true
  ORDER BY d.pr, v.year;
$function$;
