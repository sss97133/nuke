-- organization_listing_activity_candidates timed out on every call, so the seller-stats job
-- (cron compute-org-seller-stats-daily, every 10 minutes) has landed nothing since 2026-11-08 22:47Z:
-- 132 of 132 calls answered 500 in the 24 hours to 2026-11-12 00:20Z ("Candidate reading failed:
-- canceling statement due to statement timeout"), each spending its full 5 s in the database.
--
-- The cause is the first step: SELECT DISTINCT source_organization_id over all of vehicle_events
-- (about 910,000 rows) before any organization is chosen. This version starts from organizations
-- (5,759 rows) in oldest-calculated order and probes vehicle_events by its organization index, one
-- eligible event per organization, stopping at the limit. Same result set and order.
-- Measured on production 2026-11-12: 192 ms for the 50-row batch (18,082 buffers).
--
-- CREATE OR REPLACE keeps the existing grants (service_role only).

SET lock_timeout = '3s';
SET statement_timeout = '10s';

CREATE OR REPLACE FUNCTION public.organization_listing_activity_candidates(p_limit integer DEFAULT 50)
 RETURNS TABLE(organization_id uuid)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
 SET statement_timeout TO '5s'
AS $function$
  SELECT o.id
  FROM public.organizations o
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
$function$;
