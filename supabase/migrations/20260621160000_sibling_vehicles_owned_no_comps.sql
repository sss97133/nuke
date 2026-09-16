-- Scope the attribution matcher's candidate set to OWNED vehicles, excluding
-- discovery comps.
--
-- get_sibling_vehicles feeds check-image-vehicle-match's candidate list (the vehicles
-- a frame can be re-homed to). It had two bugs: (1) it unioned discovered_vehicles, so
-- a user's Craigslist discovery comps became re-home targets — a frame could be moved
-- onto a listing of a *different* physical vehicle (observed live 2026-06-21); (2) it
-- never included vehicles owned directly via vehicles.owner_id, so genuinely-owned
-- vehicles could be missing as candidates. Fix: candidates come from real ownership
-- (owner_id + verification/permission/contributor tables) and craigslist-source comps
-- are excluded outright.

CREATE OR REPLACE FUNCTION public.get_sibling_vehicles(p_vehicle_id uuid, p_user_id uuid)
RETURNS TABLE(vehicle_id uuid, v_year integer, v_make text, v_model text, v_trim text, v_vin text, image_count bigint, gps_image_count bigint, visual_signature jsonb, primary_image_url text)
LANGUAGE sql STABLE AS $function$
  WITH user_vehicles AS (
    SELECT DISTINCT uv.vid FROM (
      SELECT id AS vid FROM vehicles WHERE owner_id = p_user_id
      UNION SELECT vehicle_id FROM ownership_verifications WHERE user_id = p_user_id
      UNION SELECT vehicle_id FROM vehicle_user_permissions WHERE user_id = p_user_id AND is_active = true
      UNION SELECT vehicle_id FROM vehicle_contributors WHERE user_id = p_user_id AND status != 'inactive'
    ) uv
  ),
  target AS (SELECT v.make, v.model FROM vehicles v WHERE v.id = p_vehicle_id)
  SELECT v.id, v.year, v.make, v.model, v."trim", v.vin,
    (SELECT count(*) FROM vehicle_images vi WHERE vi.vehicle_id = v.id) as image_count,
    (SELECT count(*) FROM vehicle_images vi WHERE vi.vehicle_id = v.id AND vi.latitude IS NOT NULL) as gps_image_count,
    v.visual_signature, v.primary_image_url
  FROM vehicles v
  JOIN user_vehicles uv ON uv.vid = v.id
  CROSS JOIN target t
  WHERE v.id != p_vehicle_id
    AND v.status IN ('active', 'pending', 'discovered', 'pending_backfill')
    AND COALESCE(v.source,'') <> 'craigslist'
    AND (
      v.make = t.make OR v.make ILIKE t.make || '%' OR t.make ILIKE v.make || '%'
      OR (v.make IN ('GMC', 'Chevrolet') AND t.make IN ('GMC', 'Chevrolet'))
    )
  ORDER BY v.year;
$function$;
