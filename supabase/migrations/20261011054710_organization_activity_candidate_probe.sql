-- Keep eligibility and oldest-cache ordering; constrain each eligibility probe
-- so the planner cannot expand it into a join over the full listing population.
SET statement_timeout = '10s';
SET lock_timeout = '3s';
CREATE OR REPLACE FUNCTION public.organization_listing_activity_candidates(p_limit int DEFAULT 50)
RETURNS TABLE (organization_id uuid) LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
SET statement_timeout = '5s' AS $$
  WITH attributed AS MATERIALIZED (
    SELECT DISTINCT source_organization_id AS id FROM public.vehicle_events
    WHERE source_organization_id IS NOT NULL
  )
  SELECT o.id FROM attributed a
  JOIN public.organizations o ON o.id = a.id
  LEFT JOIN public.organization_seller_stats s ON s.organization_id = o.id
  JOIN LATERAL (
    SELECT 1 FROM public.vehicle_events e
    JOIN public.vehicles v ON v.id = e.vehicle_id
      AND v.is_public = true AND v.deleted_at IS NULL
    WHERE e.source_organization_id = o.id
      AND NOT EXISTS (SELECT 1 FROM public.organization_vehicles ov
        WHERE ov.organization_id = o.id AND ov.vehicle_id = e.vehicle_id
          AND (ov.hidden_from_public = true OR ov.user_rejected = true))
    LIMIT 1
  ) eligible ON true
  ORDER BY s.calculated_at ASC NULLS FIRST, o.id
  LIMIT greatest(1, least(coalesce(p_limit, 50), 50));
$$;
COMMENT ON FUNCTION public.organization_listing_activity_candidates(int) IS
  'Service-only compute-org-seller-stats selector: indexed attributed organization keys, one bounded public/nondeleted/visible/nonrejected listing eligibility probe per key, oldest cache first, at most 50 keys. Does not mint organizations or sample event populations.';
REVOKE ALL ON FUNCTION public.organization_listing_activity_candidates(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.organization_listing_activity_candidates(int) TO service_role;
RESET statement_timeout;
RESET lock_timeout;
NOTIFY pgrst, 'reload schema';
