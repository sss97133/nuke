-- get_user_garage(p_user_id) — the user's vehicles for the iOS Garage + web parity.
-- Unions the four ownership sources the web's useVehiclesDashboard reads
-- (vehicle_ownerships.owner_profile_id, ownership_verifications, discovered_vehicles
-- previously_owned, vehicle_contributors), dedupes by vehicle, ranks owner > prev > contrib,
-- and returns card fields + a first-image fallback when primary_image_url is null.
-- Applied to prod 2026-06-13 (was created via execute_sql first; this file repairs the drift).

CREATE OR REPLACE FUNCTION public.get_user_garage(p_user_id uuid)
RETURNS TABLE(
  vehicle_id uuid, year int, make text, model text, trim_name text,
  image_url text, current_value numeric, purchase_price numeric,
  image_count bigint, relationship text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
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
         v.current_value, v.purchase_price,
         (SELECT count(*) FROM vehicle_images vi WHERE vi.vehicle_id=v.id),
         CASE d.pr WHEN 1 THEN 'owner' WHEN 2 THEN 'previously_owned' ELSE 'contributor' END
  FROM dedup d JOIN vehicles v ON v.id=d.vehicle_id
  LEFT JOIN LATERAL (
    SELECT image_url FROM vehicle_images vi2
    WHERE vi2.vehicle_id=v.id AND vi2.image_url IS NOT NULL
    ORDER BY vi2.is_primary DESC NULLS LAST, vi2.created_at LIMIT 1
  ) fi ON true
  ORDER BY d.pr, v.year;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_garage(uuid) TO anon, authenticated;
