-- map_zip_counts: per-ZIP coloring aggregates for the iOS market map (apps/nuke-capture-ios MarketMapView).
--
-- Before this, the phone paged every vehicle_location_observations row for each county in view (1,000 at a time with a
-- vehicles!inner embed), then batch-read auction clocks, only to count distinct vehicles per ZIP. This returns those
-- counts directly: one row per (county partition, 5-digit ZIP, normalized make) with the distinct vehicle count.
-- Raw rows and auction clocks are now read only when the user drills into a ZIP (or applies a date window).
--
-- Same filters as the client path:
--   * county_fips = ANY(p_fips), confidence >= 0.5 (also the public RLS floor);
--   * vehicles.deleted_at IS NULL and status not in (deleted, merged, rejected, duplicate);
--   * postal_code must be a 5-digit ZIP or ZIP+4 (trimmed); others are not colorable and are omitted;
--   * p_make (optional) is compared trimmed and case-insensitively.
-- Date windows depend on the client-side auction clock resolution, so they stay on the raw-row path.
--
-- SECURITY INVOKER (like the other public map/comps readers): RLS on vehicle_location_observations (high-confidence,
-- sightings only for authenticated users) and on vehicles still applies to the caller.
--
-- Index: served by the existing idx_vlo_county_id_page (county_fips, id) WHERE county_fips IS NOT NULL AND
-- confidence >= 0.5. An index-only variant would be
--   CREATE INDEX CONCURRENTLY idx_vlo_county_zip_cover ON public.vehicle_location_observations
--     (county_fips) INCLUDE (vehicle_id, postal_code, source_type) WHERE county_fips IS NOT NULL AND confidence >= 0.5;
-- left out here because CONCURRENTLY cannot run inside a migration transaction. Measured read-only on production
-- (2026-10-22): the aggregate for Washoe 32031 (1,859 county rows) ran in 355 ms, heap-bound (1,684 heap blocks);
-- Los Angeles 06037 (~24k rows) exceeded the SQL console statement timeout cold. Creating the covering index above
-- is recommended before relying on this for dense counties; the phone falls back to raw reads on any error.

CREATE OR REPLACE FUNCTION public.map_zip_counts(p_fips text[], p_make text DEFAULT NULL)
RETURNS TABLE (county_fips text, zip text, make text, vehicles bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT o.county_fips,
         substring(btrim(o.postal_code) FROM 1 FOR 5) AS zip,
         min(btrim(v.make)) AS make,
         count(DISTINCT v.id) AS vehicles
  FROM public.vehicle_location_observations o
  JOIN public.vehicles v ON v.id = o.vehicle_id
  WHERE o.county_fips = ANY (p_fips)
    AND o.county_fips IS NOT NULL
    AND o.confidence >= 0.5
    AND v.deleted_at IS NULL
    AND coalesce(v.status, '') NOT IN ('deleted', 'merged', 'rejected', 'duplicate')
    AND btrim(o.postal_code) ~ '^[0-9]{5}(-[0-9]{4})?$'
    AND (p_make IS NULL OR lower(btrim(v.make)) = lower(btrim(p_make)))
  GROUP BY o.county_fips, substring(btrim(o.postal_code) FROM 1 FOR 5), lower(nullif(btrim(v.make), ''))
$$;

COMMENT ON FUNCTION public.map_zip_counts(text[], text) IS
  'Distinct eligible vehicles per (county_fips, ZIP, make) for the iOS market map coloring. SECURITY INVOKER; RLS applies.';

REVOKE ALL ON FUNCTION public.map_zip_counts(text[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.map_zip_counts(text[], text) TO anon, authenticated, service_role;
