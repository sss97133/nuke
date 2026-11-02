-- map_zip_activity: per-ZIP "what happened lately" counts for the iOS Explore map (apps/nuke-capture-ios MarketMapView).
--
-- Two things the phone could not get cheaply before:
--   1. A date window (the map now opens on the last 7 days). Windows used to force the phone to page every raw
--      vehicle_location_observations row for every county in view and then read auction clocks for each vehicle.
--      This answers the same question from auction_events (indexed on auction_end_date) in one small call.
--   2. The last 24 hours: auctions that closed as sold, and live listings first captured, per ZIP. This drives the
--      pulsing dots and the "N new today" count.
--
-- Definitions (all real rows; nothing synthetic, nothing estimated):
--   windowed   distinct vehicles with a non-duplicate auction_events row whose auction_end_date is in
--              [p_start, p_end). The phone passes UTC-midnight bounds, matching its "auction close, UTC day" window.
--              NULL bounds mean "no window": windowed is 0 for every row and only the 24h columns are meaningful.
--   sold_24h   distinct vehicles whose auction closed with outcome = 'sold' in (now() - 24h, now()].
--   listed_24h distinct vehicles with a still-live auction (outcome = 'live', auction_end_date > now()) whose
--              auction_events row was first created in the last 24h, i.e. first captured by Nuke, which is not
--              necessarily the moment the seller posted it.
--   fresh_24h  distinct vehicles in sold_24h OR listed_24h, so a vehicle is never counted twice in the header.
--
-- Location comes from the same evidence map_zip_counts uses: observations with county_fips = ANY(p_fips),
-- confidence >= 0.5, a 5-digit (or ZIP+4) postal code, and a vehicle that is not deleted/merged/rejected/duplicate.
-- One row per (county partition, 5-digit ZIP, normalized make), like map_zip_counts, so the phone folds both the
-- same way.
--
-- SECURITY INVOKER like map_zip_counts: RLS on auction_events, vehicle_location_observations and vehicles applies.
-- Cost: auction_events is read by the end-date index from LEAST(p_start, now() - 24h) forward (about 1.4k closed +
-- 1.3k live rows for a 7-day window on 2026-11-01), then vehicle_location_observations by vehicle_id. The phone only
-- calls this for windows of 90 days or less.

CREATE OR REPLACE FUNCTION public.map_zip_activity(
  p_fips text[],
  p_start timestamptz DEFAULT NULL,
  p_end timestamptz DEFAULT NULL,
  p_make text DEFAULT NULL
)
RETURNS TABLE (county_fips text, zip text, make text, windowed bigint, sold_24h bigint, listed_24h bigint, fresh_24h bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
SET statement_timeout = '15s'
AS $$
  WITH b AS (
    SELECT now() AS t,
           now() - interval '24 hours' AS d1,
           CASE WHEN p_start IS NOT NULL AND p_end IS NOT NULL AND p_end > p_start THEN p_start END AS ws,
           CASE WHEN p_start IS NOT NULL AND p_end IS NOT NULL AND p_end > p_start THEN p_end END AS we
  ),
  ev AS MATERIALIZED (
    SELECT x.vehicle_id, x.in_window, x.sold_new, x.listed_new
    FROM (
      SELECT e.vehicle_id,
             coalesce(e.auction_end_date >= b.ws AND e.auction_end_date < b.we, false) AS in_window,
             (e.outcome = 'sold' AND e.auction_end_date >= b.d1 AND e.auction_end_date <= b.t) AS sold_new,
             (e.outcome = 'live' AND e.auction_end_date > b.t AND e.created_at >= b.d1) AS listed_new
      FROM public.auction_events e, b
      WHERE e.duplicate_of IS NULL
        AND e.vehicle_id IS NOT NULL
        AND e.auction_end_date >= least(coalesce(b.ws, b.d1), b.d1)
    ) x
    WHERE x.in_window OR x.sold_new OR x.listed_new
  ),
  loc AS (
    SELECT DISTINCT o.vehicle_id, o.county_fips,
           substring(btrim(o.postal_code) FROM 1 FOR 5) AS zip
    FROM public.vehicle_location_observations o
    WHERE o.vehicle_id IN (SELECT vehicle_id FROM ev)
      AND o.county_fips = ANY (p_fips)
      AND o.confidence >= 0.5
      AND btrim(o.postal_code) ~ '^[0-9]{5}(-[0-9]{4})?$'
  )
  SELECT loc.county_fips,
         loc.zip,
         min(btrim(v.make)) AS make,
         count(DISTINCT ev.vehicle_id) FILTER (WHERE ev.in_window) AS windowed,
         count(DISTINCT ev.vehicle_id) FILTER (WHERE ev.sold_new) AS sold_24h,
         count(DISTINCT ev.vehicle_id) FILTER (WHERE ev.listed_new) AS listed_24h,
         count(DISTINCT ev.vehicle_id) FILTER (WHERE ev.sold_new OR ev.listed_new) AS fresh_24h
  FROM ev
  JOIN loc ON loc.vehicle_id = ev.vehicle_id
  JOIN public.vehicles v ON v.id = ev.vehicle_id
  WHERE v.deleted_at IS NULL
    AND coalesce(v.status, '') NOT IN ('deleted', 'merged', 'rejected', 'duplicate')
    AND (p_make IS NULL OR lower(btrim(v.make)) = lower(btrim(p_make)))
  GROUP BY loc.county_fips, loc.zip, lower(nullif(btrim(v.make), ''))
$$;

COMMENT ON FUNCTION public.map_zip_activity(text[], timestamptz, timestamptz, text) IS
  'Per (county_fips, ZIP, make): vehicles with an auction close in [p_start, p_end), plus last-24h sold / newly captured live listings. SECURITY INVOKER; RLS applies.';

REVOKE ALL ON FUNCTION public.map_zip_activity(text[], timestamptz, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.map_zip_activity(text[], timestamptz, timestamptz, text) TO anon, authenticated, service_role;
