-- ============================================================================
-- get_service_vehicles_for_org — the whole service card in one round trip
-- ============================================================================
-- WHY (platform-hygiene justification — no new object is minted):
--
-- 1. N+1 COLLAPSE. The org "In Service" grid (OrganizationProfile.tsx:2749)
--    renders one ServiceVehicleCardRich per vehicle and each card fired 3
--    queries of its own: timeline_events for vehicle+org, vehicle_images
--    (page of 6 + exact count), vehicle_images (oldest taken_at). Measured on
--    Ernies Upholstery: 46 cards = 138 client round trips, 4.5-5.0s to settle.
--    Every one of those facts is already reachable from this function's own
--    vehicle set, so they are appended here as columns.
--
-- 2. NO THIRD FUNCTION. Two near-duplicates exist in prod:
--    get_service_vehicles_for_org (WIRED — organizationIntelligenceService.ts
--    :328 -> OrganizationServiceTab) and get_organization_service_vehicles
--    (receipts-shaped, SECURITY DEFINER, no app caller found by grep). Per
--    AGENTS.md "DON'T MINT" the wired one is extended in place. The other is
--    left untouched pending its own adjudication — it is not forked here.
--
-- 3. ADDITIVE. The 9 pre-existing output columns keep name, type and position
--    so the existing OrganizationServiceTab caller keeps working. Five columns
--    are appended. Two pre-existing columns change MEANING, both deliberately
--    and both toward honesty — see 5 and 6.
--
-- 4. HOURS BUG. The prior body read labor time from
--    COALESCE((te.metadata->>'duration_hours')::numeric, 0). Measured
--    2026-07-26 across every org-scoped timeline_event on the platform (91
--    rows): te.duration_hours is populated 0 times, metadata.duration_hours 60
--    times, te.labor_hours 31 times — and for this org it is labor_hours on
--    31 of 31 events. total_labor_hours was therefore hard-zero for Ernie's
--    entire shop. The read now walks metadata.duration_hours -> duration_hours
--    -> labor_hours -> 0, which yields 158.5h (1974 Bronco, 17 events) and 56h
--    (1977 Blazer, 14 events).
--
--    PROVENANCE, and it binds the UI: 31 of 31 of those hours carry
--    source = 'AI-generated work log from shop images' or 'ai_consolidated'.
--    They are estimated from photographs, not clocked. Any surface rendering
--    total_labor_hours must say so, and must not multiply them by a shop rate
--    and print the product as a value.
--
-- 5. total_investment RETURNS NULL, NOT 0. It was hard-coded 0::numeric, which
--    rendered a defended-looking "Investment $0" on ServiceVehicleCard. Money
--    does exist — 250 rows in `receipts` for 8 of this org's vehicles summing
--    $112,516.30 — but it is NOT investment: the largest entries are
--    "Bring a Trailer (sold to Dave Granholm, NJ)" $31,000 and
--    "Bring a Trailer (brokered for Justine Goodfellow)" $13,750, i.e. sale
--    proceeds, sitting alongside genuine parts spend (AutoZone 41 receipts,
--    $813.10). Summing that column and labelling it "Investment" would mix
--    revenue with cost. Until receipts carry a direction, the honest value is
--    unknown: NULL. The card blocks on null rather than printing a figure.
--    (memory: feedback_valuation_block_when_not_defensible)
--
-- 6. current_status 'pending' is now reachable. The prior fallback test
--    (COUNT(*) > 0) ran over a LEFT JOIN group that always had >= 1 row, so a
--    vehicle with zero logged events reported 'on_hold'. Nothing was ever put
--    on hold — nothing was ever logged. job_count = 0 now reports 'pending'.
--
-- 7. INDEX-ALIGNED. photo_count / first_photo_at / last_photo_at /
--    recent_image_urls all filter vehicle_id + taken_at IS NOT NULL, served by
--    vehicle_images_taken_date (vehicle_id, taken_at) WHERE taken_at IS NOT
--    NULL. vehicle_images.timeline_event_id is deliberately NOT joined: it has
--    no index and a per-event correlated count times out on that table.
--
-- 8. BOTH jsonb CASTS ARE GUARDED, symmetrically. An earlier pass guarded
--    metadata.image_count and left metadata.duration_hours bare; 60 org-scoped
--    events platform-wide carry that key, so one non-numeric value would throw
--    the whole org's call. Both now use the same decimal-tolerant regex.
--
-- SECURITY: unchanged — SECURITY INVOKER (prosecdef = false), so RLS on
-- vehicles / vehicle_images / timeline_events still applies to the caller.
-- Demonstrated behaviourally: anon gets 62 rows / 28,792 photos where
-- service_role gets 63 / 29,288, because RLS on `vehicles` hides the
-- intake-quarantine row from the public.
--
-- MEASURED (org e796ca48-f3af-41b5-be13-5335bb422b41, 2026-07-26): 63 rows,
-- ~95-140 ms server-side; 0.30 s end-to-end as service_role, 1.08-1.21 s as
-- anon. photo_count / first_photo_at / last_photo_at match direct per-vehicle
-- counts on 63 of 63 vehicles, including the five visible in the live UI
-- (1467 / 701 / 550 / 465 / 354). Replaces 138 client round trips.
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_service_vehicles_for_org(uuid);

CREATE OR REPLACE FUNCTION public.get_service_vehicles_for_org(p_organization_id uuid)
RETURNS TABLE (
  -- ---- pre-existing columns (name / type / position unchanged) -------------
  vehicle_id          uuid,
  vehicle_info        jsonb,
  receipts            jsonb,
  total_investment    numeric,      -- now NULL when undefendable (see 5)
  total_days          integer,
  total_labor_hours   numeric,      -- now real, and ESTIMATED (see 4)
  job_count           bigint,
  current_status      text,
  primary_image_url   text,
  -- ---- appended ------------------------------------------------------------
  photo_count         bigint,
  first_photo_at      timestamptz,
  last_photo_at       timestamptz,
  recent_image_urls   text[],
  work_types          text[]
)
LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  WITH service_vehicles AS (
    SELECT DISTINCT ov.vehicle_id
    FROM organization_vehicles ov
    WHERE ov.organization_id = p_organization_id
      AND ov.relationship_type IN ('service_provider', 'work_location')
      AND ov.status = 'active'
  ),
  vehicle_events AS (
    SELECT
      te.vehicle_id,
      te.id         AS event_id,
      te.event_date,
      te.title,
      -- metadata.duration_hours -> te.duration_hours -> te.labor_hours -> 0.
      -- NULLIF mirrors the card's falsy-zero fallthrough (a || b || 0).
      COALESCE(
        NULLIF(
          CASE WHEN te.metadata->>'duration_hours' ~ '^[+-]?[0-9]*\.?[0-9]+$'
               THEN (te.metadata->>'duration_hours')::numeric
          END, 0),
        NULLIF(te.duration_hours, 0),
        te.labor_hours,
        0
      ) AS duration_hours,
      CASE WHEN te.metadata->>'image_count' ~ '^[0-9]+(\.[0-9]+)?$'
           THEN floor((te.metadata->>'image_count')::numeric)::integer
           ELSE COALESCE(array_length(te.image_urls, 1), 0)
      END AS image_count
    FROM timeline_events te
    JOIN service_vehicles sv ON sv.vehicle_id = te.vehicle_id
    WHERE te.organization_id = p_organization_id
  ),
  event_rollup AS (
    SELECT
      ve.vehicle_id,
      jsonb_agg(
        jsonb_build_object(
          'id',               ve.event_id,
          'date',             ve.event_date,
          'title',            ve.title,
          -- ServiceVehicleCard.tsx reads work_description and labor_hours;
          -- both are emitted. 'total' is deliberately NOT emitted — there is
          -- no per-event money on file, and an absent key renders as a blocked
          -- state in the component rather than as a fabricated $0.
          'work_description', ve.title,
          'duration_hours',   ve.duration_hours,
          'labor_hours',      ve.duration_hours,
          'hours_are_estimated', true,
          'image_count',      ve.image_count
        )
        ORDER BY ve.event_date DESC, ve.event_id DESC
      )                            AS receipts,
      COUNT(*)                     AS job_count,
      SUM(ve.duration_hours)       AS total_labor_hours,
      MIN(ve.event_date)           AS first_event_date,
      MAX(ve.event_date)           AS last_event_date,
      -- the same five buckets ServiceVehicleCardRich derives from event titles,
      -- in a deterministic order instead of Set-insertion order
      ARRAY_REMOVE(ARRAY[
        CASE WHEN bool_or(ve.title ILIKE '%paint%')      THEN 'Paint'      END,
        CASE WHEN bool_or(ve.title ILIKE '%body%')       THEN 'Body Work'  END,
        CASE WHEN bool_or(ve.title ILIKE '%interior%')   THEN 'Interior'   END,
        CASE WHEN bool_or(ve.title ILIKE '%engine%')     THEN 'Mechanical' END,
        CASE WHEN bool_or(ve.title ILIKE '%upholster%')  THEN 'Upholstery' END
      ]::text[], NULL::text)       AS work_types
    FROM vehicle_events ve
    GROUP BY ve.vehicle_id
  )
  SELECT
    v.id,
    jsonb_build_object('year', v.year, 'make', v.make, 'model', v.model, 'vin', v.vin),
    COALESCE(er.receipts, '[]'::jsonb),
    NULL::numeric,                                          -- see 5
    COALESCE((er.last_event_date - er.first_event_date), 0),
    COALESCE(er.total_labor_hours, 0)::numeric,
    COALESCE(er.job_count, 0)::bigint,
    CASE
      WHEN er.job_count IS NULL OR er.job_count = 0                    THEN 'pending'
      WHEN er.last_event_date > CURRENT_DATE - INTERVAL '30 days'      THEN 'in_progress'
      ELSE 'on_hold'
    END,
    pri.image_url,
    COALESCE(ph.photo_count, 0)::bigint,
    ph.first_photo_at,
    ph.last_photo_at,
    COALESCE(rec.recent_image_urls, '{}'::text[]),
    COALESCE(er.work_types, '{}'::text[])
  FROM service_vehicles sv
  JOIN vehicles v ON v.id = sv.vehicle_id
  LEFT JOIN event_rollup er ON er.vehicle_id = v.id
  LEFT JOIN LATERAL (
    SELECT vi.image_url
    FROM vehicle_images vi
    WHERE vi.vehicle_id = v.id
    -- id tiebreaker so the hero image cannot flip between identical calls
    ORDER BY vi.taken_at DESC NULLS LAST, vi.created_at DESC, vi.id DESC
    LIMIT 1
  ) pri ON TRUE
  LEFT JOIN LATERAL (
    SELECT COUNT(*)         AS photo_count,
           MIN(vi.taken_at) AS first_photo_at,
           MAX(vi.taken_at) AS last_photo_at
    FROM vehicle_images vi
    WHERE vi.vehicle_id = v.id AND vi.taken_at IS NOT NULL
  ) ph ON TRUE
  LEFT JOIN LATERAL (
    SELECT array_agg(s.url ORDER BY s.taken_at DESC, s.id DESC) AS recent_image_urls
    FROM (
      SELECT COALESCE(NULLIF(vi.thumbnail_url, ''), vi.image_url) AS url,
             vi.taken_at, vi.id
      FROM vehicle_images vi
      WHERE vi.vehicle_id = v.id AND vi.taken_at IS NOT NULL
      ORDER BY vi.taken_at DESC, vi.id DESC
      LIMIT 6
    ) s
  ) rec ON TRUE;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_service_vehicles_for_org(uuid) TO anon, authenticated, service_role;
